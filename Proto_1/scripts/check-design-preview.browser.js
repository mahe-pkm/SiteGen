(async () => {
  const $ = (selector) => document.querySelector(selector);
  const checks = [];
  const check = (name, condition) => {
    if (!condition) throw new Error(name);
    checks.push(name);
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 80));
  const visiblePhotos = () => [...document.querySelectorAll('.portfolio-grid figure')].filter((figure) => !figure.hidden);
  const initialStorage = JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]);
  const form = $('#enquiry-form');
  const previousFields = [...form.elements].map((input) => ({ input, value: input.value, checked: input.checked }));
  try {
    $('.menu-toggle').click();
    const wasOpened = $('.menu-toggle').getAttribute('aria-expanded') === 'true';
    if (!wasOpened) $('.menu-toggle').click();
    check('mobile menu opens', $('.menu-toggle').getAttribute('aria-expanded') === 'true');
    $('#main-nav a[href="#gallery"]').click();
    check('navigation closes menu', $('.menu-toggle').getAttribute('aria-expanded') === 'false');

    $('[data-filter="styling"]').click();
    check('styling filter shows two photos', visiblePhotos().length === 2);
    $('[data-filter="venues"]').click();
    check('venue filter shows one photo', visiblePhotos().length === 1);
    check('filter pressed state', $('[data-filter="venues"]').getAttribute('aria-pressed') === 'true');
    $('[data-photo="1"]').click();
    check('photo dialog opens', $('#photo-dialog').open);
    check('single image disables navigation', $('.photo-prev').disabled && $('.photo-next').disabled);
    await $('.large-photo').decode();
    check('lightbox image loads', $('.large-photo').naturalWidth > 0);
    $('#photo-dialog [data-close-dialog]').click();
    await settle();
    check('lightbox restores focus', document.activeElement === $('[data-photo="1"]'));
    $('[data-filter="all"]').click();
    check('all filter restores three photos', visiblePhotos().length === 3);
    $('[data-photo="0"]').click();
    $('#photo-dialog').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    check('keyboard photo navigation wraps', $('[data-photo-count]').textContent === '3 / 3');
    $('.photo-next').click();
    check('next photo navigation wraps', $('[data-photo-count]').textContent === '1 / 3');
    $('#photo-dialog [data-close-dialog]').click();
    await settle();

    const faq = $('.faq-list details');
    faq.open = false;
    faq.querySelector('summary').click();
    check('FAQ expands', faq.open);
    faq.querySelector('summary').click();
    check('FAQ collapses', !faq.open);
    $('[data-occasion="Birthday"]').click();
    check('occasion link selects form choice', form.elements.occasion.value === 'Birthday');
    form.elements.message.value = '';
    $('[data-service="Floral styling"]').click();
    check('service link supplies enquiry context', form.elements.message.value.includes('floral styling'));
    form.elements.message.value = 'Existing enquiry';
    $('[data-service="Venue coordination"]').click();
    check('service link preserves existing message', form.elements.message.value === 'Existing enquiry');

    form.elements.name.value = '';
    form.elements.email.value = '';
    form.requestSubmit();
    check('empty enquiry cannot open summary', !$('#enquiry-dialog').open && !form.checkValidity());
    form.elements.name.value = 'Local QA';
    form.elements.email.value = 'not-an-email';
    form.requestSubmit();
    check('invalid email cannot open summary', !$('#enquiry-dialog').open && !form.checkValidity());
    form.elements.email.value = 'local-qa@example.com';
    form.elements.message.value = '<b>Literal text, not markup</b>';
    form.requestSubmit();
    check('valid enquiry opens preview', $('#enquiry-dialog').open);
    check('enquiry is safely text rendered', $('[data-enquiry-summary]').textContent.includes('<b>Literal text, not markup</b>') && !$('[data-enquiry-summary] b'));
    $('#enquiry-dialog [data-close-dialog]').click();
    await settle();
    check('closing enquiry preserves inputs', form.elements.name.value === 'Local QA');
    $('[data-open-credits]').click();
    check('credits dialog opens', $('#credits-dialog').open);
    $('#credits-dialog [data-close-dialog]').click();
    await settle();
    check('dialogs release scroll lock', !document.body.classList.contains('dialog-open'));
    check('no browser persistence', JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie]) === initialStorage);
    const layout = window.__designChecks();
    check('no horizontal overflow', !layout.overflow);
    check('anchors and images resolve', !layout.brokenAnchors.length && !layout.brokenImages.length);
    check('no external resources', !layout.externalResources.length);
    return { passed: checks.length, checks, layout };
  } finally {
    for (const { input, value, checked } of previousFields) {
      if (input.type !== 'file') input.value = value;
      input.checked = checked;
    }
    document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
    $('[data-filter="all"]').click();
  }
})();
