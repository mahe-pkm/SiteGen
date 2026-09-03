import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function loadConfig({ dev = false } = {}) {
  dotenv.config({ path: path.join(root, '.env'), quiet: true });
  let key = process.env.GOOGLE_MAPS_API_KEY || '';
  let keySource = key ? 'Proto_1 environment' : 'Not configured';
  const legacy = path.resolve(root, '..', 'app', '.env.local');
  if (dev && !key && existsSync(legacy)) {
    key = dotenv.parse(readFileSync(legacy)).GOOGLE_MAPS_API_KEY || '';
    if (key) keySource = 'Existing local environment';
  }
  const domain = (process.env.SITE_BASE_DOMAIN || '').trim().toLowerCase();
  if (domain && !/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) {
    throw new Error('SITE_BASE_DOMAIN must be a domain without a scheme or path.');
  }
  const config = {
    dev,
    root,
    dataDir: path.resolve(root, process.env.DATA_DIR || '.data'),
    port: Number(process.env.PORT || 3100),
    host: process.env.HOST || (dev ? '127.0.0.1' : '0.0.0.0'),
    googleKey: key,
    keySource,
    adminUsername: process.env.ADMIN_USERNAME || 'admin',
    adminPassword: process.env.ADMIN_PASSWORD || '',
    adminOrigin: process.env.ADMIN_ORIGIN || '',
    siteBaseDomain: domain,
    publicDeployEnabled: process.env.PUBLIC_DEPLOY_ENABLED === 'true' && Boolean(domain),
    stagingOrigin: (process.env.STAGING_ORIGIN || '').trim(),
    stagingToken: process.env.STAGING_DEPLOY_TOKEN || '',
    stagingUsername: process.env.STAGING_REVIEW_USERNAME || 'review',
    stagingPassword: process.env.STAGING_REVIEW_PASSWORD || '',
    lookupDailyLimit: Number(process.env.LOOKUP_DAILY_LIMIT || 100),
    photoDailyLimit: Number(process.env.PHOTO_DAILY_LIMIT || 300),
    openRouterKey: process.env.OPENROUTER_API_KEY || '',
    writerModel: process.env.AI_WRITER_MODEL || 'google/gemini-3.8-flash',
    repairModel: process.env.AI_REPAIR_MODEL || 'anthropic/claude-sonnet-5',
    aiDailyBudget: Number(process.env.AI_DAILY_BUDGET_USD || 5),
    aiJobBudget: Number(process.env.AI_JOB_BUDGET_USD || 0.5),
  };
  for (const field of ['lookupDailyLimit', 'photoDailyLimit', 'aiDailyBudget', 'aiJobBudget']) {
    if (!Number.isFinite(config[field]) || config[field] < 0) throw new Error(`${field} must be a finite nonnegative number.`);
  }
  if (!dev && (config.adminPassword.length < 20 || !/^https:\/\//.test(config.adminOrigin))) {
    throw new Error('Production requires an ADMIN_PASSWORD of at least 20 characters and an HTTPS ADMIN_ORIGIN.');
  }
  return config;
}
