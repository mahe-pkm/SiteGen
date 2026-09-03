import { z } from 'zod';

const text = (max) => z.string().trim().max(max);
export const copySchema = z.object({
  headline: text(150), intro: text(500), heroEvidence: text(1200),
  aboutTitle: text(120), about: text(1600), aboutEvidence: text(1800),
  services: z.array(z.object({ title: text(100).min(2), description: text(600), evidence: text(1200).min(8) }).strict()).max(8),
  faqs: z.array(z.object({ question: text(200), answer: text(600), evidence: text(1200).min(8) }).strict()).max(6),
  seoTitle: text(160), seoDescription: text(300), seoEvidence: text(1500),
}).strict();
export const emptyCopy = { headline: '', intro: '', heroEvidence: '', aboutTitle: '', about: '', aboutEvidence: '', services: [], faqs: [], seoTitle: '', seoDescription: '', seoEvidence: '' };
export const siteSchema = z.object({
  name: text(120).min(2),
  category: text(100).min(2),
  city: text(100),
  address: text(400).default(''),
  phone: text(30).regex(/^[+\d\s().-]*$/).default(''),
  whatsapp: text(30).regex(/^(?:\+[1-9]\d{7,14})?$/, 'Use an international number, such as +918515021570.').default(''),
  email: z.union([z.email(), z.literal('')]).default(''),
  description: text(1800),
  services: z.array(text(100).min(2)).max(8),
  hours: text(600).default(''),
  placeId: text(255).regex(/^[A-Za-z0-9_-]*$/).default(''),
  template: z.enum(['atelier', 'local', 'events', 'signature']).default('atelier'),
  source: z.enum(['owner', 'licensed', 'demo', 'reference']),
  rightsConfirmed: z.literal(true, { error: 'Confirm the rights to retain and publish the supplied content.' }),
  publicationAuthorized: z.boolean().default(false),
  imageId: z.union([z.string().uuid(), z.literal('')]).default(''),
  brandName: text(80).default(''),
  logoId: z.union([z.string().uuid(), z.literal('')]).default(''),
  brandConfirmed: z.boolean().default(false),
  mediaConfirmed: z.boolean().default(false),
  gallery: z.array(z.object({
    imageId: z.string().uuid(), caption: text(100).min(2),
    category: z.enum(['styling', 'venues', 'celebrations']).default('celebrations'),
  }).strict()).max(9).default([]),
  illustrativeImage: z.boolean().default(true),
  indexable: z.boolean().default(false),
  liveGoogle: z.boolean().default(false),
  googleHeroIndex: z.number().int().min(0).max(5).default(0),
  palette: z.enum(['forest', 'rose', 'ink']).default('forest'),
  layout: z.enum(['editorial', 'modern']).default('editorial'),
  copy: copySchema.default(emptyCopy),
  brief: text(8000).default(''),
  briefSource: z.enum(['owner', 'licensed', 'demo']).default('owner'),
  briefConfirmed: z.boolean().default(false),
}).superRefine((content, ctx) => {
  if (content.source === 'reference') {
    if (!content.placeId || !content.liveGoogle) ctx.addIssue({ code: 'custom', message: 'A Google reference needs a Place ID and live Google display.' });
    if (content.publicationAuthorized || content.indexable) ctx.addIssue({ code: 'custom', message: 'Reference-only drafts cannot be published or indexed.' });
    if (content.name !== 'Google business preview' || content.category !== 'Business profile' || content.city || content.address || content.phone || content.hours || content.description || content.services.length || content.email || content.whatsapp) ctx.addIssue({ code: 'custom', message: 'Reference drafts cannot store copied Google facts. Use independently supplied content instead.' });
    if ((content.brandName || content.logoId) && !content.brandConfirmed) ctx.addIssue({ code: 'custom', message: 'Confirm that the brand name and logo were independently supplied, not copied from Google API results.' });
    if ((content.imageId || content.gallery.length) && !content.mediaConfirmed) ctx.addIssue({ code: 'custom', message: 'Confirm independent rights to the uploaded photographs; Google API photos cannot be stored here.' });
  } else if (!['events', 'signature'].includes(content.template) && (content.city.length < 2 || content.description.length < 20 || !content.services.length)) {
    ctx.addIssue({ code: 'custom', message: 'Add the city, a description of at least 20 characters, and one service.' });
  }
});

export const lookupSchema = z.object({
  input: z.string().trim().min(3).max(1800),
  kind: z.enum(['auto', 'place-id', 'link', 'name']).default('auto'),
});

export function publicSite(row, config) {
  const content = JSON.parse(row.content);
  return {
    id: row.id, slug: row.slug, name: content.name, category: content.category,
    city: content.city, template: content.template, source: content.source,
    status: row.status, version: row.version, activeVersion: row.active_version,
    error: row.error, createdAt: row.created_at, updatedAt: row.updated_at,
    previewUrl: row.version ? `/preview/${row.slug}/` : null,
    deployedUrl: row.status === 'published' ? `https://${row.slug}.${config.siteBaseDomain}/` : null,
    shared: Boolean(row.shared), content,
  };
}
