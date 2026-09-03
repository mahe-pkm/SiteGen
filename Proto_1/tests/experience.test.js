import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { root } from '../server/config.js';
import { createApp, errors } from '../server/app.js';
import { openStore } from '../server/store.js';
import { emptyCopy, siteSchema } from '../server/schema.js';
import { generateCopy, validateCopy, writeCopy, aiInputSchema } from '../server/ai.js';
import { createLiveGoogle } from '../server/live-google.js';
import { renderEventHtml } from '../server/event-renderer.js';
import { releasePath } from '../server/renderer.js';

const placeId = 'ChIJTestReference12345678';
const brief = 'Fictional Willow Studio provides floral styling and venue coordination. Consultations are by appointment. Pricing follows consultation.';
const input = { brief, source: 'demo', permissionConfirmed: true };
const goodCopy = { ...emptyCopy, headline: 'Floral styling and venue coordination', intro: 'Fictional Willow Studio provides floral styling and venue coordination.', heroEvidence: 'Fictional Willow Studio provides floral styling and venue coordination.', services: [{ title: 'Floral styling', description: 'Floral styling for your gathering.', evidence: 'provides floral styling and venue coordination' }] };
const aiConfig = { openRouterKey: 'secret-test-key', writerModel: 'writer-test', repairModel: 'repair-test', aiDailyBudget: 1, aiJobBudget: 0.5 };
const reference = siteSchema.parse({ name: 'Google business preview', category: 'Business profile', city: '', description: '', services: [], placeId, source: 'reference', liveGoogle: true, template: 'events', illustrativeImage: false, rightsConfirmed: true });
const googlePlace = { id: placeId, displayName: { text: 'EPHEMERAL GOOGLE BUSINESS' }, internationalPhoneNumber: '+91 9000000000', primaryTypeDisplayName: { text: 'Event planner' }, formattedAddress: 'EPHEMERAL STREET', addressComponents: [{ types: ['locality'], longText: 'Bengaluru' }], googleMapsUri: 'https://maps.google.com/example', rating: 4.9, userRatingCount: 123, photos: [{ name: `places/${placeId}/photos/test-photo`, authorAttributions: [{ displayName: 'Photo Author', uri: 'https://maps.google.com/author' }] }], reviews: [{ authorAttribution: { displayName: 'Review Author', uri: 'https://maps.google.com/reviewer' }, text: { text: 'EPHEMERAL REVIEW', languageCode: 'en' }, rating: 5, googleMapsUri: 'https://maps.google.com/review' }] };
const completion = (copy, cost = 0.004) => Response.json({ model: 'writer-test', choices: [{ message: { content: JSON.stringify(copy) } }], usage: { cost } });

async function temporary(t) {
  return mkdtemp(path.join(os.tmpdir(), 'proto1-experience-'));
}
async function cleanup(dir) {
  assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(dir).startsWith('proto1-experience-'));
  await rm(dir, { recursive: true, force: true });
}
async function fixture(t, overrides = {}, dependencies = {}) {
  const dataDir = await temporary(t);
  const config = { root, dataDir, dev: true, port: 0, googleKey: 'google-secret', keySource: 'test', adminUsername: 'admin', adminPassword: '', adminOrigin: '', siteBaseDomain: '', publicDeployEnabled: false, lookupDailyLimit: 20, photoDailyLimit: 10, ...aiConfig, ...overrides };
  const app = createApp(config, dependencies); app.use(errors);
  const server = await new Promise((resolve) => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  config.port = server.address().port;
  const base = `http://127.0.0.1:${config.port}`;
  const send = (url, body, method = 'POST', key = randomUUID()) => fetch(base + url, { method, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key }, body: JSON.stringify(body) });
  t.after(async () => { await app.locals.jobs.drain(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); app.locals.store.close(); await cleanup(dataDir); });
  return { app, config, base, send };
}

test('reference drafts reject copied identity and cannot opt into indexing', () => {
  assert.equal(siteSchema.safeParse({ ...reference, name: googlePlace.displayName.text }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, address: googlePlace.formattedAddress }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, indexable: true }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, publicationAuthorized: true }).success, false);
  assert.equal(siteSchema.safeParse({ ...reference, liveGoogle: false }).success, false);
});

test('event renderer escapes copy, includes live bindings, and excludes internal evidence', async () => {
  const html = renderEventHtml({ ...reference, copy: { ...goodCopy, headline: '<script>alert(1)</script>' } }, { id: randomUUID() }, await readFile(path.join(root, 'templates/events.hbs'), 'utf8'));
  assert.match(html, /data-live="name"/); assert.match(html, /site\.js/);
  assert.match(html, /&lt;script&gt;/); assert.ok(!html.includes('<script>alert'));
  assert.ok(!html.includes('heroEvidence')); assert.ok(!html.includes('EPHEMERAL'));
  assert.match(html, /noindex,nofollow/);
});

test('live profile and signed images work without persisting Google content', async (t) => {
  const googleFetch = async (url, options) => {
    if (String(url).includes('/media?')) return Response.json({ photoUri: 'https://lh3.googleusercontent.com/test-image' });
    if (String(url).includes('googleusercontent')) return new Response(new Uint8Array([1, 2, 3]), { headers: { 'Content-Type': 'image/jpeg' } });
    assert.ok(options.headers['X-Goog-FieldMask'].includes('reviews'));
    assert.ok(!options.headers['X-Goog-FieldMask'].includes('editorialSummary'));
    return Response.json(googlePlace);
  };
  const { app, config, base, send } = await fixture(t, {}, { googleFetch });
  const { site } = await (await send('/api/reference-drafts', { placeId })).json();
  await app.locals.jobs.drain();
  const url = `/preview/${site.slug}/`;
  const response = await fetch(base + url + 'google.json');
  assert.equal(response.status, 200); assert.match(response.headers.get('cache-control'), /no-store/);
  const profile = await response.json();
  assert.equal(profile.name, googlePlace.displayName.text);
  assert.equal(profile.photos[0].authors[0].name, 'Photo Author');
  assert.equal(profile.reviews[0].author, 'Review Author');
  assert.equal(profile.photos[0].resource, undefined);
  assert.ok(!JSON.stringify(profile).includes('google-secret'));
  const image = await fetch(new URL(profile.photos[0].url, base + url));
  assert.equal(image.status, 200); assert.match(image.headers.get('cache-control'), /no-store/);
  assert.equal((await image.arrayBuffer()).byteLength, 3);
  assert.equal((await fetch(base + url + 'google-photo/tampered')).status, 400);
  const row = app.locals.store.get(site.id);
  assert.equal(JSON.parse(row.content).name, 'Google business preview');
  assert.ok(!row.content.includes('EPHEMERAL'));
  const html = await readFile(path.join(releasePath(config, site.id, 1), 'index.html'), 'utf8');
  assert.ok(!html.includes('EPHEMERAL')); assert.ok(!html.includes('google-secret'));
  assert.equal((await send(`/api/sites/${site.id}/publish`, {})).status, 409);
});

test('photo tokens reject cross-site, tampering, and arbitrary upstream hosts', async (t) => {
  const dir = await temporary(t); const store = openStore(dir); t.after(async () => { store.close(); await cleanup(dir); });
  const site = store.create(reference, randomUUID()); const other = store.create(reference, randomUUID());
  let calls = 0;
  const live = createLiveGoogle({ googleKey: 'test', lookupDailyLimit: 2, photoDailyLimit: 2 }, store, async (url) => {
    calls++;
    return String(url).includes('/media?') ? Response.json({ photoUri: 'https://127.0.0.1/private' }) : Response.json(googlePlace);
  });
  const profile = await live.profile(site);
  const token = profile.photos[0].url.split('/').at(-1);
  await assert.rejects(live.photo(other, token), /expired/);
  await assert.rejects(live.photo(site, token + '.extra'), /Invalid photo/);
  assert.equal(calls, 1);
  await assert.rejects(live.photo(site, token), /host is not supported/);
  assert.equal(calls, 2);
});

test('expired photo tokens and a zero photo quota make no media requests', async (t) => {
  const dir = await temporary(t); const store = openStore(dir); t.after(async () => { store.close(); await cleanup(dir); });
  const site = store.create(reference, randomUUID()); let calls = 0;
  const live = createLiveGoogle({ googleKey: 'test', lookupDailyLimit: 2, photoDailyLimit: 0 }, store, async () => { calls++; return Response.json(googlePlace); });
  const token = (await live.profile(site)).photos[0].url.split('/').at(-1);
  await assert.rejects(live.photo(site, token), /Daily Google photo limit/);
  const now = Date.now;
  try { Date.now = () => now() + 16 * 60000; await assert.rejects(live.photo(site, token), /expired/); }
  finally { Date.now = now; }
  assert.equal(calls, 1);
});

test('reference idempotency does not return a different business for a reused key', async (t) => {
  const { app, send } = await fixture(t); const key = randomUUID();
  const first = await (await send('/api/reference-drafts', { placeId }, 'POST', key)).json();
  await app.locals.jobs.drain();
  const repeated = await (await send('/api/reference-drafts', { placeId }, 'POST', key)).json();
  assert.equal(repeated.site.id, first.site.id);
  assert.equal((await send('/api/reference-drafts', { placeId: 'ChIJOtherReference12345678' }, 'POST', key)).status, 409);
  assert.equal(app.locals.store.list().length, 1);
});

test('editing creates a new immutable release and rejects stale saves', async (t) => {
  const { app, config, send } = await fixture(t);
  const { site } = await (await send('/api/reference-drafts', { placeId })).json();
  await app.locals.jobs.drain();
  const before = await readFile(path.join(releasePath(config, site.id, 1), 'index.html'), 'utf8');
  assert.equal((await send(`/api/sites/${site.id}`, { expectedVersion: 0, content: reference }, 'PATCH')).status, 409);
  const content = { ...reference, palette: 'rose', copy: goodCopy };
  assert.equal((await send(`/api/sites/${site.id}`, { expectedVersion: 1, content }, 'PATCH')).status, 200);
  await app.locals.jobs.drain();
  assert.equal(app.locals.store.get(site.id).version, 2);
  assert.equal(await readFile(path.join(releasePath(config, site.id, 1), 'index.html'), 'utf8'), before);
  assert.match(await readFile(path.join(releasePath(config, site.id, 2), 'index.html'), 'utf8'), /palette-rose/);
});

test('AI input requires explicit permission and excludes extra Google fields', () => {
  assert.equal(aiInputSchema.safeParse({ ...input, googleResponse: googlePlace }).success, false);
  assert.equal(aiInputSchema.safeParse({ ...input, permissionConfirmed: false }).success, false);
  assert.equal(aiInputSchema.safeParse({ ...input, brief: '' }).success, false);
});

test('copy validation rejects unsupported evidence, claims, numbers and executable markup', () => {
  assert.deepEqual(validateCopy(goodCopy, brief), []);
  assert.match(validateCopy({ ...goodCopy, heroEvidence: 'invented evidence' }, brief).join(' '), /supporting excerpt/);
  assert.match(validateCopy({ ...goodCopy, headline: 'Award-winning studio with 20 years of experience' }, brief).join(' '), /Unsupported/);
  assert.match(validateCopy({ ...goodCopy, headline: '5 events' }, brief + ' 150 events.').join(' '), /Unsupported number/);
  assert.match(validateCopy({ ...goodCopy, headline: '<script>alert(1)</script>' }, brief).join(' '), /Executable/);
});

test('AI sends only the independent brief with a private structured-output request', async () => {
  const result = await writeCopy(aiConfig, input, async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.Authorization, 'Bearer secret-test-key');
    const body = JSON.parse(options.body);
    assert.equal(body.response_format.json_schema.strict, true);
    assert.equal(body.provider.zdr, true); assert.equal(body.provider.data_collection, 'deny');
    const user = JSON.parse(body.messages[1].content);
    assert.equal(user.brief, brief); assert.ok(!options.body.includes('EPHEMERAL'));
    return completion(goodCopy);
  });
  assert.equal(result.attempts, 1); assert.equal(result.cost, 0.004);
});

test('AI repairs invalid content, stops after two repairs, and respects the job ceiling', async () => {
  const models = [];
  const result = await writeCopy(aiConfig, input, async (_url, options) => {
    models.push(JSON.parse(options.body).model);
    return completion(models.length === 1 ? { ...goodCopy, heroEvidence: 'wrong quote' } : goodCopy);
  });
  assert.deepEqual(models, ['writer-test', 'repair-test']); assert.equal(result.attempts, 2);
  let calls = 0;
  await assert.rejects(writeCopy(aiConfig, input, async () => { calls++; return completion({ invalid: true }); }), /after two repair attempts/);
  assert.equal(calls, 3);
  await assert.rejects(writeCopy({ ...aiConfig, aiJobBudget: 0.001 }, input, async () => { throw new Error('must not call'); }), /job budget/);
});

test('AI candidates do not overwrite saved content, reuse successful requests, and enforce daily budgets', async (t) => {
  const dir = await temporary(t); const store = openStore(dir); t.after(async () => { store.close(); await cleanup(dir); });
  const site = store.create(reference, randomUUID()); const key = randomUUID(); let calls = 0;
  const fetcher = async () => { calls++; return completion(goodCopy); };
  const first = await generateCopy(store, aiConfig, site.id, key, input, fetcher);
  assert.deepEqual(await generateCopy(store, aiConfig, site.id, key, input, fetcher), first);
  assert.equal(calls, 1); assert.equal(store.get(site.id).content, site.content);
  await assert.rejects(generateCopy(store, aiConfig, site.id, key, { ...input, brief: brief + ' Extra.' }, fetcher), /different draft/);
  await assert.rejects(generateCopy(store, { ...aiConfig, aiDailyBudget: 0.1 }, site.id, randomUUID(), input, fetcher), /Daily AI budget/);
  assert.equal(calls, 1);
});

test('AI failures retain a reservation and sanitize provider error text', async (t) => {
  const dir = await temporary(t); const store = openStore(dir); t.after(async () => { store.close(); await cleanup(dir); });
  const site = store.create(reference, randomUUID());
  await assert.rejects(generateCopy(store, aiConfig, site.id, randomUUID(), input, async () => Response.json({ error: 'secret-upstream-response' }, { status: 401 })), /rejected the configured key/);
  assert.equal(store.aiSpend(), 0.5);
  assert.ok(!JSON.stringify(store.events(site.id)).includes('secret-upstream'));
});

test('HTTP AI handles missing credentials and validation before making model calls', async (t) => {
  const { app, send } = await fixture(t, { openRouterKey: '' }, { aiFetch: async () => { throw new Error('must not call'); } });
  const { site } = await (await send('/api/reference-drafts', { placeId })).json();
  await app.locals.jobs.drain();
  assert.equal((await send(`/api/sites/${site.id}/ai`, input)).status, 503);
  assert.equal((await send(`/api/sites/${site.id}/ai`, { ...input, permissionConfirmed: false })).status, 400);
  assert.equal(app.locals.store.aiSpend(), 0);
});
