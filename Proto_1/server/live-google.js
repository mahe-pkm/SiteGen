import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { livePlace, LookupError } from './places.js';

export function createLiveGoogle(config, store, fetcher = fetch) {
  const secret = randomBytes(32);
  function sign(siteId, resource) {
    const payload = Buffer.from(JSON.stringify({ siteId, resource, expires: Date.now() + 15 * 60000 })).toString('base64url');
    return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`;
  }
  function verify(siteId, token) {
    if (token.length > 4000 || token.split('.').length !== 2) throw new LookupError('Invalid photo request.');
    const [payload, signature] = token.split('.');
    const expected = createHmac('sha256', secret).update(payload || '').digest('base64url');
    if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new LookupError('Invalid photo request.');
    let data;
    try { data = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch { throw new LookupError('Invalid photo request.'); }
    if (data.siteId !== siteId || data.expires < Date.now()) throw new LookupError('Photo link expired. Refresh the preview.', 410);
    const site = store.get(siteId);
    const placeId = site && JSON.parse(site.content).placeId;
    if (!placeId || !data.resource.startsWith(`places/${placeId}/photos/`) || !/^places\/[\w-]+\/photos\/[\w-]+$/.test(data.resource)) throw new LookupError('Invalid photo resource.');
    return data.resource;
  }
  async function profile(site) {
    const content = JSON.parse(site.content);
    if (!content.liveGoogle || !content.placeId) throw new LookupError('Live Google display is not enabled.', 404);
    if (!config.googleKey) throw new LookupError('Google API is not configured.', 503);
    if (!store.consumeLookup(config.lookupDailyLimit)) throw new LookupError('Daily Google lookup limit reached.', 429);
    const profile = await livePlace(content.placeId, config.googleKey, fetcher);
    profile.photos = profile.photos.map(({ resource, ...photo }) => ({ ...photo, url: `./google-photo/${sign(site.id, resource)}` }));
    return profile;
  }
  async function photo(site, token, width) {
    const resource = verify(site.id, token);
    const size = width === '1600' ? 1600 : 900;
    if (!store.consumePhoto(config.photoDailyLimit ?? 300)) throw new LookupError('Daily Google photo limit reached.', 429);
    const response = await fetcher(`https://places.googleapis.com/v1/${resource}/media?maxWidthPx=${size}&skipHttpRedirect=true`, {
      headers: { 'X-Goog-Api-Key': config.googleKey }, redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new LookupError('Google photo is unavailable.', 502);
    const data = await response.json();
    let url;
    try { url = new URL(data.photoUri); } catch { throw new LookupError('Google returned an invalid photo URL.', 502); }
    if (url.protocol !== 'https:' || url.username || url.password || url.port || !(url.hostname.endsWith('.googleusercontent.com') || url.hostname.endsWith('.gstatic.com'))) throw new LookupError('Google photo host is not supported.', 502);
    const image = await fetcher(url, { redirect: 'error', signal: AbortSignal.timeout(15000) });
    if (!image.ok || !/^image\/(jpeg|png|webp)(?:;|$)/.test(image.headers.get('content-type') || '')) throw new LookupError('Google did not return a supported image.', 502);
    const chunks = [];
    let sizeBytes = 0;
    for await (const chunk of image.body) {
      sizeBytes += chunk.byteLength;
      if (sizeBytes > 8 * 1024 * 1024) throw new LookupError('Google photo is too large.', 502);
      chunks.push(chunk);
    }
    return { bytes: Buffer.concat(chunks), type: image.headers.get('content-type') };
  }
  return { profile, photo };
}
