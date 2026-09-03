import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { request as httpRequest } from 'node:http';
import { root } from '../server/config.js';
import { createApp, errors } from '../server/app.js';
import { resolveInput, lookupBusiness, LookupError } from '../server/places.js';
import { siteSchema } from '../server/schema.js';
import { renderHtml, releasePath } from '../server/renderer.js';

const placeId = 'ChIJTestReference12345678';
const sample = {
  name: 'Sample Studio', category: 'Creative studio', city: 'Bengaluru',
  description: 'Fictional content supplied for automated prototype verification.',
  services: ['Design consultation', 'Studio sessions'], source: 'demo', rightsConfirmed: true,
};

test('Place IDs and Maps links resolve without a Google search', async () => {
  assert.deepEqual(await resolveInput(placeId, 'place-id'), { placeId });
  assert.deepEqual(await resolveInput(`places/${placeId}`), { placeId });
  assert.deepEqual(await resolveInput(`https://www.google.com/maps/search/?api=1&query=Studio&query_place_id=${placeId}`), { placeId });
  assert.deepEqual(await resolveInput('Sample Studio Bengaluru'), { query: 'Sample Studio Bengaluru' });
});

test('untrusted hosts, credentials, non-HTTPS links and invalid IDs are rejected', async () => {
  for (const input of ['http://google.com/maps', 'https://google.com.evil.test/maps', 'https://user:secret@google.com/maps', 'https://127.0.0.1/maps', 'https://google.com:8443/maps', 'file:///etc/passwd']) {
    await assert.rejects(resolveInput(input), LookupError);
  }
  await assert.rejects(resolveInput('../bad', 'place-id'), LookupError);
});

test('shortlink redirects remain allowlisted and Google fallback tokens are not searched', async () => {
  await assert.rejects(resolveInput('https://share.google/example', 'link', async () => new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } })), /Only HTTPS Google/);
  await assert.rejects(resolveInput('https://share.google/example', 'link', async () => new Response(null, { status: 302, headers: { location: 'https://www.google.com/share.google?q=example' } })), /did not resolve to a business/);
  assert.deepEqual(await resolveInput('https://maps.app.goo.gl/example', 'link', async () => new Response(null, { status: 302, headers: { location: `https://www.google.com/maps?query_place_id=${placeId}` } })), { placeId });
});

test('Place Details uses headers for credentials and returns only normalized fields', async () => {
  const result = await lookupBusiness(placeId, 'place-id', 'test-only-secret', async (url, options) => {
    assert.equal(url, `https://places.googleapis.com/v1/places/${placeId}`);
    assert.equal(options.headers['X-Goog-Api-Key'], 'test-only-secret');
    assert.ok(!options.headers['X-Goog-FieldMask'].includes('reviews'));
    return Response.json({ id: placeId, displayName: { text: 'Sample Studio' }, addressComponents: [{ types: ['locality'], longText: 'Bengaluru' }], secret: 'not exposed' });
  });
  assert.equal(result.results[0].city, 'Bengaluru');
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('text search handles empty results and limits requested results', async () => {
  const result = await lookupBusiness('Sample Studio Bengaluru', 'name', 'test-only-secret', async (url, options) => {
    assert.equal(url, 'https://places.googleapis.com/v1/places:searchText');
    assert.equal(JSON.parse(options.body).pageSize, 3);
    return Response.json({});
  });
  assert.deepEqual(result.results, []);
});

test('Google failures and shortlink timeouts are sanitized', async () => {
  await assert.rejects(lookupBusiness(placeId, 'place-id', 'test-only-secret', async () => Response.json({ error: 'secret upstream response' }, { status: 403 })), /rejected this key/);
  await assert.rejects(lookupBusiness('https://share.google/example', 'link', 'test-only-secret', async () => { throw new Error('secret transport detail'); }), /timed out or could not connect/);
});

test('content validation requires rights and rejects unsafe contact/image values', () => {
  assert.equal(siteSchema.safeParse({ ...sample, rightsConfirmed: false }).success, false);
  assert.equal(siteSchema.safeParse({ ...sample, whatsapp: 'javascript:alert(1)' }).success, false);
  assert.equal(siteSchema.safeParse({ ...sample, imageId: '../../private' }).success, false);
  assert.equal(siteSchema.safeParse({ ...sample, services: [] }).success, false);
  assert.equal(siteSchema.parse({ ...sample, googleResponse: 'must not persist' }).googleResponse, undefined);
});

test('static renderer escapes content and JSON-LD while preserving noindex', async () => {
  const content = siteSchema.parse({ ...sample, source: 'owner', name: '<script>alert(1)</script>', description: '</script><script>alert(2)</script> supplied description.' });
  const html = renderHtml(content, { id: randomUUID() }, await readFile(path.join(root, 'templates/business.hbs'), 'utf8'));
  assert.ok(!html.includes('<script>alert('));
  assert.match(html, /&lt;script&gt;/);
  const structured = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(structured).name, content.name);
  assert.match(html, /content="noindex,nofollow"/);
  assert.match(html, /class="service-index">01</);
  assert.throws(() => releasePath({ dataDir: '.' }, '../outside', 1));
});

async function fixture(t, overrides = {}, dependencies = {}) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'proto1-test-'));
  const config = { root, dataDir, dev: true, port: 0, googleKey: 'test-only-secret', keySource: 'test', adminUsername: 'admin', adminPassword: '', adminOrigin: '', siteBaseDomain: '', publicDeployEnabled: false, lookupDailyLimit: 2, ...overrides };
  const app = createApp(config, dependencies);
  app.use(errors);
  const server = await new Promise((resolve) => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  t.after(async () => {
    await app.locals.jobs.drain();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    app.locals.store.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(dataDir).startsWith('proto1-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { app, base, config, post: (route, body = {}, headers = {}) => fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }) };
}

test('HTTP workflow generates independent static files, retries safely and regenerates', async (t) => {
  const { app, base, post } = await fixture(t);
  const key = randomUUID();
  const response = await post('/api/sites', sample, { 'Idempotency-Key': key });
  assert.equal(response.status, 202);
  const { site } = await response.json();
  await app.locals.jobs.drain();
  const details = await (await fetch(`${base}/api/sites/${site.id}`)).json();
  assert.equal(details.site.status, 'ready');
  assert.equal(details.site.deployedUrl, null);
  assert.equal(details.site.version, 1);
  const preview = await fetch(base + details.site.previewUrl);
  const html = await preview.text();
  assert.equal(preview.status, 200);
  assert.match(preview.headers.get('x-robots-tag'), /noindex/);
  assert.match(html, /Sample Studio/);
  assert.ok(!html.includes('/src/') && !html.includes('/api/lookup'));
  assert.match(await (await fetch(base + details.site.previewUrl + 'style.css')).text(), /\.hero/);
  const hero = await fetch(base + details.site.previewUrl + 'hero.webp');
  assert.equal(hero.status, 200);
  assert.ok((await hero.arrayBuffer()).byteLength > 1000);
  const repeated = await (await post('/api/sites', sample, { 'Idempotency-Key': key })).json();
  assert.equal(repeated.site.id, site.id);
  assert.equal(app.locals.store.list().length, 1);
  assert.equal((await post(`/api/sites/${site.id}/publish`)).status, 409);
  await post(`/api/sites/${site.id}/generate`);
  await app.locals.jobs.drain();
  assert.equal(app.locals.store.get(site.id).version, 2);
  assert.equal(app.locals.store.get(site.id).slug, site.slug);
  await post(`/api/sites/${site.id}/shared`);
  assert.equal(app.locals.store.get(site.id).shared, 1);
});

test('HTTP rejects cross-origin writes, unknown hosts and invalid content', async (t) => {
  const { base, post } = await fixture(t);
  assert.equal((await post('/api/sites', sample, { Origin: 'https://untrusted.test' })).status, 403);
  const unknownHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(base + '/api/config', { headers: { Host: 'untrusted.test' } }, (response) => { response.resume(); resolve(response.statusCode); });
    request.on('error', reject);
    request.end();
  });
  assert.equal(unknownHostStatus, 421);
  assert.equal((await post('/api/sites', { ...sample, rightsConfirmed: false })).status, 400);
  assert.equal((await post('/api/sites', sample, { 'Idempotency-Key': '../../bad' })).status, 400);
  const config = await (await fetch(base + '/api/config')).text();
  assert.ok(!config.includes('test-only-secret'));
});

test('Google lookup responses are ephemeral and enforce the daily limit', async (t) => {
  const { app, post } = await fixture(t, {}, { googleFetch: async () => Response.json({ id: placeId, displayName: { text: 'Ephemeral business' } }) });
  for (let i = 0; i < 2; i++) assert.equal((await post('/api/lookup', { input: placeId, kind: 'place-id' })).status, 200);
  assert.equal((await post('/api/lookup', { input: placeId, kind: 'place-id' })).status, 429);
  assert.equal(app.locals.store.list().length, 0);
  assert.equal(app.locals.store.usage(), 2);
});

test('image upload converts a real bitmap and the generated site serves it', async (t) => {
  const { app, base, post } = await fixture(t);
  const form = new FormData();
  form.append('image', new Blob([await readFile(path.join(root, 'public/assets/illustrative-interior.webp'))], { type: 'image/webp' }), 'sample.webp');
  const upload = await fetch(base + '/api/assets', { method: 'POST', body: form });
  assert.equal(upload.status, 201);
  const asset = await upload.json();
  const { site } = await (await post('/api/sites', { ...sample, imageId: asset.id })).json();
  await app.locals.jobs.drain();
  assert.equal((await fetch(`${base}/preview/${site.slug}/hero.webp`)).status, 200);
});
