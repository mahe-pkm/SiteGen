(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const text = (tag, value, className = '') => {
    const node = document.createElement(tag); node.textContent = value || ''; node.className = className; return node;
  };
  const safeUrl = (value) => {
    if (!value) return '';
    try { const url = new URL(value, location.href); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password ? url.href : ''; } catch { return ''; }
  };
  function link(label, href, className = '') {
    const url = safeUrl(href);
    if (!url) return text('span', label, className);
    const node = text('a', label, className); node.href = url; node.target = '_blank'; node.rel = 'noopener noreferrer'; return node;
  }
  function credit(container, photo) {
    const mark = text('span', 'Google Maps', 'google-mark'); mark.translate = false;
    container.replaceChildren(mark);
    for (const author of photo.authors || []) container.append(text('span', ' / '), link(author.name, author.uri || photo.source));
    if (safeUrl(photo.source)) container.append(text('span', ' / '), link('View source', photo.source));
  }
  function photoUrl(photo, width = 900) {
    const value = safeUrl(photo.url); if (!value) return '';
    const url = new URL(value); url.searchParams.set('w', String(width)); return url.href;
  }
  function icon(name) {
    const img = document.createElement('img'); img.src = `./assets/${name}.svg`; img.alt = ''; img.width = 20; img.height = 20; return img;
  }
  function setText(selector, value) { $$(selector).forEach((node) => { node.textContent = value; node.hidden = !value; }); }
  function heading(node, first, last) {
    if (!node) return;
    node.replaceChildren();
    if (first) node.append(document.createTextNode(first), document.createElement('br'));
    node.append(text('em', last));
  }
  const menu = $('.menu-toggle');
  const nav = $('#main-nav');
  const closeMenu = () => {
    menu.setAttribute('aria-expanded', 'false'); menu.setAttribute('aria-label', 'Open menu'); menu.title = 'Open menu';
    menu.querySelector('img').src = './assets/menu.svg'; nav.classList.remove('is-open');
  };
  menu.addEventListener('click', () => {
    if (menu.getAttribute('aria-expanded') === 'true') return closeMenu();
    menu.setAttribute('aria-expanded', 'true'); menu.setAttribute('aria-label', 'Close menu'); menu.title = 'Close menu';
    menu.querySelector('img').src = './assets/close.svg'; nav.classList.add('is-open');
  });
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
  matchMedia('(min-width:761px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });
  function syncMenu() { menu.hidden = ![...nav.querySelectorAll('a')].some((link) => !link.hidden); }
  new MutationObserver(syncMenu).observe(nav, { attributes: true, attributeFilter: ['hidden'], subtree: true }); syncMenu();

  const photoDialog = $('[data-photo-dialog]');
  let ownerOpener;
  let currentPhoto;
  const googlePhotos = new WeakMap();
  const ownedButtons = () => $$('[data-owned-photo], [data-google-photo]').filter((button) => !button.closest('figure').hidden && !button.disabled && (!currentPhoto || button.closest('section') === currentPhoto.closest('section')));
  function showOwnedPhoto(button) {
    const source = button.querySelector('img');
    const photo = googlePhotos.get(button);
    currentPhoto = button;
    $('.large-photo').hidden = false;
    $('.large-photo').src = photo ? photoUrl(photo, 1600) : source.src; $('.large-photo').alt = source.alt;
    $('[data-photo-caption]').textContent = button.closest('figure').querySelector('h3').textContent;
    if (photo) credit($('[data-photo-credit]'), photo);
    else $('[data-photo-credit]').textContent = button.closest('figure').querySelector('figcaption>span')?.textContent || '';
    const list = ownedButtons();
    $('[data-photo-count]').textContent = `${list.indexOf(button) + 1} / ${list.length}`;
    for (const arrow of [$('.photo-prev'), $('.photo-next')]) { arrow.hidden = false; arrow.disabled = list.length < 2; }
  }
  function movePhoto(direction) {
    if (!currentPhoto) return;
    const list = ownedButtons();
    if (!list.length) return;
    showOwnedPhoto(list[(list.indexOf(currentPhoto) + direction + list.length) % list.length]);
  }
  document.addEventListener('click', (event) => {
    const button = event.target.closest('[data-owned-photo], [data-google-photo]');
    if (!button || button.disabled) return;
    ownerOpener = button; showOwnedPhoto(button); photoDialog.showModal();
  });
  $('.large-photo').addEventListener('error', () => {
    $('.large-photo').hidden = true;
    $('[data-photo-caption]').textContent = 'Photograph unavailable. Try another photo or refresh the page.';
  });
  $('.photo-prev').addEventListener('click', () => movePhoto(-1));
  $('.photo-next').addEventListener('click', () => movePhoto(1));
  photoDialog.addEventListener('keydown', (event) => {
    if (currentPhoto && ['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); movePhoto(event.key === 'ArrowLeft' ? -1 : 1); }
  });
  $('[data-close-photo]').addEventListener('click', () => photoDialog.close());
  photoDialog.addEventListener('close', () => {
    if (ownerOpener?.isConnected) ownerOpener.focus({ preventScroll: true });
    ownerOpener = null; currentPhoto = null;
    $('.photo-prev').hidden = true; $('.photo-next').hidden = true;
    $('[data-photo-caption]').textContent = ''; $('[data-photo-count]').textContent = '';
  });
  $$('[data-filter]').forEach((tab) => tab.addEventListener('click', () => {
    $$('[data-filter]').forEach((button) => button.setAttribute('aria-pressed', String(button === tab)));
    $$('#portfolio .portfolio-grid figure').forEach((figure) => { figure.hidden = tab.dataset.filter !== 'all' && figure.dataset.category !== tab.dataset.filter; });
    $('[data-gallery-status]').textContent = `Showing ${ownedButtons().length} photographs.`;
  }));
  $$('dialog').forEach((dialog) => {
    dialog.addEventListener('toggle', () => { document.body.classList.toggle('dialog-open', $$('dialog[open]').length > 0); });
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
  });

  const form = $('#enquiry-form');
  if (form) {
    const date = new Date();
    form.elements.date.min = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    $$('[data-service]').forEach((link) => link.addEventListener('click', () => { if (!form.elements.message.value.trim()) form.elements.message.value = `I'd like to discuss ${link.dataset.service} for my event.`; }));
    const enquiry = $('#enquiry-dialog');
    $$('[data-close-enquiry]').forEach((button) => button.addEventListener('click', () => enquiry.close()));
    enquiry.addEventListener('close', () => form.querySelector('[type=submit]').focus({ preventScroll: true }));
    const whatsapp = $('[data-enquiry-whatsapp]');
    const email = $('[data-enquiry-email]');
    const whatsappBase = whatsapp?.getAttribute('href');
    const emailBase = email?.getAttribute('href');
    form.addEventListener('submit', (event) => {
      event.preventDefault(); if (!form.reportValidity()) return;
      const data = new FormData(form);
      const entries = [['Occasion', data.get('occasion')], ['Name', data.get('name')], ['Email', data.get('email')], ['Date', data.get('date') || 'To be decided'], ['Guests', data.get('guests') || 'To be decided'], ['Details', data.get('message') || 'To discuss']];
      const summary = $('[data-enquiry-summary]'); summary.replaceChildren();
      for (const [label, value] of entries) {
        const term = document.createElement('dt'); const description = document.createElement('dd');
        term.textContent = label; description.textContent = value; summary.append(term, description);
      }
      // Compose locally. Opening a messaging app still requires a separate user click.
      const message = entries.map(([label, value]) => `${label}: ${value}`).join('\n');
      if (form.dataset.previewOnly !== 'true') {
        if (whatsapp) whatsapp.href = `${whatsappBase}?text=${encodeURIComponent(message)}`;
        if (email) email.href = `${emailBase}?subject=${encodeURIComponent('Event enquiry')}&body=${encodeURIComponent(message)}`;
      }
      enquiry.showModal();
    });
    form.querySelector('[type=submit]').disabled = false;
  }

  const mobileContact = $('.mobile-enquire');
  let heroVisible = true;
  let contactVisible = false;
  const observer = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.id === 'home') heroVisible = entry.isIntersecting;
      else contactVisible = entry.isIntersecting;
    }
    mobileContact.classList.toggle('visible', !heroVisible && !contactVisible);
    mobileContact.inert = heroVisible || contactVisible;
  });
  observer.observe($('#home')); observer.observe($('#contact'));
  const googleStatus = $('[data-google-status]');

  // Category wording is editorial scaffolding, not a claim about stock, services or policies.
  function profileWording(category) {
    if (/\b(clothing|apparel|boutique|fashion|garment|saree|textile)\b/i.test(category)) return {
      kind: 'retail', tagline: 'Find your next favourite.', contact: 'Visit the store', call: 'Call the store',
      gallery: ['A closer look', 'at the store.'], about: ['Your next visit,', 'a little closer.'],
      invitation: 'Take a look around, then stop by. For sizes, styles and current availability, please contact the store.',
      contactTitle: ['Come by.', 'Find your favourite.'],
    };
    if (/\b(store|shop|retail)\b/i.test(category)) return {
      kind: 'retail', tagline: 'Come in. Take a look around.', contact: 'Visit the store', call: 'Call the store',
      gallery: ['A closer look', 'at the store.'], about: ['Meet the store.', 'Plan a visit.'],
      invitation: 'Browse the photographs and plan your visit. Contact the store for current product availability.',
      contactTitle: ['Come by.', 'Say hello.'],
    };
    if (/\b(event|events|wedding|party)\b/i.test(category)) return {
      kind: 'events', tagline: 'A place to begin your next occasion.', contact: "Let's talk", call: 'Call the business',
      gallery: ['A little inspiration.', 'A closer look.'], about: ['Your occasion.', 'The next step.'],
      invitation: 'Explore the photographs, then get in touch to discuss your occasion and available dates.',
      contactTitle: ['Something lovely', 'starts here.'],
    };
    return {
      kind: 'business', tagline: "Let's make a connection.", contact: 'Get in touch', call: 'Call the business',
      gallery: ['Take a look.', 'Get to know us.'], about: ['A little about us.', 'A place to begin.'],
      invitation: 'Explore the photographs and get in touch to find out more.', contactTitle: ['A conversation', 'starts here.'],
    };
  }
  function composeProfile(profile, wording, hasPhone) {
    if (document.body.dataset.profileSite !== 'true') return;
    document.body.dataset.businessKind = wording.kind;
    setText('[data-profile-tagline]', wording.tagline);
    const intro = [profile.category, profile.city].filter(Boolean).join(' in ');
    setText('[data-profile-intro]', intro ? `${intro}.` : '');
    setText('[data-contact-label]', wording.contact);
    setText('[data-call-label]', wording.call);
    setText('[data-visit-band-title]', profile.city || profile.name);
    if ($('[data-visit-band]')) $('[data-visit-band]').hidden = false;
    heading($('[data-gallery-title]'), ...wording.gallery);
    heading($('[data-profile-contact-title]'), ...wording.contactTitle);
    setText('[data-profile-contact-intro]', wording.kind === 'retail' ? 'Plan a visit or call the store with your questions.' : 'Get in touch to start a conversation.');
    if (!hasPhone && wording.kind === 'retail') setText('[data-profile-contact-intro]', 'Find the store and plan your visit.');
    const about = $('[data-profile-about]');
    if (about) {
      heading($('[data-profile-about-title]'), ...wording.about);
      const detail = [profile.category, profile.city && `in ${profile.city}`].filter(Boolean).join(' ');
      setText('[data-profile-about-copy]', detail ? `${profile.name} - ${detail}.` : profile.name);
      setText('[data-profile-about-invitation]', wording.invitation);
      about.hidden = false; $$('[data-about-nav]').forEach((node) => { node.hidden = false; });
    }
    const faq = $('[data-profile-faq-list]');
    if (faq) {
      const entries = [];
      if (profile.address) entries.push(['Where can I find you?', profile.address]);
      if (profile.hours.length) entries.push(['What are your opening hours?', `${profile.hours.join('\n')}\nHours may differ on holidays. Check before travelling.`]);
      if (hasPhone) entries.push([wording.kind === 'retail' ? 'How can I check item availability?' : 'How can I get in touch?', wording.kind === 'retail' ? `Call ${profile.phone} to ask about items, sizes and availability before your visit.` : `Call ${profile.phone} to speak with the business.`]);
      for (const [question, answer] of entries) {
        const details = document.createElement('details'); const summary = text('summary', question); summary.append(icon('plus'));
        details.append(summary, text('p', answer)); faq.append(details);
      }
      $('[data-profile-faq]').hidden = !entries.length;
      $$('[data-faq-nav]').forEach((node) => { node.hidden = !entries.length; });
      if (wording.kind !== 'retail') heading($('#faq-title'), 'A few things', 'you might ask.');
    }
  }
  function hydrate(profile) {
    if (!profile || typeof profile.name !== 'string' || !profile.name.trim()) throw new Error('Missing business name');
    for (const key of ['photos', 'reviews', 'hours', 'attributions']) if (!Array.isArray(profile[key])) profile[key] = [];
    const wording = profileWording(profile.category || '');
    const hasPhone = Boolean(profile.phone && /^[+\d\s().-]+$/.test(profile.phone) && /\d{3}/.test(profile.phone.replace(/\D/g, '')));
    const rating = Number.isFinite(profile.rating) ? profile.rating.toFixed(1) : '';
    const values = { name: profile.name, category: profile.category, city: profile.city, address: profile.address,
      rating, reviewCount: `${Number(profile.reviewCount || 0).toLocaleString()} Google reviews` };
    $$('[data-live]').forEach((node) => { node.textContent = values[node.dataset.live] || ''; });
    setText('[data-profile-brand]', profile.name);
    $$('[data-brand-home]').forEach((node) => {
      node.setAttribute('aria-label', `${profile.name} home`);
      const logo = node.querySelector('img'); if (logo) logo.alt = `${profile.name} logo`;
    });
    const words = profile.name.trim().split(/\s+/); const last = words.pop();
    heading($('[data-profile-heading]'), words.join(' '), last);
    if (document.body.dataset.reference === 'true') {
      document.title = [profile.name, profile.city || profile.category].filter(Boolean).join(' | ');
      const description = [profile.name, profile.category, profile.city].filter(Boolean).join(' - ');
      $('meta[name="description"]').content = description;
      $('meta[property="og:title"]').content = document.title; $('meta[property="og:description"]').content = description;
    }
    $$('[data-maps-link]').forEach((node) => { if (safeUrl(profile.googleMapsUri)) { node.href = safeUrl(profile.googleMapsUri); node.hidden = false; } });
    if (hasPhone) $$('[data-live-phone]').forEach((node) => { node.href = `tel:${profile.phone.replace(/[^+\d]/g, '')}`; node.hidden = false; });
    const hours = $('[data-hours]');
    if (hours && !hours.textContent.trim() && profile.hours.length) {
      for (const line of profile.hours) {
        const row = text('div', '', 'hour-row'); const separator = line.indexOf(':');
        row.append(text('span', separator < 0 ? line : line.slice(0, separator)), text('span', separator < 0 ? '' : line.slice(separator + 1).trim())); hours.append(row);
      }
      $('[data-hours-block]').hidden = false;
    }
    for (const item of profile.attributions) $('[data-provider-note]').append(link(item.provider, item.providerUri));
    $('[data-profile-strip]').hidden = !rating;
    $('.review-summary').hidden = !rating;
    composeProfile(profile, wording, hasPhone);

    const photos = profile.photos.filter((photo) => safeUrl(photo.url));
    if (photos.length) {
      const hero = $('[data-hero-photo]');
      if (hero) {
        let photo = photos[Number(document.body.dataset.heroIndex)] || photos[0];
        const attempted = new Set();
        hero.addEventListener('load', () => { hero.hidden = false; $('.hero').classList.add('has-image'); credit($('[data-hero-credit]'), photo); });
        hero.addEventListener('error', () => {
          hero.hidden = true; $('.hero').classList.remove('has-image'); $('[data-hero-credit]').replaceChildren();
          attempted.add(photo); photo = photos.find((item) => !attempted.has(item));
          if (photo) hero.src = photoUrl(photo, 1600);
        });
        hero.src = photoUrl(photo, 1600); hero.alt = `${profile.name} - Google profile photograph`;
      }
      $('#gallery').hidden = false; $$('[data-gallery-nav]').forEach((node) => { node.hidden = false; });
      for (const [index, photo] of photos.entries()) {
        const figure = document.createElement('figure'); const button = document.createElement('button'); button.type = 'button'; button.className = 'photo-button'; button.dataset.googlePhoto = '';
        button.setAttribute('aria-label', `View ${profile.name}, photograph ${index + 1}`);
        const img = document.createElement('img'); img.src = photoUrl(photo); img.alt = `${profile.name}, photograph ${index + 1}`; img.loading = 'lazy'; img.width = 1100; img.height = 734;
        const open = text('span', '', 'photo-open'); open.append(icon('plus'));
        img.addEventListener('load', () => { if (img.naturalHeight > img.naturalWidth * 1.15) img.classList.add('portrait'); });
        img.addEventListener('error', () => { img.hidden = true; open.className = 'photo-unavailable'; open.textContent = 'Photo unavailable'; button.disabled = true; });
        button.append(img, open); googlePhotos.set(button, photo);
        const caption = document.createElement('figcaption'); const credits = text('div', '', 'photo-attribution'); credit(credits, photo);
        caption.append(text('h3', `A closer look / ${String(index + 1).padStart(2, '0')}`), credits); figure.append(button, caption); $('[data-gallery]').append(figure);
      }
      const about = $('[data-about-photo]');
      if (about) {
        const photo = photos.find((_, index) => index !== Number(document.body.dataset.heroIndex)) || photos[0];
        // A lazy image inside a hidden parent never becomes eligible to load.
        about.hidden = false; $('[data-profile-about]').classList.remove('text-only');
        const img = about.querySelector('img'); img.alt = `${profile.name} - Google profile photograph`;
        img.addEventListener('error', () => { about.hidden = true; img.hidden = true; $('[data-profile-about]').classList.add('text-only'); });
        img.src = photoUrl(photo);
        credit($('[data-about-credit]'), photo);
      }
    }
    if (profile.reviews.length) {
      $('#reviews').hidden = false; $$('[data-review-nav]').forEach((node) => { node.hidden = false; });
      for (const review of profile.reviews) {
        const article = text('article', '', 'review'); const header = text('div', '', 'review-header');
        if (safeUrl(review.avatar)) {
          const avatar = document.createElement('img'); avatar.src = safeUrl(review.avatar); avatar.alt = review.author; avatar.loading = 'lazy'; avatar.referrerPolicy = 'no-referrer'; avatar.addEventListener('error', () => avatar.remove()); header.append(avatar);
        }
        const byline = document.createElement('div'); byline.append(link(review.author, review.authorUri || review.source, 'review-author'), text('span', review.date, 'review-date')); header.append(byline);
        article.append(header, text('div', `${review.rating} / 5 stars`, 'review-rating'));
        const reviewText = review.text || '';
        if (reviewText.length > 380) { const details = document.createElement('details'); details.append(text('summary', 'Read review'), text('p', reviewText)); article.append(text('p', reviewText.slice(0, 260) + '...'), details); }
        else article.append(text('p', reviewText));
        if (review.originalLanguage && review.language && review.originalLanguage !== review.language) article.append(text('p', 'Translated by Google', 'review-date'));
        article.append(link('View original on Google Maps', review.source, 'review-source')); $('[data-reviews]').append(article);
      }
    }
    if (['CLOSED_TEMPORARILY', 'CLOSED_PERMANENTLY'].includes(profile.businessStatus)) {
      googleStatus.textContent = profile.businessStatus === 'CLOSED_PERMANENTLY' ? 'Listed as permanently closed on Google Maps.' : 'Listed as temporarily closed on Google Maps.';
      googleStatus.classList.add('closure-notice'); googleStatus.hidden = false;
      setText('[data-contact-label]', 'View contact details'); setText('[data-profile-contact-intro]', 'Check the current business status before making a visit.');
    } else googleStatus.hidden = true;
    document.body.dataset.googleLoaded = 'true';
    if (window.parent !== window) window.parent.postMessage({ type: 'proto:profile', siteId: $('meta[name="proto-site-id"]').content,
      profile: { name: profile.name, category: profile.category, city: profile.city, phone: profile.phone, address: profile.address, photoCount: photos.length, reviewCount: profile.reviews.length,
        photos: photos.map((photo) => ({ url: safeUrl(photo.url), authors: photo.authors || [], source: photo.source })) } }, location.origin);
  }
  if (document.body.dataset.googleEnabled === 'true') {
    fetch(new URL('google.json', location.href), { cache: 'no-store', signal: AbortSignal.timeout(20000) }).then(async (response) => {
      if (!response.ok) throw new Error('Business details unavailable'); return response.json();
    }).then(hydrate).catch(() => {
      document.body.dataset.googleLoaded = 'false'; googleStatus.hidden = false; googleStatus.classList.add('error');
      googleStatus.replaceChildren(text('span', 'Business details are temporarily unavailable. '));
      const retry = text('button', 'Retry', 'button'); retry.type = 'button'; retry.addEventListener('click', () => location.reload()); googleStatus.append(retry);
    });
  }
  window.__protoChecks = () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    brokenAnchors: $$('a[href^="#"]').filter((a) => !a.hidden && a.hash && !document.getElementById(a.hash.slice(1))).map((a) => a.hash),
    loadedGoogle: document.body.dataset.googleLoaded === 'true',
    brokenImages: $$('img:not([hidden])').filter((img) => img.currentSrc && !img.closest('dialog:not([open])') && img.complete && !img.naturalWidth).map((img) => img.alt),
  });
})();
