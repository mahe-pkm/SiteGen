import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import { root } from '../server/config.js';
import { siteSchema, emptyCopy } from '../server/schema.js';
import { renderSignatureHtml } from '../server/signature-renderer.js';

// Isolated browser fixtures: no production database, Google lookup, or stored Google content.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const template = await readFile(path.join(root, 'templates/signature.hbs'), 'utf8');
const css = `${await readFile(path.join(root, 'public/design-preview/style.css'), 'utf8')}\n${await readFile(path.join(root, 'templates/signature.css'), 'utf8')}`;
const reference = { name: 'Google business preview', category: 'Business profile', city: '', description: '', services: [], template: 'signature', source: 'reference', rightsConfirmed: true, placeId: 'ChIJSignatureFixture123', liveGoogle: true, illustrativeImage: false };
const photo = (i) => ({ url: `./photo-${i}.webp`, authors: [{ name: 'Fixture photographer', uri: 'https://example.com/photographer' }], source: 'https://maps.google.com/' });
const retail = { name: 'Fixture Fashion', category: 'Clothing Store', city: 'Coimbatore', address: '12 Example Street', phone: '+91 98765 43210', hours: ['Monday: 10:00 AM - 8:00 PM', 'Tuesday: 10:00 AM - 8:00 PM'], googleMapsUri: 'https://maps.google.com/', photos: [photo(0), photo(1), photo(2)], attributions: [], rating: 4.7, reviewCount: 42, reviews: [{ author: 'Fixture reviewer', authorUri: 'https://example.com/reviewer', source: 'https://maps.google.com/', text: 'A fixture review. '.repeat(40), rating: 5, date: 'Yesterday', originalLanguage: 'ta', language: 'en' }] };
const fixtures = {
  retail: { profile: retail },
  sparse: { profile: { name: 'One Word', category: '', city: '', phone: '', photos: [], reviews: [] } },
  events: { profile: { ...retail, name: 'Fixture Events', category: 'Event Planner' } },
  long: { profile: { ...retail, name: 'ExceptionallyLongUnbrokenBusinessNameThatMustNeverEscapeItsContainer International Clothing Company' } },
  override: { profile: retail, content: { brandName: 'Independent Brand', brandConfirmed: true, copy: { ...emptyCopy, headline: 'Independent headline', about: 'Independent about copy.', faqs: [{ question: 'Independent question?', answer: 'Independent answer.', evidence: 'Independent fixture evidence.' }] } } },
  owner: { profile: null, content: { ...reference, name: 'Owned Studio', category: 'Event studio', source: 'owner', city: 'Example', liveGoogle: false, placeId: '', copy: { ...emptyCopy, about: 'Supplied about copy.' } } },
  demo: { profile: null, content: { ...reference, name: 'Fictional Studio', category: 'Event studio', source: 'demo', city: 'Example', liveGoogle: false, placeId: '', email: 'qa@example.com', whatsapp: '+12025550123', illustrativeImage: true } },
  mixed: { profile: retail, content: { gallery: [{ imageId: '11111111-1111-4111-8111-111111111111', caption: 'Owned image', category: 'styling' }, { imageId: '22222222-2222-4222-8222-222222222222', caption: 'Second owned image', category: 'venues' }], mediaConfirmed: true } },
  selected: { profile: retail, content: { googleHeroIndex: 2 } },
  fallback: { profile: retail, brokenPhotos: [0] },
  broken: { profile: retail, brokenPhotos: [0, 1, 2] },
  closed: { profile: { ...retail, businessStatus: 'CLOSED_PERMANENTLY' } },
  unsafe: { profile: { ...retail, name: '<img src=x onerror=alert(1)>', phone: 'javascript:alert(1)', googleMapsUri: 'javascript:alert(1)', photos: [{ ...photo(0), authors: [{ name: '<script>attack</script>', uri: 'javascript:alert(1)' }], source: 'javascript:alert(1)' }] } },
  unavailable: { error: true },
};
const app = express();
const lookups = new Map();
app.get('/qa/:name/', (req, res) => res.type('html').send(renderSignatureHtml(siteSchema.parse({ ...reference, ...fixtures[req.params.name].content }), { id: '33333333-3333-4333-8333-333333333333' }, template)));
app.get('/qa/:name/google.json', (req, res) => {
  lookups.set(req.params.name, (lookups.get(req.params.name) || 0) + 1);
  const fixture = fixtures[req.params.name]; res.set('Cache-Control', 'no-store');
  if (fixture.error) return res.status(503).json({ error: 'PRIVATE_UPSTREAM_ERROR' });
  res.json(fixture.profile);
});
app.get('/qa/:name/site.js', (req, res) => res.sendFile(path.join(root, 'templates/signature.js')));
app.get('/qa/:name/style.css', (req, res) => res.type('css').send(css));
app.use('/qa/:name/assets', express.static(path.join(root, 'public/design-preview/assets')));
app.get('/qa/:name/:photo', (req, res) => {
  const index = Number(req.params.photo.match(/photo-(\d+)/)?.[1]);
  if (fixtures[req.params.name].brokenPhotos?.includes(index)) return res.sendStatus(404);
  res.sendFile(path.join(root, 'public/design-preview/assets/table.webp'));
});
const server = await new Promise((resolve) => { const listener = app.listen(0, '127.0.0.1', () => resolve(listener)); });
let browser;
let checks = 0;
function check(actual, expected, label) { assert.deepEqual(actual, expected, label); checks++; }
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  for (const [name, fixture] of Object.entries(fixtures)) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = []; const externalRequests = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => { if (!request.url().startsWith('http://127.0.0.1:')) externalRequests.push(request.url()); });
    await page.goto(`http://127.0.0.1:${server.address().port}/qa/${name}/`);
    if (fixture.error) {
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      check(await page.locator('body').innerText().then((t) => t.includes('PRIVATE_UPSTREAM_ERROR')), false, 'Sanitized failure');
      check(await page.locator('#about').isVisible(), false, 'No empty about on failure');
    } else if (fixture.profile) {
      await page.waitForSelector('body[data-google-loaded=true]');
      check(await page.locator('#hero-title em').count(), 1, `${name}: styled name`);
      if (name !== 'override') check((await page.locator('#hero-title').innerText()).replace(/\s+/g, ' '), fixture.profile.name, `${name}: real name`);
      if (fixture.profile.photos?.length) {
        await page.locator('#gallery').scrollIntoViewIfNeeded();
        await page.evaluate(() => document.querySelectorAll('#gallery img[loading=lazy], #reviews img[loading=lazy]').forEach((img) => img.loading = 'eager'));
        await page.waitForLoadState('networkidle');
        if (name === 'broken') {
          check(await page.locator('[data-google-photo]:disabled').count(), 3, 'Failed photos disabled');
          check(await page.locator('[data-hero-photo]').isVisible(), false, 'No broken hero');
        } else {
          await page.locator('[data-google-photo]:not(:disabled)').first().click();
          await page.locator('.large-photo').evaluate((img) => img.decode());
          check(await page.locator('[data-photo-dialog]').isVisible(), true, 'Google lightbox opens');
          check(await page.locator('[data-photo-credit]').innerText().then((t) => t.includes('Google Maps')), true, 'Lightbox attribution');
          if (fixture.profile.photos.length > 1) {
            const previous = await page.locator('.large-photo').getAttribute('src');
            await page.keyboard.press('ArrowRight');
            check((await page.locator('.large-photo').getAttribute('src')) !== previous, true, 'Gallery next arrow');
          }
          await page.keyboard.press('Escape');
          check(await page.locator('[data-google-photo]:focus').count(), 1, 'Lightbox restores focus');
        }
      }
    }
    if (name === 'retail') {
      check(await page.locator('body').getAttribute('data-business-kind'), 'retail', 'Retail classification');
      check(await page.locator('[data-profile-brand]').first().innerText(), retail.name, 'Header live brand');
      check(await page.locator('.footer [data-profile-brand]').innerText(), retail.name, 'Footer live brand');
      check(await page.locator('[data-profile-faq-list] details').count(), 3, 'Factual FAQ generation');
      check(await page.locator('[data-live-phone]').getAttribute('href'), 'tel:+919876543210', 'Real phone');
      check(await page.locator('#enquiry-form').count(), 0, 'No fake event form');
      check(/wedding|celebration|guest count|your event/i.test(await page.locator('body').innerText()), false, 'No event copy in retail');
      check(await page.locator('[data-reviews] details').count(), 1, 'Long reviews expandable');
      await page.locator('#about').scrollIntoViewIfNeeded();
      await page.waitForFunction(() => document.querySelector('[data-about-photo] img').naturalWidth > 0);
      check(await page.locator('[data-about-photo]').isVisible(), true, 'About photo loads naturally without forcing eager images');
    }
    if (name === 'sparse') {
      for (const selector of ['#questions', '#gallery', '#reviews', '[data-live-phone]', '[data-hours-block]', '[data-profile-intro]']) check(await page.locator(selector).isVisible(), false, `Missing data hidden: ${selector}`);
    }
    if (name === 'events') check(await page.locator('body').getAttribute('data-business-kind'), 'events', 'Events classification');
    if (name === 'override') {
      check((await page.locator('#hero-title').innerText()).replace(/\s+/g, ' '), 'Independent Brand', 'Independent name preserved');
      check(await page.locator('.hero-tagline').innerText(), 'Independent headline', 'Independent headline preserved');
      check(await page.locator('#about').innerText().then((t) => t.includes('Independent about copy.')), true, 'Independent About preserved');
      check(await page.locator('#questions details').count(), 1, 'Independent FAQs preserved');
    }
    if (name === 'selected') check(await page.locator('[data-hero-photo]').getAttribute('src').then((s) => s.includes('photo-2')), true, 'Explicit hero selection');
    if (name === 'fallback') check(await page.locator('[data-hero-photo]').getAttribute('src').then((s) => s.includes('photo-1')), true, 'Broken hero fallback');
    if (name === 'closed') check(await page.locator('.closure-notice').innerText(), 'Listed as permanently closed on Google Maps.', 'Closure displayed');
    if (name === 'unsafe') {
      check(await page.locator('a[href^="javascript:"]').count(), 0, 'Unsafe URLs rejected');
      check(await page.locator('#hero-title img, #hero-title script').count(), 0, 'Name rendered as text');
      check(await page.locator('[data-live-phone]').isVisible(), false, 'Unsafe phone hidden');
    }
    if (name === 'mixed') {
      await page.locator('[data-filter=styling]').click();
      check(await page.locator('#portfolio figure:not([hidden])').count(), 1, 'Owner filter works');
      check(await page.locator('#gallery figure:not([hidden])').count(), 3, 'Owner filter cannot hide Google gallery');
    }
    if (name === 'demo') {
      check(await page.locator('a[href^="mailto:"], a[href^="https://wa.me/"]').count(), 0, 'Demo has no live contact');
      await page.locator('input[name=name]').fill('Test visitor'); await page.locator('input[name=email]').fill('test@example.com');
      await page.locator('#enquiry-form button[type=submit]').click();
      check(await page.locator('#enquiry-dialog').isVisible(), true, 'Demo enquiry still works'); await page.keyboard.press('Escape');
    }
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
      await page.evaluate(() => scrollTo(0, 0));
      const report = await page.evaluate(() => window.__protoChecks());
      if (report.overflow) console.log(await page.evaluate(() => [...document.querySelectorAll('body *')].filter((node) => node.getBoundingClientRect().right > innerWidth + 1).slice(0, 12).map((node) => ({ tag: node.tagName, className: node.className, right: node.getBoundingClientRect().right }))));
      check(report.overflow, false, `${name}: ${width}px overflow`);
      check(report.brokenAnchors, [], `${name}: ${width}px anchors`);
      check(report.brokenImages, [], `${name}: ${width}px images`);
      if (name === 'retail' && width === 390) {
        await page.getByRole('button', { name: 'Open menu', exact: true }).click();
        check(await page.locator('#main-nav').evaluate((nav) => nav.classList.contains('is-open')), true, 'Mobile menu opens');
        await page.locator('#main-nav a[href="#about"]').click();
        check(await page.locator('.menu-toggle').getAttribute('aria-expanded'), 'false', 'Menu closes after navigation');
      }
    }
    check(errors, [], `${name}: JavaScript errors`); check(externalRequests, [], `${name}: unexpected outbound requests`);
    check(lookups.get(name) || 0, fixture.profile || fixture.error ? 1 : 0, `${name}: lookup isolation`);
    console.log(`PASS ${name}`); await page.close();
  }
  console.log(`PASS ${checks} browser assertions across ${Object.keys(fixtures).length} fixtures`);
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
