import assert from 'node:assert/strict';
import express from 'express';
import path from 'node:path';
import os from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { createApp, errors } from '../server/app.js';
import { root } from '../server/config.js';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const dataDir = await mkdtemp(path.join(os.tmpdir(), 'proto1-staging-ui-'));
let prepared; let activated = 0; let fail = false; let browser; let server;
const config = { root, dev: true, dataDir, port: 0, adminPassword: '', googleKey: '', publicDeployEnabled: false, stagingOrigin: 'https://preview.example.com', stagingToken: 'test'.repeat(10), stagingUsername: 'review', stagingPassword: 'fixture'.repeat(5), stagingRetryDelay: 0 };
const app = createApp(config, { stagingFetch: async (url, options) => {
  const parsed = new URL(url);
  if (parsed.pathname === '/internal/prepare') { if (fail) return new Response('', { status: 503 }); prepared = JSON.parse(options.body); return Response.json({ activeVersion: 0 }); }
  if (parsed.pathname === '/internal/activate') { activated++; return Response.json({ active: true }); }
  const file = prepared.files.find((f) => parsed.pathname.endsWith('/' + f.name));
  return file ? new Response(Buffer.from(file.data, 'base64')) : new Response('', { status: 404 });
} });
app.use(express.static(path.join(root, 'dist'))); app.use(errors);
let checks = 0;
function check(value, expected, label) { assert.deepEqual(value, expected, label); checks++; }
try {
  server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  config.port = server.address().port; const base = `http://127.0.0.1:${config.port}`;
  const response = await fetch(base + '/api/sites', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Fixture Store', category: 'Clothing store', city: 'Example City', description: 'Independently supplied fixture business.', services: [], template: 'signature', source: 'owner', rightsConfirmed: true, illustrativeImage: false }) });
  const { site } = await response.json(); await app.locals.jobs.drain();
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }); const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto(`${base}/?site=${site.id}`);
  await page.getByRole('button', { name: 'Checks', exact: true }).click();
  const publish = page.getByRole('button', { name: 'Publish test site', exact: true });
  check(await publish.isEnabled(), false, 'Review required'); check(activated, 0, 'Generation never publishes');
  await page.getByLabel('Business subdomain label', { exact: true }).fill('Fixture Store');
  check(await publish.isEnabled(), false, 'Label alone cannot publish');
  await page.getByRole('checkbox').check(); check(await publish.isEnabled(), true, 'Reviewed release can publish');
  fail = true; await publish.click(); await page.getByRole('alert').filter({ hasText: 'Test deployment could not be confirmed' }).waitFor();
  check(activated, 0, 'Upload failure does not activate');
  fail = false; await publish.click(); await page.locator('.staging-result a').waitFor();
  check(activated, 1, 'Explicit publication activates once');
  check(await page.locator('.staging-result a').getAttribute('href'), `https://fixture-store-${site.id.slice(0, 8)}.preview.example.com/`, 'Correct unique test link');
  check(await page.getByLabel('Business subdomain label', { exact: true }).isEnabled(), false, 'Existing routing label locked');
  check(await page.getByRole('checkbox').isChecked(), false, 'Review resets after publication');
  await page.reload(); await page.getByRole('button', { name: 'Checks', exact: true }).click();
  await page.locator('.staging-result a').waitFor(); check(await page.getByLabel('Business subdomain label', { exact: true }).inputValue(), 'Fixture Store', 'Routing label survives reload');
  await page.getByRole('button', { name: 'Content', exact: true }).click(); await page.getByLabel('Headline', { exact: true }).fill('Unsaved change');
  await page.getByRole('button', { name: 'Checks', exact: true }).click(); check(await page.getByRole('checkbox').isEnabled(), false, 'Unsaved changes block approval');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, `No overflow at ${width}px`);
  }
  check(pageErrors, [], 'No browser exceptions');
  await page.screenshot({ path: path.join(os.tmpdir(), 'proto1-staging-ui-mobile.png'), fullPage: true });
  console.log(`PASS ${checks} staging UI checks; screenshot: ${path.join(os.tmpdir(), 'proto1-staging-ui-mobile.png')}`);
} finally {
  await browser?.close(); server?.closeAllConnections(); if (server) await new Promise((resolve) => server.close(resolve));
  await app.locals.jobs.drain(); app.locals.store.close();
  assert.equal(path.dirname(path.resolve(dataDir)), path.resolve(os.tmpdir())); assert.ok(path.basename(dataDir).startsWith('proto1-staging-ui-'));
  await rm(dataDir, { recursive: true, force: true });
}
