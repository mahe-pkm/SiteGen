import Handlebars from 'handlebars';
import { emptyCopy } from './schema.js';

export function renderEventHtml(content, site, template) {
  const copy = { ...emptyCopy, ...content.copy };
  const reference = content.source === 'reference';
  const services = copy.services.length ? copy.services : content.services.map((title) => ({ title, description: '' }));
  return Handlebars.compile(template)({
    ...content, copy, siteId: site.id, year: new Date().getFullYear(), reference,
    displayName: reference ? 'Business profile' : content.name,
    title: copy.seoTitle || (reference ? 'Business website preview' : content.name),
    metaDescription: copy.seoDescription || (reference ? 'Live business website preview.' : content.description),
    intro: copy.intro || content.description,
    about: copy.about || (!copy.intro ? '' : content.description),
    hasLocalImage: Boolean(content.imageId || content.illustrativeImage),
    imageLabel: !content.imageId && content.illustrativeImage ? 'Illustrative template image' : '',
    services: services.map((service, i) => ({ ...service, number: String(i + 1).padStart(2, '0') })),
    demo: content.source === 'demo',
    phoneHref: content.phone ? `tel:${content.phone.replace(/[^+\d]/g, '')}` : '',
    whatsappHref: content.whatsapp ? `https://wa.me/${content.whatsapp.replace(/\D/g, '')}` : '',
    mapsHref: content.placeId ? `https://www.google.com/maps/search/?api=1&query=business&query_place_id=${encodeURIComponent(content.placeId)}` : '',
    robots: content.indexable && content.publicationAuthorized && !reference && content.source !== 'demo' ? 'index,follow' : 'noindex,nofollow',
  });
}
