import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import sharp from 'sharp';
import path from 'node:path';
import { mkdir, access } from 'node:fs/promises';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { openStore } from './store.js';
import { createJobs } from './jobs.js';
import { lookupBusiness, LookupError } from './places.js';
import { siteSchema, lookupSchema, publicSite } from './schema.js';
import { releasePath } from './renderer.js';
import { createLiveGoogle } from './live-google.js';
import { generateCopy, AIError } from './ai.js';
import { deployStaging, stagingConfigured, stagingRequest } from './staging.js';

const equals = (left, right) => timingSafeEqual(createHash('sha256').update(left).digest(), createHash('sha256').update(right).digest());
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;

async function verifyAssets(config, content) {
  const ids = [content.imageId, content.logoId, ...content.gallery.map((image) => image.imageId)].filter(Boolean);
  for (const id of new Set(ids)) await access(path.join(config.dataDir, 'uploads', `${id}.webp`));
}

export function createApp(config, dependencies = {}) {
  const app = express();
  const store = openStore(config.dataDir);
  const jobs = createJobs(store, config, dependencies);
  const live = createLiveGoogle(config, store, dependencies.googleFetch);
  const aiBusy = new Set();
  const stagingBusy = new Set();
  app.locals.store = store;
  app.locals.jobs = jobs;
  app.disable('x-powered-by');
  if (!config.dev) app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: config.dev ? false : { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com', 'https://*.gstatic.com'], frameSrc: ["'self'"], objectSrc: ["'none'"], baseUri: ["'none'"] } }, crossOriginEmbedderPolicy: false, strictTransportSecurity: config.dev ? false : undefined }));

  // Customer hostnames can only serve published artifacts, never admin/API routes.
  app.use((req, res, next) => {
    const host = req.hostname.toLowerCase();
    if (config.siteBaseDomain && host.endsWith(`.${config.siteBaseDomain}`)) {
      const slug = host.slice(0, -config.siteBaseDomain.length - 1);
      if (!/^[a-z0-9-]{1,63}$/.test(slug) || !['GET', 'HEAD'].includes(req.method)) return res.sendStatus(404);
      const site = store.bySlug(slug);
      if (!config.publicDeployEnabled || !site?.active_version) return res.status(404).send('Website not published.');
      res.set('Cache-Control', 'no-cache');
      return express.static(releasePath(config, site.id, site.active_version), { dotfiles: 'deny', index: 'index.html', fallthrough: false })(req, res, next);
    }
    const allowedHosts = new Set(config.dev ? ['localhost', '127.0.0.1'] : [new URL(config.adminOrigin).hostname]);
    if (!allowedHosts.has(host)) return res.status(421).send('Unknown application host.');
    next();
  });

  app.use(rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use((req, res, next) => {
    if (config.dev && !config.adminPassword) return next();
    const authorization = req.get('authorization') || '';
    const supplied = authorization.startsWith('Basic ') ? Buffer.from(authorization.slice(6), 'base64').toString('utf8') : '';
    if (!equals(supplied, `${config.adminUsername}:${config.adminPassword}`)) {
      res.set('WWW-Authenticate', 'Basic realm="Proto_1", charset="UTF-8"');
      return res.status(401).send('Sign in to Proto_1.');
    }
    next();
  });
  app.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.get('origin');
      const localOrigins = [`http://127.0.0.1:${config.port}`, `http://localhost:${config.port}`];
      if (origin && !(config.dev ? localOrigins : [config.adminOrigin]).includes(origin)) return res.status(403).json({ error: 'Cross-origin write rejected.' });
    }
    next();
  });
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/config', (_req, res) => res.json({
    googleConfigured: Boolean(config.googleKey), googleKeySource: config.keySource,
    publicDeployEnabled: config.publicDeployEnabled, siteBaseDomain: config.siteBaseDomain,
    environment: config.dev ? 'Local development' : 'VPS',
    lookupDailyLimit: config.lookupDailyLimit, lookupsToday: store.usage(),
    aiConfigured: Boolean(config.openRouterKey), writerModel: config.writerModel,
    repairModel: config.repairModel, aiDailyBudget: config.aiDailyBudget,
    aiSpentToday: store.aiSpend(),
    stagingConfigured: stagingConfigured(config), stagingOrigin: config.stagingOrigin || '',
  }));
  app.post('/api/lookup', rateLimit({ windowMs: 60000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const body = lookupSchema.parse(req.body);
    if (!config.googleKey) throw new LookupError('Google API key is not configured.', 503);
    if (!store.consumeLookup(config.lookupDailyLimit)) throw new LookupError('Daily lookup limit reached.', 429);
    res.json(await lookupBusiness(body.input, body.kind, config.googleKey, dependencies.googleFetch));
  });

  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
  app.post('/api/assets', upload.single('image'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Choose a JPG, PNG or WebP image.' });
    const image = sharp(req.file.buffer, { limitInputPixels: 25000000, animated: false });
    const metadata = await image.metadata();
    if (!['jpeg', 'png', 'webp'].includes(metadata.format)) return res.status(400).json({ error: 'Only JPG, PNG and WebP images are accepted.' });
    const id = randomUUID();
    const directory = path.join(config.dataDir, 'uploads');
    await mkdir(directory, { recursive: true });
    await image.rotate().resize({ width: 1800, height: 1400, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84 }).toFile(path.join(directory, `${id}.webp`));
    res.status(201).json({ id, url: `/api/assets/${id}` });
  });
  app.get('/api/assets/:id', (req, res) => {
    if (!uuid.test(req.params.id)) return res.sendStatus(404);
    res.sendFile(path.join(config.dataDir, 'uploads', `${req.params.id}.webp`));
  });

  app.get('/api/sites', (_req, res) => res.json({ sites: store.list().map((row) => publicSite(row, config)) }));
  app.post('/api/reference-drafts', (req, res) => {
    const { input: placeId } = lookupSchema.parse({ input: req.body.placeId, kind: 'place-id' });
    if (!/^[\w-]{8,255}$/.test(placeId)) throw new LookupError('Invalid Place ID.');
    const key = req.get('idempotency-key') || randomUUID();
    if (!uuid.test(key)) throw new LookupError('Invalid request identifier.');
    const previous = store.byKey(key);
    if (previous && (JSON.parse(previous.content).placeId !== placeId || JSON.parse(previous.content).source !== 'reference')) throw new LookupError('This request identifier belongs to a different draft.', 409);
    if (previous) return res.json({ site: publicSite(previous, config) });
    const content = siteSchema.parse({ name: 'Google business preview', category: 'Business profile', city: '', description: '', services: [], placeId, source: 'reference', rightsConfirmed: true, liveGoogle: true, template: 'signature', illustrativeImage: false });
    const site = store.create(content, key);
    jobs.enqueue(site.id);
    res.status(202).json({ site: publicSite(store.get(site.id), config) });
  });
  app.post('/api/sites', async (req, res) => {
    const content = siteSchema.parse(req.body);
    const key = req.get('idempotency-key') || randomUUID();
    if (!uuid.test(key)) return res.status(400).json({ error: 'Invalid request identifier.' });
    const previous = store.byKey(key);
    if (previous) return res.json({ site: publicSite(previous, config) });
    await verifyAssets(config, content);
    const site = store.create(content, key);
    jobs.enqueue(site.id);
    res.status(202).json({ site: publicSite(store.get(site.id), config) });
  });
  app.get('/api/sites/:id', (req, res) => {
    const site = store.get(req.params.id);
    if (!site) return res.sendStatus(404);
    res.json({ site: publicSite(site, config), events: store.events(site.id), staging: store.staging(site.id), stagingBusy: stagingBusy.has(site.id) });
  });
  app.patch('/api/sites/:id', async (req, res) => {
    const site = store.get(req.params.id);
    if (!site) return res.sendStatus(404);
    if (jobs.isBusy(site.id) || stagingBusy.has(site.id) || req.body.expectedVersion !== site.version) return res.status(409).json({ error: 'The preview changed or is generating/deploying. Reload the saved version before saving.' });
    const content = siteSchema.parse(req.body.content);
    await verifyAssets(config, content);
    if (jobs.isBusy(site.id) || stagingBusy.has(site.id) || store.get(site.id).version !== req.body.expectedVersion) return res.status(409).json({ error: 'The preview changed while saving. Reload the saved version.' });
    store.update(site.id, { content: JSON.stringify(content) });
    store.event(site.id, 'edited', 'Content/design updated. Creating a new preview release.');
    jobs.enqueue(site.id);
    res.json({ site: publicSite(store.get(site.id), config) });
  });
  app.post('/api/sites/:id/ai', rateLimit({ windowMs: 60000, limit: 4, standardHeaders: 'draft-8', legacyHeaders: false }), async (req, res) => {
    const site = store.get(req.params.id);
    if (!site) return res.sendStatus(404);
    const key = req.get('idempotency-key');
    if (!uuid.test(key || '')) throw new AIError('A unique request identifier is required.');
    if (aiBusy.has(site.id)) throw new AIError('An AI request is already running for this website.', 409);
    aiBusy.add(site.id);
    try { res.json(await generateCopy(store, config, site.id, key, req.body, dependencies.aiFetch)); }
    finally { aiBusy.delete(site.id); }
  });
  app.post('/api/sites/:id/staging', async (req, res) => {
    const site = store.get(req.params.id);
    if (!site) return res.sendStatus(404);
    if (!stagingConfigured(config)) return res.status(409).json({ error: 'Test deployment is not connected yet.' });
    if (jobs.isBusy(site.id) || stagingBusy.has(site.id)) return res.status(409).json({ error: 'This website already has an active job.' });
    const input = stagingRequest.parse(req.body);
    if (site.version !== input.expectedVersion) return res.status(409).json({ error: 'Review the latest release before publishing.' });
    stagingBusy.add(site.id);
    store.event(site.id, 'staging_started', `Preparing reviewed release ${site.version} for protected staging.`);
    try {
      const result = await deployStaging(config, site, input, dependencies.stagingFetch);
      store.recordStaging(site.id, result); store.event(site.id, 'staging_ready', `Protected release ${site.version} verified and activated.`);
      res.json({ staging: result });
    } catch {
      store.event(site.id, 'staging_failed', 'Test deployment did not finish. Review DNS, HTTPS, gateway access and Google configuration before retrying.');
      res.status(502).json({ error: 'Test deployment could not be confirmed. Retry the same reviewed release; existing releases are retained.' });
    } finally { stagingBusy.delete(site.id); }
  });
  app.post('/api/sites/:id/:action', (req, res) => {
    const site = store.get(req.params.id);
    if (!site) return res.sendStatus(404);
    const action = req.params.action;
    if (jobs.isBusy(site.id) || stagingBusy.has(site.id)) return res.status(409).json({ error: 'A job is already running for this website.' });
    if (action === 'generate') jobs.enqueue(site.id);
    else if (action === 'publish') {
      const content = JSON.parse(site.content);
      if (!config.publicDeployEnabled) return res.status(409).json({ error: 'VPS publishing is not configured yet.' });
      if (!site.version || !content.publicationAuthorized || ['demo', 'reference'].includes(content.source) || content.liveGoogle) return res.status(400).json({ error: 'Live Google sites require a separately approved deployment integration. Reference/demo drafts cannot be published.' });
      jobs.enqueue(site.id, 'publish');
    } else if (action === 'unpublish') {
      store.update(site.id, { active_version: 0, status: site.version ? 'ready' : 'failed' });
      store.event(site.id, 'unpublished', 'Public website disabled. The internal preview remains available.');
    } else if (action === 'shared') {
      store.update(site.id, { shared: site.shared ? 0 : 1 });
      store.event(site.id, 'sharing', site.shared ? 'Marked as not shared.' : 'Marked as manually shared. No message was sent automatically.');
    } else return res.sendStatus(404);
    res.json({ site: publicSite(store.get(site.id), config) });
  });
  app.get('/preview/:slug/google.json', async (req, res) => {
    const site = store.bySlug(req.params.slug);
    if (!site?.version) return res.sendStatus(404);
    res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex' });
    res.json(await live.profile(site));
  });
  app.get('/preview/:slug/google-photo/:token', async (req, res) => {
    const site = store.bySlug(req.params.slug);
    if (!site?.version) return res.sendStatus(404);
    const image = await live.photo(site, req.params.token, req.query.w);
    res.set({ 'Cache-Control': 'private, no-store', 'Content-Type': image.type, 'X-Robots-Tag': 'noindex' });
    res.send(image.bytes);
  });
  app.use('/preview/:slug', (req, res, next) => {
    const site = store.bySlug(req.params.slug);
    if (!site?.version) return res.status(404).send('Preview not available yet.');
    if (req.baseUrl === req.originalUrl) return res.redirect(302, `${req.baseUrl}/`);
    res.set('Cache-Control', 'no-store');
    res.set('X-Robots-Tag', 'noindex, nofollow');
    return express.static(releasePath(config, site.id, site.version), { dotfiles: 'deny', index: 'index.html', fallthrough: false })(req, res, next);
  });
  app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API endpoint.' }));
  return app;
}

export function errors(error, _req, res, _next) {
  if (error.name === 'ZodError') return res.status(400).json({ error: error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ') });
  if (error instanceof LookupError) return res.status(error.status).json({ error: error.message });
  if (error instanceof AIError) return res.status(error.status).json({ error: error.message });
  if (error instanceof multer.MulterError) return res.status(400).json({ error: 'Image is too large. Maximum size is 8 MB.' });
  if (error.status === 404 || error.code === 'ENOENT') return res.status(404).json({ error: 'The requested file or image was not found.' });
  if (error instanceof SyntaxError && 'body' in error) return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error('Request failed:', error.name, error.code || 'internal');
  res.status(500).json({ error: 'The request could not be completed. Check the input and retry.' });
}
