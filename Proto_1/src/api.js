export async function request(url, options = {}) {
  const response = await fetch(url, options);
  let data;
  try { data = await response.json(); } catch { throw new Error(`Request failed (${response.status}).`); }
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
export const json = (body, method = 'POST', key) => ({ method, headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, body: JSON.stringify(body) });
export const activeStates = ['queued', 'generating', 'publishing'];
export const emptyCopy = { headline: '', intro: '', heroEvidence: '', aboutTitle: '', about: '', aboutEvidence: '', services: [], faqs: [], seoTitle: '', seoDescription: '', seoEvidence: '' };
export const normalizeContent = (content) => ({ liveGoogle: false, googleHeroIndex: 0, palette: 'forest', layout: 'editorial', brief: '', briefSource: content.source === 'demo' ? 'demo' : 'owner', briefConfirmed: false, brandName: '', logoId: '', brandConfirmed: false, mediaConfirmed: false, gallery: [], ...content, copy: { ...emptyCopy, ...content.copy } });
