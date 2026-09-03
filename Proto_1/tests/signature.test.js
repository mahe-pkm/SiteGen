import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { root } from '../server/config.js';
import { siteSchema, emptyCopy } from '../server/schema.js';
import { renderSignatureHtml, signatureView } from '../server/signature-renderer.js';
import { createApp, errors } from '../server/app.js';
import { releasePath } from '../server/renderer.js';

const baseContent = { name: 'Signature Test Studio', category: 'Event studio', city: 'Bengaluru', description: '', services: [], template: 'signature', source: 'owner', rightsConfirmed: true, illustrativeImage: false };
const reference = { ...baseContent, name: 'Google business preview', category: 'Business profile', city: '', source: 'reference', placeId: 'ChIJSignatureTest123', liveGoogle: true };
const parse = (overrides = {}) => siteSchema.parse({ ...baseContent, ...overrides });

async function fixture(t, dependencies = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'proto1-signature-'));
  const config = { root, dataDir, dev: true, port: 0, googleKey: 'test-secret', adminPassword: '', siteBaseDomain: '', publicDeployEnabled: false, lookupDailyLimit: 20, photoDailyLimit: 20 };
  const app = createApp(config, dependencies); app.use(errors);
  const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const send = (url, body, method = 'POST') => fetch(base + url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  t.after(async () => {
    await app.locals.jobs.drain(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.locals.store.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('proto1-signature-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { config, app, base, send };
}

test('Signature accepts empty sections and legacy records receive additive defaults', () => {
  const content = parse();
  assert.deepEqual(content.gallery, []); assert.equal(content.brandName, ''); assert.equal(content.logoId, '');
  assert.equal(signatureView(content, { id: randomUUID() }).hasEnquiry, false);
  assert.equal(siteSchema.safeParse({ ...baseContent, gallery: [{ imageId: '../bad', caption: 'Bad image' }] }).success, false);
});

test('reference branding and images require separate confirmation without permitting copied Google facts', () => {
  assert.equal(siteSchema.safeParse({ ...reference, brandName: 'Independent Brand' }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, brandName: 'Independent Brand', brandConfirmed: true }).success, true);
  assert.equal(siteSchema.safeParse({ ...reference, logoId: randomUUID() }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, imageId: randomUUID() }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, imageId: randomUUID(), mediaConfirmed: true }).success, true);
  assert.equal(siteSchema.safeParse({ ...reference, gallery: [{ imageId: randomUUID(), caption: 'Owned photo' }] }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, address: 'Copied address', brandConfirmed: true, mediaConfirmed: true }).success, false);
});

test('Signature escapes supplied copy, excludes evidence and hides absent sections', async () => {
  const template = await readFile(path.join(root, 'templates/signature.hbs'), 'utf8');
  const content = parse({ brandName: '<b>Studio</b>', copy: { ...emptyCopy, headline: '<script>alert(1)</script>', heroEvidence: 'PRIVATE_INTERNAL_EVIDENCE', aboutEvidence: 'PRIVATE_INTERNAL_EVIDENCE' } });
  const html = renderSignatureHtml(content, { id: randomUUID() }, template);
  assert.match(html, /&lt;script&gt;/); assert.doesNotMatch(html, /<script>alert|PRIVATE_INTERNAL_EVIDENCE/);
  assert.doesNotMatch(html, /id="services"|id="portfolio"|id="about"|id="questions"|id="enquiry-form"|google\.js|Willow|Bengaluru.*Google Maps/);
  assert.match(html, /noindex,nofollow/);
});

test('Signature reference distinguishes independent branding from live Google fields', async () => {
  const template = await readFile(path.join(root, 'templates/signature.hbs'), 'utf8');
  const content = siteSchema.parse({ ...reference, brandName: 'Independent Studio', brandConfirmed: true });
  const html = renderSignatureHtml(content, { id: randomUUID() }, template);
  assert.match(html, /data-google-enabled="true"/); assert.doesNotMatch(html, /google\.js/);
  assert.match(html, /data-live="category"/); assert.match(html, /data-live="address"/);
  assert.doesNotMatch(html, /id="hero-title" data-profile-heading|data-profile-brand/);
  assert.match(html, /data-reference="false"/);
  assert.match(html, /translate="no">Google Maps/);
  assert.doesNotMatch(html, /data-enquiry-whatsapp|data-enquiry-email/);
});

test('generated Signature packages owned images and local assets, with immutable prior releases', async (t) => {
  const { app, config, base, send } = await fixture(t);
  const image = new FormData();
  image.append('image', new Blob([await readFile(path.join(root, 'public/design-preview/assets/table.webp'))], { type: 'image/webp' }), 'owned-test.webp');
  const upload = await fetch(base + '/api/assets', { method: 'POST', body: image });
  assert.equal(upload.status, 201); const { id } = await upload.json();
  const content = parse({ imageId: id, logoId: id, brandName: 'Test Brand', email: 'qa@example.com', gallery: [{ imageId: id, caption: 'Owned table', category: 'styling' }], copy: { ...emptyCopy, about: 'An independently supplied description.', aboutEvidence: 'PRIVATE EVIDENCE' } });
  const response = await send('/api/sites', content); assert.equal(response.status, 202);
  const { site } = await response.json(); await app.locals.jobs.drain();
  const release = releasePath(config, site.id, 1);
  const html = await readFile(path.join(release, 'index.html'), 'utf8');
  assert.match(html, /logo\.webp|gallery-0\.webp/); assert.doesNotMatch(html, /\/api\/assets|PRIVATE EVIDENCE|google\.js|Illustrative photography/);
  assert.match(html, /data-enquiry-email href="mailto:qa@example.com"/);
  assert.ok(!(await readdir(release)).includes('google.js'));
  for (const asset of ['logo.webp', 'hero.webp', 'gallery-0.webp', 'style.css', 'site.js', 'assets/dm-serif.ttf', 'assets/menu.svg']) {
    const response = await fetch(`${base}/preview/${site.slug}/${asset}`);
    assert.equal(response.status, 200, asset); assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
  const oldCss = await readFile(path.join(release, 'style.css'), 'utf8');
  const patch = await send(`/api/sites/${site.id}`, { expectedVersion: 1, content: { ...content, palette: 'rose', gallery: [] } }, 'PATCH');
  assert.equal(patch.status, 200); await app.locals.jobs.drain();
  assert.equal(app.locals.store.get(site.id).version, 2);
  assert.equal(await readFile(path.join(release, 'index.html'), 'utf8'), html);
  assert.equal(await readFile(path.join(release, 'style.css'), 'utf8'), oldCss);
  const newer = await readFile(path.join(releasePath(config, site.id, 2), 'index.html'), 'utf8');
  assert.match(newer, /palette-rose/); assert.doesNotMatch(newer, /gallery-0.webp/);
  const before = app.locals.store.get(site.id).content;
  assert.equal((await send(`/api/sites/${site.id}`, { expectedVersion: 2, content: { ...content, logoId: randomUUID() } }, 'PATCH')).status, 404);
  assert.equal(app.locals.store.get(site.id).content, before);
});

test('new Google drafts use Signature and Google data remains transient', async (t) => {
  let calls = 0;
  const { app, config, base, send } = await fixture(t, { googleFetch: async () => {
    calls++;
    return Response.json({ id: reference.placeId, displayName: { text: 'EPHEMERAL_SIGNATURE_BUSINESS' }, formattedAddress: 'EPHEMERAL_SIGNATURE_ADDRESS' });
  } });
  const { site } = await (await send('/api/reference-drafts', { placeId: reference.placeId })).json();
  await app.locals.jobs.drain(); assert.equal(site.template, 'signature'); assert.equal(calls, 0);
  const profile = await fetch(`${base}/preview/${site.slug}/google.json`);
  assert.equal(profile.status, 200); assert.match(profile.headers.get('cache-control'), /no-store/);
  assert.equal((await profile.json()).name, 'EPHEMERAL_SIGNATURE_BUSINESS'); assert.equal(calls, 1);
  assert.doesNotMatch(app.locals.store.get(site.id).content, /EPHEMERAL/);
  const html = await readFile(path.join(releasePath(config, site.id, 1), 'index.html'), 'utf8');
  assert.doesNotMatch(html, /EPHEMERAL|test-secret/); assert.match(html, /data-profile-heading/);
  assert.match(html, /data-profile-about/); assert.match(html, /data-profile-faq/);
  assert.equal((await send(`/api/sites/${site.id}/publish`, {})).status, 409);
});

test('demo enquiry never exposes live messaging destinations', async () => {
  const html = renderSignatureHtml(parse({ source: 'demo', email: 'qa@example.com', whatsapp: '+12025550123' }), { id: randomUUID() }, await readFile(path.join(root, 'templates/signature.hbs'), 'utf8'));
  assert.match(html, /data-preview-only="true"/);
  assert.doesNotMatch(html, /data-enquiry-whatsapp|data-enquiry-email|mailto:qa@example.com|https:\/\/wa.me\//);
  const script = await readFile(path.join(root, 'templates/signature.js'), 'utf8');
  assert.doesNotMatch(script, /innerHTML|localStorage|sessionStorage|sendBeacon/);
  assert.match(script, /if \(document.body.dataset.googleEnabled === 'true'\) \{\s*fetch/);
  assert.match(script, /description\.textContent = value/);
});
