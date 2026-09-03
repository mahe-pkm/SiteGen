import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

const root = new URL('../public/design-preview/', import.meta.url);

test('design proposal declares its fictional and local-only purpose', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  assert.match(html, /name="robots" content="noindex,nofollow"/);
  assert.match(html, /Fictional business/);
  assert.match(html, /Illustrative photography/);
  assert.match(html, /Nothing is sent or stored/);
  assert.doesNotMatch(html, /<form[^>]+action=/i);
  assert.doesNotMatch(html, /google\.json|google-photo|\/api\/|GOOGLE_MAPS_API_KEY|OPENROUTER_API_KEY/);
});

test('design proposal resource references resolve to nonempty local assets', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const css = await readFile(new URL('style.css', root), 'utf8');
  const resources = [...html.matchAll(/(?:src|href)="(\.\/[^"#]+)"/g), ...css.matchAll(/url\('([^']+)'\)/g)].map((match) => match[1]);
  assert.ok(resources.length > 30);
  for (const resource of new Set(resources)) {
    assert.ok((await stat(new URL(resource, root))).size > 0, resource);
  }
  assert.doesNotMatch(html, /<(?:script|img)[^>]+src="https?:/i);
  assert.doesNotMatch(css, /@import|url\(['"]?https?:/i);
});

test('enquiry summary uses text rendering and has no outbound transport or persistence', async () => {
  const script = await readFile(new URL('site.js', root), 'utf8');
  assert.match(script, /event\.preventDefault\(\)/);
  assert.match(script, /form\.reportValidity\(\)/);
  assert.match(script, /dd\.textContent = value/);
  assert.doesNotMatch(script, /innerHTML|fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|indexedDB|document\.cookie\s*=/);
});
