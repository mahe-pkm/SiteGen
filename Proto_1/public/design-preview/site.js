(() => {
  'use strict';
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const menu = $('.menu-toggle');
  const nav = $('#main-nav');
  function closeMenu() {
    menu.setAttribute('aria-expanded', 'false');
    menu.setAttribute('aria-label', 'Open menu');
    menu.title = 'Open menu';
    menu.querySelector('img').src = './assets/menu.svg';
    nav.classList.remove('is-open');
  }
  menu.addEventListener('click', () => {
    if (menu.getAttribute('aria-expanded') === 'true') return closeMenu();
    menu.setAttribute('aria-expanded', 'true'); menu.setAttribute('aria-label', 'Close menu'); menu.title = 'Close menu';
    menu.querySelector('img').src = './assets/close.svg'; nav.classList.add('is-open');
  });
  nav.addEventListener('click', (event) => { if (event.target.closest('a')) closeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && menu.getAttribute('aria-expanded') === 'true') { closeMenu(); menu.focus(); } });
  matchMedia('(min-width:761px)').addEventListener('change', (event) => { if (event.matches) closeMenu(); });

  const figures = $$('.portfolio-grid figure');
  const photos = figures.map((figure) => ({ src: figure.querySelector('.photo-button>img').getAttribute('src'), alt: figure.querySelector('.photo-button>img').alt, title: figure.querySelector('h3').textContent }));
  let filteredIndices = photos.map((_, index) => index);
  let currentIndex = 0;
  let opener;
  const photoDialog = $('#photo-dialog');
  function showPhoto(index) {
    currentIndex = index;
    const photo = photos[index];
    $('.large-photo').src = photo.src; $('.large-photo').alt = photo.alt;
    $('#photo-caption').textContent = photo.title;
    $('[data-photo-count]').textContent = `${filteredIndices.indexOf(index) + 1} / ${filteredIndices.length}`;
    $('.photo-prev').disabled = filteredIndices.length < 2;
    $('.photo-next').disabled = filteredIndices.length < 2;
  }
  function movePhoto(direction) {
    const position = filteredIndices.indexOf(currentIndex);
    showPhoto(filteredIndices[(position + direction + filteredIndices.length) % filteredIndices.length]);
  }
  function openDialog(dialog, source) {
    opener = source;
    dialog.showModal();
    document.body.classList.add('dialog-open');
  }
  $$('[data-photo]').forEach((button) => button.addEventListener('click', () => { showPhoto(Number(button.dataset.photo)); openDialog(photoDialog, button); }));
  $('.photo-prev').addEventListener('click', () => movePhoto(-1));
  $('.photo-next').addEventListener('click', () => movePhoto(1));
  photoDialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); movePhoto(event.key === 'ArrowRight' ? 1 : -1); }
  });
  $$('[data-filter]').forEach((button) => button.addEventListener('click', () => {
    const category = button.dataset.filter;
    $$('[data-filter]').forEach((tab) => tab.setAttribute('aria-pressed', String(tab === button)));
    filteredIndices = [];
    figures.forEach((figure, index) => { figure.hidden = category !== 'all' && figure.dataset.category !== category; if (!figure.hidden) filteredIndices.push(index); });
    $('[data-gallery-status]').textContent = `Showing ${filteredIndices.length} ${category === 'all' ? '' : category + ' '}photograph${filteredIndices.length === 1 ? '' : 's'}.`;
  }));

  $$('dialog').forEach((dialog) => {
    dialog.querySelectorAll('[data-close-dialog]').forEach((button) => button.addEventListener('click', () => dialog.close()));
    dialog.addEventListener('click', (event) => {
      if (event.target !== dialog) return;
      const box = dialog.getBoundingClientRect();
      if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.close();
    });
    dialog.addEventListener('close', () => { document.body.classList.remove('dialog-open'); if (opener?.isConnected) opener.focus({ preventScroll: true }); });
  });
  $('[data-open-credits]').addEventListener('click', (event) => openDialog($('#credits-dialog'), event.currentTarget));

  const form = $('#enquiry-form');
  const date = new Date();
  form.elements.date.min = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  $$('[data-occasion]').forEach((link) => link.addEventListener('click', () => {
    const radio = [...form.elements.occasion].find((input) => input.value === link.dataset.occasion);
    if (radio) radio.checked = true;
  }));
  $$('[data-service]').forEach((link) => link.addEventListener('click', () => {
    if (!form.elements.message.value.trim()) form.elements.message.value = `I'd like to discuss ${link.dataset.service.toLowerCase()} for my event.`;
  }));
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    const entries = [['Occasion', data.get('occasion')], ['Name', data.get('name')], ['Email', data.get('email')], ['Date', data.get('date') || 'To be decided'], ['Guests', data.get('guests') || 'To be decided'], ['Details', data.get('message') || 'To discuss at consultation']];
    const summary = $('[data-enquiry-summary]'); summary.replaceChildren();
    // A local-only preview: no fetch, storage, mailto, or messaging side effect.
    for (const [label, value] of entries) {
      const dt = document.createElement('dt'); const dd = document.createElement('dd');
      dt.textContent = label; dd.textContent = value; summary.append(dt, dd);
    }
    openDialog($('#enquiry-dialog'), form.querySelector('[type=submit]'));
  });
  let heroVisible = true;
  let contactVisible = false;
  const mobileEnquire = $('.mobile-enquire');
  new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (entry.target.id === 'home') heroVisible = entry.isIntersecting;
      if (entry.target.id === 'contact') contactVisible = entry.isIntersecting;
    }
    mobileEnquire.classList.toggle('visible', !heroVisible && !contactVisible);
    mobileEnquire.inert = heroVisible || contactVisible;
  }, { threshold: 0 }).observe($('#home'));
  new IntersectionObserver(([entry]) => {
    contactVisible = entry.isIntersecting;
    mobileEnquire.classList.toggle('visible', !heroVisible && !contactVisible);
    mobileEnquire.inert = heroVisible || contactVisible;
  }).observe($('#contact'));

  window.__designChecks = () => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    brokenAnchors: $$('a[href^="#"]').filter((a) => a.hash && !document.getElementById(a.hash.slice(1))).map((a) => a.hash),
    brokenImages: $$('img').filter((img) => img.currentSrc && img.complete && !img.naturalWidth).map((img) => img.getAttribute('src')),
    externalResources: performance.getEntriesByType('resource').filter((resource) => !resource.name.startsWith(location.origin + '/')).map((resource) => resource.name),
    h1Count: $$('h1').length,
  });
})();
