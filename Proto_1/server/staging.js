import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { releasePath } from './renderer.js';

export const stagingRequest = z.object({
  expectedVersion: z.number().int().positive(),
  label: z.string().trim().min(2).max(80),
  reviewConfirmed: z.literal(true),
}).strict();
export const fileNamePattern = /^(?:index\.html|style\.css|site\.js|google\.js|(?:hero|logo|gallery-\d+)\.webp|assets\/[a-zA-Z0-9][a-zA-Z0-9_.-]*\.(?:svg|webp|ttf|woff2?|txt))$/;
export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function stagingSlug(label, id) {
  const base = label.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 42).replace(/-$/, '') || 'business';
  return `${base}-${id.slice(0, 8)}`;
}
export function stagingConfigured(config) {
  return Boolean(config.stagingOrigin && config.stagingToken?.length >= 32 && config.stagingPassword?.length >= 20 && config.stagingUsername);
}
export async function packageRelease(config, site) {
  const root = releasePath(config, site.id, site.version);
  const files = [];
  async function visit(directory, prefix = '') {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory() && name === 'assets') await visit(path.join(directory, entry.name), 'assets/');
      else {
        if (!entry.isFile() || !fileNamePattern.test(name)) throw new Error('Release contains an unsupported file.');
        const bytes = await readFile(path.join(directory, entry.name));
        files.push({ name, sha256: digest(bytes), data: bytes.toString('base64') });
      }
    }
  }
  await visit(root);
  return files.sort((a, b) => a.name.localeCompare(b.name));
}
export async function deployStaging(config, site, input, fetcher = fetch) {
  if (!stagingConfigured(config)) throw new Error('Test deployment is not configured.');
  const body = stagingRequest.parse(input);
  if (body.expectedVersion !== site.version) throw new Error('The release changed. Reload and review the latest preview.');
  const content = JSON.parse(site.content);
  if (content.source === 'demo') throw new Error('Choose a real business for the staging pilot.');
  const origin = new URL(config.stagingOrigin);
  if (origin.protocol !== 'https:' || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('Invalid staging origin.');
  const slug = stagingSlug(body.label, site.id);
  const files = await packageRelease(config, site);
  const auth = { Authorization: `Bearer ${config.stagingToken}`, 'Content-Type': 'application/json' };
  const reviewAuth = { Authorization: `Basic ${Buffer.from(`${config.stagingUsername}:${config.stagingPassword}`).toString('base64')}` };
  async function command(action, value) {
    const response = await fetcher(new URL(`/internal/${action}`, origin), { method: 'POST', headers: auth, body: JSON.stringify(value), redirect: 'error', signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Staging ${action} failed (${response.status}). Previous deployment remains active.`);
    return response.json();
  }
  const payload = { id: site.id, version: site.version, slug, placeId: content.placeId, liveGoogle: content.liveGoogle, files };
  const prepared = await command('prepare', payload);
  const candidate = new URL(`https://${slug}.${origin.hostname}/_releases/${site.version}/`);
  // TLS issuance and proxy configuration can lag behind the successful upload.
  let verified = false;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      for (const file of files) {
        const response = await fetcher(new URL(file.name, candidate), { headers: reviewAuth, redirect: 'error', signal: AbortSignal.timeout(12000) });
        if (!response.ok || digest(Buffer.from(await response.arrayBuffer())) !== file.sha256) throw new Error('Release verification failed.');
      }
      if (content.liveGoogle) {
        const response = await fetcher(new URL('google.json', candidate), { headers: reviewAuth, redirect: 'error', signal: AbortSignal.timeout(20000) });
        if (!response.ok || !(await response.json()).name) throw new Error('Live Google check failed.');
      }
      verified = true; break;
    } catch {
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, config.stagingRetryDelay ?? 5000));
    }
  }
  if (!verified) throw new Error('Staging verification failed. Check DNS, HTTPS and Google access. The previous release is still active.');
  await command('activate', { id: site.id, version: site.version, expectedActive: prepared.activeVersion });
  return { url: `https://${slug}.${origin.hostname}/`, slug, label: body.label, version: site.version, access: 'password-protected', verifiedAt: new Date().toISOString() };
}
