import Handlebars from 'handlebars';
import { emptyCopy } from './schema.js';

export const signatureAssets = [
  'dm-sans-regular.ttf', 'dm-sans-medium.ttf', 'dm-serif.ttf', 'dm-serif-italic.ttf',
  'DM-SANS-OFL.txt', 'DM-SERIF-DISPLAY-OFL.txt', 'LUCIDE-LICENSE.txt',
  'arrow-up-right.svg', 'arrow-right.svg', 'arrow-left.svg', 'chevron-down.svg',
  'plus.svg', 'pin.svg', 'menu.svg', 'close.svg',
];

export function signatureView(content, site) {
  const copy = { ...emptyCopy, ...content.copy };
  copy.faqs = copy.faqs.filter((faq) => faq.question.trim() && faq.answer.trim());
  const reference = content.source === 'reference';
  const demo = content.source === 'demo';
  const displayName = content.brandName || (reference ? 'Business' : content.name);
  const words = displayName.split(/\s+/);
  const lastWord = words.pop();
  const services = copy.services.length ? copy.services : content.services.map((title) => ({ title, description: '' }));
  const localHero = Boolean(content.imageId || (content.illustrativeImage && (!content.liveGoogle || demo)));
  const illustrativeHero = localHero && !content.imageId;
  const gallery = (content.gallery || []).map((image, i) => ({ ...image, url: `./gallery-${i}.webp` }));
  if (!gallery.length && demo && illustrativeHero) gallery.push(
    { url: './assets/celebration.webp', caption: 'Floral tablescapes', category: 'styling', illustrative: true },
    { url: './assets/reception.webp', caption: 'A room for celebration', category: 'venues', illustrative: true },
    { url: './assets/table.webp', caption: 'The smaller details', category: 'styling', illustrative: true },
  );
  const filters = [...new Set(gallery.map((image) => image.category))].map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }));
  const about = copy.about || (copy.intro ? content.description : '');
  return {
    ...content, copy, reference, demo, displayName, siteId: site.id,
    email: demo ? '' : content.email, phone: demo ? '' : content.phone,
    namePrefix: words.join(' '), nameLast: lastWord,
    liveBrand: reference && !content.brandName, liveTitle: reference && !content.brandName && !copy.seoTitle, localHero, illustrativeHero,
    title: copy.seoTitle || (reference ? 'Business website preview' : displayName),
    intro: copy.intro || content.description, about,
    metaDescription: copy.seoDescription || content.description,
    services: services.map((service, i) => ({ ...service, number: String(i + 1).padStart(2, '0') })),
    gallery, filters, showFilters: filters.length > 1, sampleGallery: gallery.some((image) => image.illustrative),
    aboutPhoto: gallery[0]?.url || (localHero ? './hero.webp' : ''),
    aboutPhotoAlt: gallery[0]?.caption || (illustrativeHero ? 'Illustrative event photograph' : `${displayName} photograph`),
    hasEnquiry: Boolean(demo || content.email || content.whatsapp),
    phoneHref: !demo && content.phone ? `tel:${content.phone.replace(/[^+\d]/g, '')}` : '',
    whatsappHref: !demo && content.whatsapp ? `https://wa.me/${content.whatsapp.replace(/\D/g, '')}` : '',
    mapsHref: content.placeId ? `https://www.google.com/maps/search/?api=1&query=business&query_place_id=${encodeURIComponent(content.placeId)}` : content.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent([content.name, content.address, content.city].filter(Boolean).join(' '))}` : '',
    robots: content.indexable && content.publicationAuthorized && !reference && !demo ? 'index,follow' : 'noindex,nofollow',
  };
}

export function renderSignatureHtml(content, site, template) {
  return Handlebars.compile(template)(signatureView(content, site));
}
