import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile, readFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { createStagingGateway, proxyConfiguration } from '../server/staging-gateway.js';
import { deployStaging, digest, stagingSlug } from '../server/staging.js';
import { createApp, errors } from '../server/app.js';
import { root } from '../server/config.js';

function hostFetch(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method: options.method || 'GET', headers: options.headers }, (res) => {
      const chunks = []; res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(options.body);
  });
}

async function fixture(t) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'proto1-staging-test-'));
  const config = { dataDir, stagingHost: 'preview.example.com', stagingToken: 'a'.repeat(40), stagingPassword: 'b'.repeat(30), stagingUsername: 'review', googleKey: 'not-a-real-key', lookupDailyLimit: 100, photoDailyLimit: 100, stagingOrigin: 'https://preview.example.com', stagingRetryDelay: 0 };
  let googleCalls = 0;
  const app = createStagingGateway(config, { googleFetch: async () => { googleCalls++; return Response.json({ id: 'ChIJFixture123456', displayName: { text: 'Ephemeral staging business' } }); } });
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const bearer = `Bearer ${config.stagingToken}`;
  const basic = `Basic ${Buffer.from(`${config.stagingUsername}:${config.stagingPassword}`).toString('base64')}`;
  const call = (url, { host = config.stagingHost, auth = bearer, body, ...options } = {}) => hostFetch(base + url, { ...options, headers: { Host: host, ...(auth ? { Authorization: auth } : {}), 'Content-Type': 'application/json' }, ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}) });
  const routedFetch = (url, options = {}) => { const u = new URL(url); return hostFetch(base + u.pathname, { ...options, headers: { ...options.headers, Host: u.hostname } }); };
  t.after(async () => {
    server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await app.locals.close();
    assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('proto1-staging-test-'));
    await rm(dataDir, { recursive: true, force: true });
  });
  return { config, call, basic, routedFetch, googleCalls: () => googleCalls };
}
function payload(id = randomUUID(), version = 1) {
  const files = [{ name: 'index.html', data: `<meta name="proto-site-id" content="${id}"><h1>Release ${version}</h1>` }, { name: 'style.css', data: '.hero{color:green}' }, { name: 'site.js', data: 'void 0;' }].map(({ name, data }) => ({ name, sha256: digest(data), data: Buffer.from(data).toString('base64') }));
  return { id, version, slug: stagingSlug('Fixture Store', id), liveGoogle: true, placeId: 'ChIJFixture123456', files };
}
test('staging requires strong credentials and generates isolated exact-host proxy routes', () => {
  assert.throws(() => createStagingGateway({ stagingHost: 'preview.example.com' }), /strong credentials/);
  const routes = proxyConfiguration(['preview.example.com', 'shop.preview.example.com']);
  assert.equal(Object.keys(routes.http.routers).length, 4);
  assert.equal(routes.http.routers['proto1-shop-preview-example-com'].rule, 'Host(`shop.preview.example.com`)');
  assert.equal(routes.http.routers['proto1-shop-preview-example-com'].tls.certResolver, 'letsencrypt');
  assert.equal(stagingSlug('Adhil Fashion', '12345678'), 'adhil-fashion-12345678');
});
test('staging upload, candidate verification and activation are separate and private', async (t) => {
  const f = await fixture(t); const p = payload(); const host = `${p.slug}.${f.config.stagingHost}`;
  assert.equal((await f.call('/internal/prepare', { body: p, auth: '' })).status, 401);
  assert.equal((await f.call('/internal/prepare', { body: p })).status, 200);
  assert.equal((await f.call('/', { host, auth: '' })).status, 401);
  assert.equal((await f.call('/', { host, auth: f.basic })).status, 404);
  const candidate = await f.call('/_releases/1/', { host, auth: f.basic }); assert.equal(candidate.status, 200); assert.match(await candidate.text(), /Release 1/);
  assert.match(candidate.headers.get('x-robots-tag'), /noindex/);
  assert.equal((await f.call('/internal/activate', { body: { id: p.id, version: 1, expectedActive: 0 } })).status, 200);
  assert.match(await (await f.call('/', { host, auth: f.basic })).text(), /Release 1/);
  for (const file of ['/api/sites', '/internal/health', '/.env', '/releases', '/%2e%2e/secrets.env']) assert.notEqual((await f.call(file, { host, auth: f.basic })).status, 200);
  assert.equal((await f.call('/internal/prepare', { host, auth: f.basic, body: p })).status, 405);
  const profile = await f.call('/google.json', { host, auth: f.basic }); assert.equal(profile.status, 200); assert.match(profile.headers.get('cache-control'), /no-store/); assert.equal(f.googleCalls(), 1);
  assert.doesNotMatch(await readFile(path.join(f.config.dataDir, 'releases', p.id, '1', 'index.html'), 'utf8'), /Ephemeral/);
});
test('staging rejects traversal, tampering, duplicate files, slug takeover and release replacement', async (t) => {
  const f = await fixture(t); const p = payload();
  for (const name of ['../secrets.env', '.env', 'assets/../../secret.txt', 'assets/.hidden.txt']) {
    const copy = structuredClone(p); copy.files[0].name = name; assert.equal((await f.call('/internal/prepare', { body: copy })).status, 400);
  }
  const bad = structuredClone(p); bad.files[0].sha256 = '0'.repeat(64); assert.equal((await f.call('/internal/prepare', { body: bad })).status, 400);
  const duplicate = structuredClone(p); duplicate.files.push(duplicate.files[0]); assert.equal((await f.call('/internal/prepare', { body: duplicate })).status, 400);
  assert.equal((await f.call('/internal/prepare', { body: p })).status, 200);
  assert.equal((await f.call('/internal/prepare', { body: p })).status, 200);
  const overwrite = structuredClone(p); overwrite.files[1] = { name: 'style.css', data: Buffer.from('changed').toString('base64'), sha256: digest('changed') };
  assert.equal((await f.call('/internal/prepare', { body: overwrite })).status, 409);
  const takeover = payload(); takeover.slug = p.slug; assert.equal((await f.call('/internal/prepare', { body: takeover })).status, 409);
});
test('staging keeps active release pinned through new uploads and refuses stale activation', async (t) => {
  const f = await fixture(t); const p = payload(); const host = `${p.slug}.${f.config.stagingHost}`;
  await f.call('/internal/prepare', { body: p }); await f.call('/internal/activate', { body: { id: p.id, version: 1, expectedActive: 0 } });
  await f.call('/internal/prepare', { body: payload(p.id, 2) });
  assert.match(await (await f.call('/', { host, auth: f.basic })).text(), /Release 1/);
  assert.equal((await f.call('/internal/activate', { body: { id: p.id, version: 2, expectedActive: 0 } })).status, 409);
  assert.equal((await f.call('/internal/activate', { body: { id: p.id, version: 2, expectedActive: 1 } })).status, 200);
  assert.match(await (await f.call('/', { host, auth: f.basic })).text(), /Release 2/);
});
test('publisher verifies every asset and Google before activation; failure preserves the active version', async (t) => {
  const f = await fixture(t); const p = payload();
  const local = path.join(f.config.dataDir, 'local'); const directory = path.join(local, 'artifacts', p.id, '1'); await mkdir(directory, { recursive: true });
  for (const file of p.files) await writeFile(path.join(directory, file.name), Buffer.from(file.data, 'base64'));
  const site = { id: p.id, version: 1, content: JSON.stringify({ source: 'reference', placeId: p.placeId, liveGoogle: true }) };
  const input = { expectedVersion: 1, label: 'Fixture Store', reviewConfirmed: true };
  const result = await deployStaging({ ...f.config, dataDir: local }, site, input, f.routedFetch);
  assert.equal(result.version, 1); assert.equal(result.access, 'password-protected');
  const dir2 = path.join(local, 'artifacts', p.id, '2'); await mkdir(dir2, { recursive: true });
  for (const file of payload(p.id, 2).files) await writeFile(path.join(dir2, file.name), Buffer.from(file.data, 'base64'));
  await assert.rejects(deployStaging({ ...f.config, dataDir: local }, { ...site, version: 2 }, { ...input, expectedVersion: 2 }, (url, options) => new URL(url).pathname.endsWith('site.js') ? Promise.resolve(new Response('tampered')) : f.routedFetch(url, options)), /verification failed/);
  assert.match(await (await f.call('/', { host: `${p.slug}.${f.config.stagingHost}`, auth: f.basic })).text(), /Release 1/);
});
test('local HTTP deployment requires configuration, review and an unchanged release', async (t) => {
  let closeBuilder = async () => {}; t.after(() => closeBuilder());
  const f = await fixture(t); const app = createApp({ ...f.config, root, dev: true, dataDir: path.join(f.config.dataDir, 'builder'), adminPassword: '', publicDeployEnabled: false }, { stagingFetch: f.routedFetch }); app.use(errors);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  closeBuilder = async () => { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); await app.locals.jobs.drain(); app.locals.store.close(); };
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (url, body) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const { site } = await (await post('/api/reference-drafts', { placeId: 'ChIJFixture123456' })).json(); await app.locals.jobs.drain();
  assert.equal((await post(`/api/sites/${site.id}/staging`, { expectedVersion: 1, label: 'Fixture', reviewConfirmed: false })).status, 400);
  assert.equal((await post(`/api/sites/${site.id}/staging`, { expectedVersion: 2, label: 'Fixture', reviewConfirmed: true })).status, 409);
  const response = await post(`/api/sites/${site.id}/staging`, { expectedVersion: 1, label: 'Fixture', reviewConfirmed: true }); assert.equal(response.status, 200);
  const detail = await (await fetch(base + `/api/sites/${site.id}`)).json(); assert.equal(detail.staging.version, 1); assert.equal(detail.site.deployedUrl, null); assert.equal(detail.site.content.publicationAuthorized, false);
  const cfg = await (await fetch(base + '/api/config')).text(); assert.doesNotMatch(cfg, new RegExp(f.config.stagingToken)); assert.doesNotMatch(cfg, new RegExp(f.config.stagingPassword));
});
