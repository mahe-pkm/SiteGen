import path from 'node:path';
import { copyFile, mkdir, readFile, writeFile, access } from 'node:fs/promises';
import Handlebars from 'handlebars';
import { renderEventHtml } from './event-renderer.js';
import { renderSignatureHtml, signatureAssets, signatureView } from './signature-renderer.js';

export function releasePath(config, id, version) {
  if (!/^[a-f0-9-]{36}$/.test(id) || !Number.isSafeInteger(version) || version < 1) throw new Error('Invalid release path.');
  return path.join(config.dataDir, 'artifacts', id, String(version));
}

export function renderHtml(content, site, template) {
  const address = [content.address, content.city].filter(Boolean).join(', ');
  const maps = content.placeId
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(content.name)}&query_place_id=${encodeURIComponent(content.placeId)}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${content.name} ${address}`)}`;
  const structured = content.source !== 'demo' ? {
    '@context': 'https://schema.org', '@type': 'LocalBusiness', name: content.name,
    description: content.description, ...(address ? { address } : {}), ...(content.phone ? { telephone: content.phone } : {}),
  } : null;
  return Handlebars.compile(template)({
    ...content, siteId: site.id, year: new Date().getFullYear(),
    serviceItems: content.services.map((name, index) => ({ name, number: String(index + 1).padStart(2, '0') })),
    hasImage: Boolean(content.imageId || content.illustrativeImage),
    showIllustrationNote: !content.imageId && content.illustrativeImage,
    demo: content.source === 'demo',
    phoneHref: `tel:${content.phone.replace(/[^+\d]/g, '')}`,
    whatsappHref: content.whatsapp ? `https://wa.me/${content.whatsapp.replace(/\D/g, '')}?text=${encodeURIComponent(`Hello ${content.name}, I would like to enquire about your services.`)}` : '',
    mapsHref: maps,
    robots: content.indexable && content.publicationAuthorized && content.source !== 'demo' ? 'index,follow' : 'noindex,nofollow',
    structured: structured ? JSON.stringify(structured).replace(/</g, '\\u003c') : '',
  });
}

export async function generateRelease(config, content, site, version) {
  const destination = releasePath(config, site.id, version);
  await mkdir(destination, { recursive: true });
  if (content.template === 'signature') {
    const assetRoot = path.join(config.root, 'public', 'design-preview');
    const view = signatureView(content, site);
    const template = await readFile(path.join(config.root, 'templates', 'signature.hbs'), 'utf8');
    const html = renderSignatureHtml(content, site, template);
    await writeFile(path.join(destination, 'index.html'), html);
    await writeFile(path.join(destination, 'style.css'), `${await readFile(path.join(assetRoot, 'style.css'), 'utf8')}\n${await readFile(path.join(config.root, 'templates', 'signature.css'), 'utf8')}`);
    await copyFile(path.join(config.root, 'templates', 'signature.js'), path.join(destination, 'site.js'));
    if (content.liveGoogle) await copyFile(path.join(config.root, 'templates', 'events.js'), path.join(destination, 'google.js'));
    await mkdir(path.join(destination, 'assets'), { recursive: true });
    const assets = [...signatureAssets, ...(view.sampleGallery ? ['celebration.webp', 'reception.webp', 'table.webp'] : [])];
    for (const file of assets) await copyFile(path.join(assetRoot, 'assets', file), path.join(destination, 'assets', file));
    if (view.localHero) await copyFile(content.imageId ? path.join(config.dataDir, 'uploads', `${content.imageId}.webp`) : path.join(assetRoot, 'assets', 'hero.webp'), path.join(destination, 'hero.webp'));
    if (content.logoId) await copyFile(path.join(config.dataDir, 'uploads', `${content.logoId}.webp`), path.join(destination, 'logo.webp'));
    for (const [i, image] of (content.gallery || []).entries()) await copyFile(path.join(config.dataDir, 'uploads', `${image.imageId}.webp`), path.join(destination, `gallery-${i}.webp`));
    if (!html.includes(`content="${site.id}"`) || html.includes('/api/lookup')) throw new Error('Generated HTML verification failed.');
    return destination;
  }
  const event = content.template === 'events';
  const template = await readFile(path.join(config.root, 'templates', event ? 'events.hbs' : 'business.hbs'), 'utf8');
  const html = event ? renderEventHtml(content, site, template) : renderHtml(content, site, template);
  await writeFile(path.join(destination, 'index.html'), html);
  await copyFile(path.join(config.root, 'templates', event ? 'events.css' : 'business.css'), path.join(destination, 'style.css'));
  if (event) await copyFile(path.join(config.root, 'templates', 'events.js'), path.join(destination, 'site.js'));
  if (content.imageId) {
    await copyFile(path.join(config.dataDir, 'uploads', `${content.imageId}.webp`), path.join(destination, 'hero.webp'));
  } else if (content.illustrativeImage) {
    await copyFile(path.join(config.root, 'public', 'assets', 'illustrative-interior.webp'), path.join(destination, 'hero.webp'));
  }
  for (const file of ['index.html', 'style.css']) await access(path.join(destination, file));
  if (!html.includes(`content="${site.id}"`) || html.includes('/api/lookup')) throw new Error('Generated HTML verification failed.');
  return destination;
}
