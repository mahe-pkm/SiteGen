import { generateRelease } from './renderer.js';

export function createJobs(store, config, { render = generateRelease, fetcher = fetch } = {}) {
  let pending = Promise.resolve();
  const busy = new Set();

  async function publish(id) {
    const site = store.get(id);
    const content = JSON.parse(site.content);
    if (!config.publicDeployEnabled) throw new Error('VPS publishing is not configured. The local HTML preview is ready.');
    if (!content.publicationAuthorized || content.source === 'demo') throw new Error('External publication requires owner authorization and non-demo content.');
    if (content.liveGoogle || content.source === 'reference') throw new Error('Live Google website deployment requires a separately approved integration.');
    if (!site.version) throw new Error('Generate the website before publishing.');
    const previousVersion = site.active_version;
    store.update(id, { active_version: site.version, status: 'publishing', error: '' });
    const url = `https://${site.slug}.${config.siteBaseDomain}/`;
    try {
      const response = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
      const html = await response.text();
      if (!response.ok || !html.includes(`content="${id}"`)) throw new Error('Live website identity check failed.');
      const css = await fetcher(new URL('style.css', url), { redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!css.ok || !(await css.text()).includes('.hero')) throw new Error('Live stylesheet check failed.');
      store.update(id, { status: 'published', error: '' });
      store.event(id, 'published', 'HTTPS website and stylesheet verified. Public link is ready.');
    } catch {
      store.update(id, { active_version: previousVersion, status: previousVersion ? 'published' : 'ready', error: 'Public verification failed. Check DNS, TLS and the VPS router. The previous release was preserved.' });
      store.event(id, 'publish_failed', 'Public verification failed; previous publication restored.');
    }
  }

  function enqueue(id, operation = 'generate') {
    if (busy.has(id)) return false;
    busy.add(id);
    store.update(id, { status: 'queued', error: '' });
    store.event(id, 'queued', operation === 'generate' ? 'HTML generation queued.' : 'Public deployment queued.');
    pending = pending.then(async () => {
      try {
        if (operation === 'generate') {
          const site = store.get(id);
          const content = JSON.parse(site.content);
          store.update(id, { status: 'generating' });
          await render(config, content, site, site.version + 1);
          store.update(id, { version: site.version + 1, status: site.active_version ? 'published' : 'ready', error: '' });
          store.event(id, 'generated', `HTML release ${site.version + 1} is ready.${content.liveGoogle ? ' Google details and photos load live; they are not embedded in the saved files.' : ' No runtime Google request is required.'}`);
          // Generation never publishes implicitly. The reviewed release needs a separate action.
        } else {
          await publish(id);
        }
      } catch (error) {
        const site = store.get(id);
        store.update(id, { status: site.active_version ? 'published' : 'failed', error: error.message });
        store.event(id, 'failed', error.message);
      } finally {
        busy.delete(id);
      }
    });
    return true;
  }
  return { enqueue, isBusy: (id) => busy.has(id), drain: () => pending };
}
