import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function openStore(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'prototype.sqlite'));
  db.exec(`
    PRAGMA journal_mode=WAL;
    PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS sites (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, content TEXT NOT NULL,
      status TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
      active_version INTEGER NOT NULL DEFAULT 0, error TEXT NOT NULL DEFAULT '',
      shared INTEGER NOT NULL DEFAULT 0, request_key TEXT UNIQUE,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, site_id TEXT NOT NULL REFERENCES sites(id),
      type TEXT NOT NULL, message TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS usage (day TEXT PRIMARY KEY, lookups INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS photo_usage (day TEXT PRIMARY KEY, requests INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE IF NOT EXISTS staging_deployments (site_id TEXT PRIMARY KEY REFERENCES sites(id), result TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS ai_runs (
      id TEXT PRIMARY KEY, site_id TEXT NOT NULL REFERENCES sites(id), request_key TEXT NOT NULL UNIQUE,
      input_hash TEXT NOT NULL, day TEXT NOT NULL, status TEXT NOT NULL,
      reserved_usd REAL NOT NULL, actual_usd REAL, result TEXT, error TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
  `);
  // An interrupted job must be visible and retryable after a process restart.
  db.prepare("UPDATE sites SET status=CASE WHEN active_version > 0 THEN 'published' ELSE 'failed' END, error='The last job was interrupted. Retry generation.' WHERE status IN ('queued','generating','publishing')").run();
  db.prepare("UPDATE ai_runs SET status='failed', error='AI request interrupted. Its budget reservation was retained.' WHERE status='running'").run();
  const get = (id) => db.prepare('SELECT * FROM sites WHERE id=?').get(id);
  return {
    db,
    staging: (id) => { const row = db.prepare('SELECT result FROM staging_deployments WHERE site_id=?').get(id); return row ? JSON.parse(row.result) : null; },
    recordStaging: (id, result) => db.prepare('INSERT INTO staging_deployments(site_id,result) VALUES (?,?) ON CONFLICT(site_id) DO UPDATE SET result=excluded.result').run(id, JSON.stringify(result)),
    get,
    bySlug: (slug) => db.prepare('SELECT * FROM sites WHERE slug=?').get(slug),
    byKey: (key) => db.prepare('SELECT * FROM sites WHERE request_key=?').get(key),
    list: () => db.prepare('SELECT * FROM sites ORDER BY created_at DESC').all(),
    create(content, requestKey) {
      const id = randomUUID();
      const base = content.name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'business';
      const slug = `${base}-${id.slice(0, 6)}`;
      const now = new Date().toISOString();
      db.prepare('INSERT INTO sites (id,slug,content,status,request_key,created_at,updated_at) VALUES (?,?,?,?,?,?,?)').run(id, slug, JSON.stringify(content), 'queued', requestKey, now, now);
      return get(id);
    },
    update(id, fields) {
      const allowed = new Set(['status', 'version', 'active_version', 'error', 'shared', 'content']);
      const entries = Object.entries(fields).filter(([key]) => allowed.has(key));
      if (!entries.length) return get(id);
      db.prepare(`UPDATE sites SET ${entries.map(([key]) => `${key}=?`).join(',')}, updated_at=? WHERE id=?`).run(...entries.map(([, value]) => value), new Date().toISOString(), id);
      return get(id);
    },
    event(id, type, message) {
      db.prepare('INSERT INTO events (site_id,type,message,created_at) VALUES (?,?,?,?)').run(id, type, message, new Date().toISOString());
    },
    events: (id) => db.prepare('SELECT type,message,created_at AS createdAt FROM events WHERE site_id=? ORDER BY id DESC LIMIT 40').all(id),
    consumeLookup(limit) {
      const day = new Date().toISOString().slice(0, 10);
      db.prepare('INSERT OR IGNORE INTO usage (day,lookups) VALUES (?,0)').run(day);
      return db.prepare('UPDATE usage SET lookups=lookups+1 WHERE day=? AND lookups<?').run(day, limit).changes === 1;
    },
    usage: () => db.prepare('SELECT lookups FROM usage WHERE day=?').get(new Date().toISOString().slice(0, 10))?.lookups || 0,
    consumePhoto(limit) {
      const day = new Date().toISOString().slice(0, 10);
      db.prepare('INSERT OR IGNORE INTO photo_usage(day,requests) VALUES (?,0)').run(day);
      return db.prepare('UPDATE photo_usage SET requests=requests+1 WHERE day=? AND requests<?').run(day, limit).changes === 1;
    },
    aiSpend: () => db.prepare('SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) AS total FROM ai_runs WHERE day=?').get(new Date().toISOString().slice(0, 10)).total,
    aiByKey: (key) => db.prepare('SELECT * FROM ai_runs WHERE request_key=?').get(key),
    reserveAi(siteId, key, hash, reservation, dailyLimit) {
      const day = new Date().toISOString().slice(0, 10);
      const id = randomUUID();
      const result = db.prepare(`INSERT INTO ai_runs(id,site_id,request_key,input_hash,day,status,reserved_usd,created_at)
        SELECT ?,?,?,?,?,'running',?,? WHERE (SELECT COALESCE(SUM(COALESCE(actual_usd,reserved_usd)),0) FROM ai_runs WHERE day=?) + ? <= ?`).run(id, siteId, key, hash, day, reservation, new Date().toISOString(), day, reservation, dailyLimit);
      return result.changes ? id : null;
    },
    finishAi(id, result, cost, error = '') {
      db.prepare('UPDATE ai_runs SET status=?,result=?,actual_usd=?,error=? WHERE id=?').run(error ? 'failed' : 'complete', result ? JSON.stringify(result) : null, cost ?? null, error, id);
    },
    close: () => db.close(),
  };
}
