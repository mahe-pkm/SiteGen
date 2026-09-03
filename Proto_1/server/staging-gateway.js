import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { createHash, timingSafeEqual, randomUUID } from 'node:crypto';
import { mkdir, writeFile, rename, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { openStore } from './store.js';
import { createLiveGoogle } from './live-google.js';
import { digest, fileNamePattern } from './staging.js';

const uuid = z.string().uuid();
const version = z.number().int().positive().max(1000000);
const manifestSchema = z.object({
  id: uuid, version, slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/),
  placeId: z.string().regex(/^[\w-]{0,255}$/), liveGoogle: z.boolean(),
  files: z.array(z.object({ name: z.string().regex(fileNamePattern), sha256: z.string().regex(/^[a-f0-9]{64}$/), data: z.string().max(16 * 1024 * 1024) }).strict()).min(3).max(100),
}).strict();
const equal = (a, b) => timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest());

export function proxyConfiguration(hosts) {
  const routers = {};
  for (const host of hosts) {
    const key = `proto1-${host.replaceAll('.', '-')}`;
    routers[key] = { entryPoints: ['https'], rule: `Host(\`${host}\`)`, service: 'proto1-staging', tls: { certResolver: 'letsencrypt' } };
    routers[`${key}-http`] = { entryPoints: ['http'], rule: `Host(\`${host}\`)`, service: 'proto1-staging', middlewares: ['proto1-https'] };
  }
  return { http: { routers, services: { 'proto1-staging': { loadBalancer: { servers: [{ url: 'http://proto1-staging:3100' }] } } }, middlewares: { 'proto1-https': { redirectScheme: { scheme: 'https', permanent: true } } } } };
}

export function createStagingGateway(config, dependencies = {}) {
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(config.stagingHost) || !config.stagingToken || config.stagingToken.length < 32 || !config.stagingPassword || config.stagingPassword.length < 20 || !config.stagingUsername) throw new Error('Staging requires a hostname and strong credentials.');
  const app = express(); app.disable('x-powered-by');
  // The gateway is reachable publicly only through the single Traefik hop.
  app.set('trust proxy', 1);
  const store = openStore(config.dataDir);
  store.db.exec(`CREATE TABLE IF NOT EXISTS staging_sites (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, place_id TEXT NOT NULL, live_google INTEGER NOT NULL, active_version INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS staging_releases (site_id TEXT NOT NULL, version INTEGER NOT NULL, fingerprint TEXT NOT NULL, files TEXT NOT NULL, PRIMARY KEY(site_id,version));`);
  const get = (id) => store.db.prepare('SELECT * FROM staging_sites WHERE id=?').get(id);
  const release = (id, v) => store.db.prepare('SELECT * FROM staging_releases WHERE site_id=? AND version=?').get(id, v);
  const asLiveSite = (site) => ({ id: site.id, content: JSON.stringify({ placeId: site.place_id, liveGoogle: Boolean(site.live_google) }) });
  const live = createLiveGoogle(config, { ...store, get: (id) => { const site = get(id); return site && asLiveSite(site); } }, dependencies.googleFetch);
  const folder = (id, v) => path.join(config.dataDir, 'releases', id, String(v));
  let pending = Promise.resolve();
  const serialize = (work) => { const result = pending.then(work); pending = result.catch(() => {}); return result; };
  async function routes() {
    if (!config.routeFile) return;
    const hosts = [config.stagingHost, ...store.db.prepare('SELECT slug FROM staging_sites').all().map((s) => `${s.slug}.${config.stagingHost}`)];
    // Only this application's dedicated bind-mounted file is writable, never other proxy routes.
    await writeFile(config.routeFile, JSON.stringify(proxyConfiguration(hosts)), { mode: 0o644 });
  }
  app.locals.close = async () => { await pending; store.close(); };
  app.locals.refreshRoutes = routes;
  app.use(helmet({ contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", 'data:', 'https://*.googleusercontent.com', 'https://*.gstatic.com'], objectSrc: ["'none'"], baseUri: ["'none'"] } }, crossOriginEmbedderPolicy: false }));
  app.use((_req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'X-Robots-Tag': 'noindex, nofollow' }); next(); });
  // Read Host directly: never let a forwarded-host header select the administration surface.
  app.use((req, res, next) => {
    const host = (req.headers.host || '').split(':')[0].toLowerCase();
    req.stagingAdmin = host === config.stagingHost;
    if (!req.stagingAdmin) {
      if (!host.endsWith(`.${config.stagingHost}`)) return res.sendStatus(421);
      const slug = host.slice(0, -config.stagingHost.length - 1);
      req.stagingSite = store.db.prepare('SELECT * FROM staging_sites WHERE slug=?').get(slug);
      if (!req.stagingSite) return res.sendStatus(404);
    }
    next();
  });
  app.use(rateLimit({ windowMs: 60000, limit: 180, standardHeaders: 'draft-8', legacyHeaders: false }));
  app.use((req, res, next) => {
    const auth = req.get('authorization') || '';
    if (req.stagingAdmin && req.path.startsWith('/internal/')) {
      if (!equal(auth, `Bearer ${config.stagingToken}`)) return res.sendStatus(401);
    } else {
      if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
      const expected = `Basic ${Buffer.from(`${config.stagingUsername}:${config.stagingPassword}`).toString('base64')}`;
      if (!equal(auth, expected)) { res.set('WWW-Authenticate', 'Basic realm="Private website review", charset="UTF-8"'); return res.sendStatus(401); }
    }
    next();
  });
  app.use(express.json({ limit: '48mb' }));
  app.post('/internal/prepare', async (req, res) => {
    if (!req.stagingAdmin) return res.sendStatus(404);
    const input = manifestSchema.parse(req.body);
    if (input.liveGoogle && !input.placeId) return res.status(400).json({ error: 'Place ID required.' });
    const result = await serialize(async () => {
      const existing = get(input.id);
      if (existing && (existing.slug !== input.slug || existing.place_id !== input.placeId || Boolean(existing.live_google) !== input.liveGoogle)) throw new Error('identity_conflict');
      const slugOwner = store.db.prepare('SELECT id FROM staging_sites WHERE slug=?').get(input.slug);
      if (slugOwner && slugOwner.id !== input.id) throw new Error('identity_conflict');
      let total = 0; const names = new Set(); const decoded = [];
      for (const file of input.files) {
        const bytes = Buffer.from(file.data, 'base64'); total += bytes.length;
        if (file.data !== bytes.toString('base64') || digest(bytes) !== file.sha256 || names.has(file.name) || total > 32 * 1024 * 1024) throw new Error('invalid_release');
        names.add(file.name); decoded.push({ name: file.name, bytes });
      }
      if (!['index.html', 'style.css', 'site.js'].every((name) => names.has(name)) || !decoded.find((f) => f.name === 'index.html').bytes.toString().includes(`content="${input.id}"`)) throw new Error('invalid_release');
      const fingerprint = digest(JSON.stringify(input.files.map(({ name, sha256 }) => ({ name, sha256 })).sort((a, b) => a.name.localeCompare(b.name))));
      const prior = release(input.id, input.version);
      if (prior && prior.fingerprint !== fingerprint) throw new Error('immutable_release');
      if (!prior) {
        const temporary = path.join(config.dataDir, 'incoming', randomUUID());
        await mkdir(path.join(temporary, 'assets'), { recursive: true });
        for (const file of decoded) await writeFile(path.join(temporary, file.name), file.bytes, { flag: 'wx' });
        await mkdir(path.dirname(folder(input.id, input.version)), { recursive: true });
        try { await rename(temporary, folder(input.id, input.version)); }
        catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(error.code)) throw error;
          // Recover a completed directory left by a crash before the SQLite commit.
          const existingFiles = await readdir(folder(input.id, input.version), { recursive: true, withFileTypes: true });
          if (existingFiles.filter((entry) => entry.isFile()).length !== decoded.length) throw new Error('immutable_release');
          for (const file of input.files) if (digest(await readFile(path.join(folder(input.id, input.version), file.name))) !== file.sha256) throw new Error('immutable_release');
        }
        store.db.exec('BEGIN');
        try {
          store.db.prepare('INSERT OR IGNORE INTO staging_sites(id,slug,place_id,live_google) VALUES (?,?,?,?)').run(input.id, input.slug, input.placeId, Number(input.liveGoogle));
          store.db.prepare('INSERT INTO staging_releases(site_id,version,fingerprint,files) VALUES (?,?,?,?)').run(input.id, input.version, fingerprint, JSON.stringify([...names]));
          store.db.exec('COMMIT');
        } catch (error) { store.db.exec('ROLLBACK'); throw error; }
      }
      await routes();
      return { activeVersion: get(input.id).active_version, version: input.version };
    });
    res.json(result);
  });
  app.post('/internal/activate', async (req, res) => {
    if (!req.stagingAdmin) return res.sendStatus(404);
    const input = z.object({ id: uuid, version, expectedActive: z.number().int().nonnegative() }).strict().parse(req.body);
    await serialize(async () => {
      if (!release(input.id, input.version)) throw new Error('unknown_release');
      const site = get(input.id);
      if (site.active_version === input.version) return;
      if (site.active_version !== input.expectedActive) throw new Error('active_conflict');
      store.db.prepare('UPDATE staging_sites SET active_version=? WHERE id=?').run(input.version, input.id);
    });
    res.json({ version: input.version, active: true });
  });
  app.get('/internal/health', (req, res) => req.stagingAdmin ? res.json({ ok: true, googleConfigured: Boolean(config.googleKey), protected: true }) : res.sendStatus(404));
  app.use(async (req, res, next) => {
    if (req.stagingAdmin) return req.path === '/' ? res.type('text').send('Private Proto_1 staging gateway. Publish reviewed releases from the local builder.') : res.sendStatus(404);
    const site = req.stagingSite;
    const candidate = req.path.match(/^\/_releases\/([1-9]\d{0,6})(\/.*)?$/);
    const v = candidate ? Number(candidate[1]) : site.active_version;
    if (!v) return res.sendStatus(404);
    if (candidate && !candidate[2]) return res.redirect(302, req.path + '/');
    const rel = release(site.id, v); if (!rel) return res.sendStatus(404);
    const file = (candidate ? candidate[2] : req.path).slice(1) || 'index.html';
    if (file === 'google.json') return res.json(await live.profile(asLiveSite(site)));
    if (file.startsWith('google-photo/')) {
      const image = await live.photo(asLiveSite(site), file.slice('google-photo/'.length), req.query.w);
      return res.type(image.type).send(image.bytes);
    }
    if (!JSON.parse(rel.files).includes(file)) return res.sendStatus(404);
    res.sendFile(path.join(folder(site.id, v), file), { dotfiles: 'deny' }, (error) => { if (error) next(error); });
  });
  app.use((error, _req, res, _next) => {
    const invalid = error.name === 'ZodError' || error.message === 'invalid_release';
    res.status(invalid ? 400 : error.status || 409).json({ error: invalid ? 'Invalid release package.' : 'Staging request failed. The existing active release was preserved.' });
  });
  return app;
}
