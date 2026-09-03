const googleHosts = new Set(['google.com', 'www.google.com', 'maps.google.com', 'maps.app.goo.gl', 'goo.gl', 'share.google']);
const shortHosts = new Set(['maps.app.goo.gl', 'goo.gl', 'share.google']);

export class LookupError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function validUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new LookupError('Enter a valid Google Maps link.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !googleHosts.has(url.hostname.toLowerCase())) {
    throw new LookupError('Only HTTPS Google Maps or Google share links are accepted.');
  }
  return url;
}

function validId(value) {
  const id = value.replace(/^places\//, '').replace(/^place_id:/, '');
  if (!/^[A-Za-z0-9_-]{8,255}$/.test(id)) throw new LookupError('That Place ID is not valid.');
  return id;
}

export async function resolveInput(input, kind = 'auto', fetcher = fetch) {
  if (kind === 'place-id' || /^(places\/|place_id:|ChIJ|ChI[\w-]{15})/.test(input)) {
    return { placeId: validId(input) };
  }
  if (/^https?:\/\//i.test(input) || kind === 'link') {
    let url = validUrl(input);
    if (shortHosts.has(url.hostname)) {
      let resolved = false;
      for (let hop = 0; hop < 6; hop++) {
        const response = await fetcher(url.href, { redirect: 'manual', signal: AbortSignal.timeout(8000) });
        const redirect = response.status >= 300 && response.status < 400;
        const location = response.headers.get('location');
        await response.body?.cancel();
        if (!redirect) { resolved = true; break; }
        if (!location) throw new LookupError('Google returned an incomplete redirect. Try a Place ID.');
        url = validUrl(new URL(location, url).href);
        if (!shortHosts.has(url.hostname)) { resolved = true; break; }
      }
      if (!resolved) throw new LookupError('This link redirects too many times. Try a Place ID.');
    }
    if (url.pathname.replace(/\/$/, '') === '/share.google') {
      throw new LookupError('This Google share link did not resolve to a business. Use a fresh Maps link, Place ID, or business name and city.');
    }
    const id = url.searchParams.get('query_place_id') || url.searchParams.get('place_id');
    if (id) return { placeId: validId(id) };
    const query = url.searchParams.get('query') || url.searchParams.get('q');
    if (query?.startsWith('place_id:')) return { placeId: validId(query) };
    if (query && !/^[-+\d.,\s]+$/.test(query)) return { query: query.slice(0, 500) };
    let pathname;
    try { pathname = decodeURIComponent(url.pathname); } catch { throw new LookupError('This Maps link is malformed. Try a Place ID.'); }
    const pathId = pathname.match(/!1s(ChI[A-Za-z0-9_-]+)/);
    if (pathId) return { placeId: validId(pathId[1]) };
    const name = pathname.match(/\/maps\/place\/([^/]+)/i)?.[1]?.replaceAll('+', ' ');
    if (name) return { query: name.slice(0, 500) };
    throw new LookupError('This link does not identify a business. Enter its Place ID or business name and city.');
  }
  if (input.includes('://')) throw new LookupError('That link type is not supported.');
  return { query: input.slice(0, 500) };
}

const fields = ['id', 'displayName', 'primaryTypeDisplayName', 'formattedAddress', 'addressComponents', 'internationalPhoneNumber', 'regularOpeningHours.weekdayDescriptions', 'websiteUri', 'googleMapsUri', 'businessStatus'];

function mapPlace(place) {
  return {
    placeId: place.id,
    name: place.displayName?.text || '',
    category: place.primaryTypeDisplayName?.text || '',
    address: place.formattedAddress || '',
    city: place.addressComponents?.find((part) => part.types?.includes('locality'))?.longText || '',
    phone: place.internationalPhoneNumber || '',
    hours: place.regularOpeningHours?.weekdayDescriptions || [],
    website: place.websiteUri || '',
    googleMapsUri: place.googleMapsUri || '',
    businessStatus: place.businessStatus || '',
  };
}

const safeLink = (value) => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : ''; } catch { return ''; }
};

export async function livePlace(placeId, apiKey, fetcher = fetch) {
  validId(placeId);
  const richFields = [...fields, 'types', 'rating', 'userRatingCount', 'photos', 'reviews', 'attributions'];
  let response;
  try {
    response = await fetcher(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
      headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': richFields.join(',') }, signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) throw new LookupError(`Google profile could not be loaded (${response.status}).`, 502);
    const place = await response.json();
    return {
      ...mapPlace(place), website: safeLink(place.websiteUri), googleMapsUri: safeLink(place.googleMapsUri),
      rating: Number.isFinite(place.rating) ? place.rating : null, reviewCount: place.userRatingCount || 0,
      attributions: (place.attributions || []).map((a) => ({ provider: a.provider || '', providerUri: safeLink(a.providerUri) })),
      photos: (place.photos || []).filter((photo) => typeof photo.name === 'string').slice(0, 6).map((photo) => ({
        resource: photo.name,
        authors: (photo.authorAttributions || []).map((a) => ({ name: a.displayName || 'Photo contributor', uri: safeLink(a.uri) })),
        source: safeLink(photo.googleMapsUri) || safeLink(place.googleMapsUri),
      })),
      reviews: (place.reviews || []).slice(0, 5).map((review) => ({
        author: review.authorAttribution?.displayName || 'Google reviewer', authorUri: safeLink(review.authorAttribution?.uri),
        avatar: safeLink(review.authorAttribution?.photoUri), rating: review.rating || 0,
        text: review.text?.text || review.originalText?.text || '', originalLanguage: review.originalText?.languageCode || '', language: review.text?.languageCode || '',
        date: review.relativePublishTimeDescription || '', source: safeLink(review.googleMapsUri) || safeLink(place.googleMapsUri),
      })),
    };
  } catch (error) {
    if (error instanceof LookupError) throw error;
    throw new LookupError('Google profile is temporarily unavailable. Try refreshing the preview.', 502);
  }
}

export async function lookupBusiness(input, kind, apiKey, fetcher = fetch) {
  if (!apiKey) throw new LookupError('Google API key is not configured. Add it to the local .env file.', 503);
  let response;
  try {
    const resolved = await resolveInput(input, kind, fetcher);
    if (resolved.placeId) {
      response = await fetcher(`https://places.googleapis.com/v1/places/${encodeURIComponent(resolved.placeId)}`, {
        headers: { 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fields.join(',') }, signal: AbortSignal.timeout(15000),
      });
    } else {
      response = await fetcher('https://places.googleapis.com/v1/places:searchText', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': fields.map((field) => `places.${field}`).join(',') },
        body: JSON.stringify({ textQuery: resolved.query, pageSize: 3, languageCode: 'en', regionCode: 'IN' }), signal: AbortSignal.timeout(15000),
      });
    }
    if (!response.ok) {
      const messages = { 400: 'Google could not read this reference. Check the Place ID.', 403: 'Google rejected this key or the Places API is not enabled.', 404: 'No business exists for that Place ID.', 429: 'Google quota reached. Try again later.' };
      throw new LookupError(messages[response.status] || 'Google Places is temporarily unavailable.', response.status === 429 ? 429 : 502);
    }
    const data = await response.json();
    return { source: 'google', results: (resolved.placeId ? [data] : data.places || []).map(mapPlace) };
  } catch (error) {
    if (error instanceof LookupError) throw error;
    throw new LookupError('Google lookup timed out or could not connect. Please retry.', 502);
  }
}
