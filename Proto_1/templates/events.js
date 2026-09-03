(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const text = (tag, value, className = '') => { const el = document.createElement(tag); el.textContent = value || ''; if (className) el.className = className; return el; };
  const safeUrl = (value) => { try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; } };
  function link(label, href, className = '') {
    const el = text('a', label, className);
    el.href = safeUrl(href) || '#contact'; el.target = '_blank'; el.rel = 'noopener noreferrer';
    return el;
  }
  function credit(container, photo) {
    container.replaceChildren(text('span', 'Google Maps | '));
    photo.authors.forEach((author, index) => { if (index) container.append(text('span', ', ')); container.append(link(author.name, author.uri || photo.source)); });
    if (!photo.authors.length) container.append(link('View source', photo.source));
    else container.append(text('span', ' / '), link('View source', photo.source));
  }
  const dialog = $('[data-photo-dialog]');
  $('[data-close-photo]')?.addEventListener('click', () => dialog.close());
  dialog?.addEventListener('click', (event) => {
    if (event.target !== dialog) return;
    const r = dialog.getBoundingClientRect();
    if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) dialog.close();
  });
  function showPhoto(photo, name, opener) {
    const image = dialog.querySelector('img');
    image.src = safeUrl(`${photo.url}?w=1600`); image.alt = `${name} - Google profile photograph`;
    credit($('[data-photo-credit]'), photo);
    dialog.showModal();
    dialog.addEventListener('close', () => opener.focus(), { once: true });
  }
  function hydrate(profile) {
    const values = { name: profile.name, category: profile.category, city: profile.city, address: profile.address,
      rating: profile.rating == null ? '' : profile.rating.toFixed(1), reviewCount: `${profile.reviewCount.toLocaleString()} Google reviews` };
    $$('[data-live]').forEach((el) => { el.textContent = values[el.dataset.live] || ''; });
    if (document.body.dataset.reference === 'true') document.title = `${profile.name} | Business website`;
    $$('[data-maps-link]').forEach((el) => { if (safeUrl(profile.googleMapsUri)) { el.href = safeUrl(profile.googleMapsUri); el.hidden = false; } });
    if (profile.phone && /^[+\d\s().-]+$/.test(profile.phone)) {
      $$('[data-live-phone]').forEach((el) => { el.href = `tel:${profile.phone.replace(/[^+\d]/g, '')}`; el.textContent = el.classList.contains('button') ? 'Call the business' : profile.phone; el.hidden = false; });
      $$('[data-contact-phone]').forEach((el) => { el.hidden = false; });
    }
    const hours = $('[data-hours]');
    if (hours && !hours.textContent.trim() && profile.hours.length) {
      profile.hours.forEach((line) => {
        const row = text('div', '', 'hour-row'); const separator = line.indexOf(':');
        row.append(text('span', separator < 0 ? line : line.slice(0, separator)), text('span', separator < 0 ? '' : line.slice(separator + 1).trim()));
        hours.append(row);
      });
      $('[data-hours-block]').hidden = false;
    }
    profile.attributions.forEach((item) => $('[data-provider-note]').append(link(item.provider, item.providerUri)));
    if (profile.rating != null) $('[data-profile-strip]').hidden = false;
    if (profile.photos.length) {
      const first = profile.photos[Number(document.body.dataset.heroIndex)] || profile.photos[0];
      const hero = $('[data-hero-photo]');
      if (hero) {
        hero.addEventListener('load', () => { hero.hidden = false; $('.hero').classList.add('has-image'); credit($('[data-hero-credit]'), first); });
        hero.src = safeUrl(`${first.url}?w=1600`); hero.alt = `${profile.name} - Google profile photograph`;
      }
      $('#gallery').hidden = false;
      $$('[data-gallery-nav]').forEach((el) => { el.hidden = false; });
      profile.photos.forEach((photo, index) => {
        const figure = document.createElement('figure'); const button = document.createElement('button'); button.type = 'button';
        button.setAttribute('aria-label', `Enlarge photograph ${index + 1}`);
        const image = document.createElement('img'); image.src = safeUrl(photo.url); image.alt = `${profile.name}, photograph ${index + 1}`; image.loading = 'lazy';
        image.addEventListener('error', () => { image.hidden = true; button.querySelector('span').textContent = 'Photo unavailable'; button.disabled = true; });
        button.append(image, text('span', 'View photo')); button.addEventListener('click', () => showPhoto(photo, profile.name, button));
        const caption = document.createElement('figcaption'); credit(caption, photo); figure.append(button, caption); $('[data-gallery]').append(figure);
      });
    }
    if (profile.reviews.length) {
      $('#reviews').hidden = false; $$('[data-review-nav]').forEach((el) => { el.hidden = false; });
      profile.reviews.forEach((review) => {
        const article = text('article', '', 'review'); const header = text('div', '', 'review-header');
        if (review.avatar && safeUrl(review.avatar)) { const avatar = document.createElement('img'); avatar.src = safeUrl(review.avatar); avatar.alt = review.author; avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer'; avatar.addEventListener('error', () => avatar.remove()); header.append(avatar); }
        const byline = document.createElement('div'); byline.append(link(review.author, review.authorUri || review.source, 'review-author'), text('span', review.date, 'review-date')); header.append(byline);
        article.append(header, text('div', `${review.rating} / 5 stars`, 'review-rating'));
        if (review.text.length > 380) { const details = document.createElement('details'); details.append(text('summary', 'Read review'), text('p', review.text)); article.append(text('p', review.text.slice(0, 260) + '...'), details); }
        else article.append(text('p', review.text));
        if (review.originalLanguage && review.language && review.originalLanguage !== review.language) article.append(text('p', 'Translated by Google', 'review-date'));
        article.append(link('View original on Google Maps', review.source, 'review-source')); $('[data-reviews]').append(article);
      });
    }
    document.body.dataset.googleLoaded = 'true';
    if (window.parent !== window) window.parent.postMessage({ type: 'proto:profile', siteId: $('meta[name="proto-site-id"]').content, profile: { name: profile.name, category: profile.category, city: profile.city, phone: profile.phone, address: profile.address, photoCount: profile.photos.length, reviewCount: profile.reviews.length, photos: profile.photos.map((photo) => ({ url: safeUrl(photo.url), authors: photo.authors, source: photo.source })) } }, location.origin);
  }
  window.__protoChecks = () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    brokenAnchors: $$('a[href^="#"]').filter((a) => !a.hidden && a.hash && !document.getElementById(a.hash.slice(1))).map((a) => a.hash),
    loadedGoogle: document.body.dataset.googleLoaded === 'true',
    brokenImages: $$('img:not([hidden])').filter((img) => img.currentSrc && !img.closest('dialog:not([open])') && img.complete && !img.naturalWidth).map((img) => img.alt),
  });
  if (document.body.dataset.googleEnabled === 'true') {
    fetch(new URL('google.json', location.href), { cache: 'no-store' }).then(async (response) => {
      const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Google details unavailable.'); return data;
    }).then((profile) => { hydrate(profile); $('[data-google-status]').hidden = true; }).catch((error) => {
      const status = $('[data-google-status]'); status.textContent = error.message; status.classList.add('error');
      const retry = text('button', 'Retry', 'button'); retry.type = 'button'; retry.addEventListener('click', () => location.reload()); status.append(retry);
    });
  }
})();
