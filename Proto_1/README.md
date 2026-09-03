# Proto_1: Local Prototype

This folder is independent of the earlier `../app` prototype. Develop and test
locally; VPS setup and deployment require separate approval.

## Run

Requires Node.js 24 or later within the package.json supported range.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:3100/ rather than opening index.html directly. Set PORT
to another available port if necessary. The development server binds to the
local computer by default.

Configure Proto_1/.env using .env.example. In the original development workspace
only, the backend can also read GOOGLE_MAPS_API_KEY from `../app/.env.local`.
That older application is not included in this repository or required to run it.
Never commit credentials or paste them into chat. Configuration presence does
not guarantee API access; verify with a lookup.

## Separate Design Proposal

Open http://127.0.0.1:3100/design-preview/index.html or use **Design proposal**
in the builder header. Unlike the builder, this standalone page also works by
opening `public/design-preview/index.html` directly.

This is a fictional Willow Gatherings visual proposal, not a replacement for
saved websites. Photos, fonts, and Lucide icons are served locally. The gallery,
mobile navigation, FAQs, and enquiry summary work; the form does not send or
store information. No Google or AI requests are made by this page.

The approved design is now available as **Signature** in the builder. The original
proposal remains unchanged. A real business version still needs approved identity,
copy, imagery, and an enquiry destination. Existing Google displays retain their
attribution. Asset provenance is in `public/design-preview/SOURCES.md`.

Browser regression checks after opening the proposal with agent-browser:

```powershell
Get-Content scripts/check-design-preview.browser.js -Raw | npx --yes agent-browser --session signature eval --stdin
```

## Current Flow

1. Enter a Google Maps link, Place ID, or business name and city.
2. Select the result and immediately generate a Signature website preview.
3. The preview loads current Google identity, contact, hours, up to six photos,
   and up to five reviews, with source/author attribution. Missing fields and
   unsupported sections are not invented. Google determines review selection.
   Signature preserves the styled business name in the hero, header and footer.
   Clothing/retail and event categories receive different editorial headings and
   contact wording; other categories use neutral wording. An About section and
   address/hours/contact FAQs are composed from available fields when there are
   no independent overrides. No manual brief or AI request is needed for this.
4. Optionally supply an independent owner/licensed brief in AI Writer. Confirm
   permission, generate structured copy, review its source excerpts, and apply
   individual sections or only missing sections. Save to create a new release.
5. In Design, select a template, short brand name, logo, owned hero/gallery images,
   palette and typography. Reference drafts require separate confirmation for
   independent branding and uploaded media. Google photo selection is an ordinal
   preference; it may change if Google's photo order changes.
6. Check desktop/mobile previews and copy the local URL. A local URL is not a
   public deployment and will not open on the recipient's device.

Manual drafts and clearly labelled fictional samples are also available. Existing
Events/Atelier/Local records are retained unchanged until explicitly edited. Select
Signature or Events for detailed sections. The editor URL retains the selected
site, but unsaved edits and unapplied AI candidates are not restored on reload.

The fictional sample is explicitly labelled and cannot be publicly published.
Google lookup/display content is transient, not saved into the business content
store or generated files. Reference records retain a Place ID and neutral labels,
not copied business names, phone numbers, reviews, or images. Independently
supplied copy may be retained separately. This is not a promise that all Google
Business Profile fields are available; GBP management OAuth remains separate.

### Static Files And Live Display

Signature and Events generate HTML, CSS, trusted JavaScript, and owned image assets.
The Google reference version is a **static shell with a live server dependency**,
not a self-contained offline HTML export. Its `google.json` and signed
`google-photo/:token` endpoints must run on the same origin. Both return no-store
responses. Photo tokens expire after 15 minutes or a server restart; refresh the
preview to obtain new ones. Photos are streamed into a bounded memory buffer,
never copied into artifact storage. API keys remain server-side.

Owner/licensed sites without live Google display have no Google runtime dependency.
Do not scrape/export the live preview into a permanently stored Google-content site.

Signature packages local fonts, Lucide icons, a logo and up to nine gallery photos
into each release. Empty independent sections are omitted. Google-reference
pages add live About/FAQ sections only where the available data supports them.
Google photographs use the Signature gallery and keyboard-accessible lightbox,
with author and source links. Portrait gallery images retain their full frame;
the hero honors the selected photo and tries another if that image fails.
Independent copy and branding take precedence over automatic defaults. No stock,
prices, services, return policies or completed-project claims are inferred. The
standalone proposal's invented process copy is not copied into real websites.

For independent sites with an email or WhatsApp number, the enquiry form composes
a message locally and requires a separate click to open the user's messaging app.
It does not send messages or persist enquiry data. Google-reference sites use the
live phone/directions actions; no WhatsApp number is inferred from a Google phone.
Fictional sample enquiry forms remain preview-only. This is not a form-delivery
backend or Meta integration.

The generated fictional Signature sample can be browser-checked with:

```powershell
Get-Content scripts/check-signature.browser.js -Raw | npx --yes agent-browser --session integration eval --stdin
```

### AI Writer

Set `OPENROUTER_API_KEY` in the local environment or ignored `.env`; never in chat
or browser code. Existing process environment credentials are supported. Current
defaults are `google/gemini-3.8-flash` for writing and `anthropic/claude-sonnet-5`
for up to two content-repair attempts. Configure model IDs in `.env.example`.

- Only the explicitly supplied brief goes to OpenRouter, never Google API data.
- Strict JSON schema, verbatim source-excerpt checks, and basic unsupported
  number/claim checks run before a candidate is returned. These do not establish
  factual entailment; a human must review the draft before applying it.
- AI never generates executable site code, runs tools, changes saved copy, or
  accesses SSH/deployment. Repairs are limited to invalid content responses.
- Routing requires schema support, ZDR and no provider data collection. A model
  lacking a compatible endpoint fails visibly; privacy is not silently relaxed.
- Defaults: $0.50 maximum reserved per job, $5/day (UTC), three total attempts.
  Failed/interrupted requests retain their reservation; missing actual costs use
  the reservation. This is a local guard, not an OpenRouter account-wide limit.
- Successful idempotent retries return the stored candidate without new inference.
  Changing the input requires a new request. Only one request per site runs at once.

Generated files are in `.data/artifacts/<site-id>/<version>/`. Business records
and job history are in `.data/prototype.sqlite`; uploaded images are in
`.data/uploads/`. These files and credentials are ignored by Git.

## Verify

```powershell
npm test
npm run build
```

Tests use temporary isolated databases and mocked Google/OpenRouter responses.
They cover generation, edits/releases, secret handling, Google-content separation,
signed photo access, source checks, AI repair ceilings, idempotency and budgets.
They never contact or deploy to the VPS. Live API and browser checks are separate.

Local verification on 2026-09-03: Google profile/photographs/reviews loaded for the
Moon & Olive Place ID; a fictional Willow Gatherings brief completed one live AI
writer request. AI repairs are covered by mocks, not a live repair-model benchmark.

Signature integration verification: 36 tests and the production build pass; the
generated fictional sample passed 26 browser interaction checks. A new Signature
reference draft loaded six live Google photos, five reviews, phone/directions and
photo-source links. Desktop and 320px mobile checks reported no horizontal
overflow or broken internal links. Existing five records were not modified.

Signature live-generation follow-up (2026-09-03): 36 tests and the production
build pass. `scripts/check-signature-live.mjs` passes 260 browser assertions
across 14 isolated fixtures at 1440/390/320px, including custom-copy preservation,
long names, photo failure/fallback, natural lazy loading, Google attribution,
mobile navigation, missing fields, closed businesses and sanitized errors.
It uses temporary HTTP fixtures, not the project database or real API calls.
Run with Playwright and Chrome installed; `PLAYWRIGHT_MODULE` may point to the
bundled Playwright `index.mjs` as a file URL if it is not locally installed:

```powershell
node scripts/check-signature-live.mjs
```

An existing retail draft was also verified locally with a selected hero, six
gallery images, reviews, factual FAQs, and phone/directions links. Saved local
drafts and generated releases are not included in this repository. These checks
do not establish public deployment readiness or an offline Google export.

## Deployment Boundary

Keep PUBLIC_DEPLOY_ENABLED=false. Anonymous/public publishing is still disabled.
A separate protected staging integration is now implemented locally:
`server/staging.js`, `server/staging-gateway.js`, and the editor's Checks > Test
deployment panel. Generate, review the saved release, approve a routing label,
then explicitly publish the test site. Regeneration never publishes implicitly.

The builder uploads allowlisted files with SHA-256 checksums to the gateway,
verifies candidate assets/Google data over HTTPS, then activates that version.
Failed candidate verification leaves the active version unchanged. Old releases
are retained. The gateway uses separate administration and review credentials,
rejects customer-host API access, and serves Google data transiently with the
existing attribution and quotas. Demo records remain blocked from the pilot.

Configure STAGING_ORIGIN, STAGING_DEPLOY_TOKEN, STAGING_REVIEW_USERNAME and
STAGING_REVIEW_PASSWORD only in the local ignored environment after installation.
The running local backend must be restarted to load these new modules/settings.
On 2026-09-03, the protected gateway was deployed and its HTTPS, authentication,
Google API connectivity and isolation from existing VPS services were verified.
Local connection settings are saved in an ignored environment file. The local
backend restart and the first reviewed customer-site deployment remain pending.
Existing local records and generated releases were not changed.

See `deploy/README.md` for the Hostinger target, isolated DNS records, container
setup, installation gates, and rollback. Verify both the gateway and wildcard
DNS records before installation; repository state does not establish current
DNS propagation. Do not change the VPS resolver or main-domain DNS as a shortcut.

Staging verification: 43 unit/integration tests plus the production build passed;
15 isolated browser checks cover the review gate, failure/retry, persisted test
link, routing label, dirty-state protection, and 1440/390/320px layouts:

```powershell
node scripts/check-staging-ui.mjs
```

The browser script uses Playwright/Chrome with temporary local data and mocked
network deployment, not the VPS. It accepts the same PLAYWRIGHT_MODULE override
as the Signature browser script. The gateway's DNS/TLS/container verification
passed; a real customer release still needs end-to-end verification. Review
Google terms/attribution, allowed data uses, rate limits,
privacy/terms pages and business authorization before any public launch.

Meta/WhatsApp intake, automatic message delivery, billing, and GBP management
OAuth are not implemented.

## Sample Asset

The illustrative interior is a template image, not a photograph of the selected
business. Source: https://images.unsplash.com/photo-1497366754035-f200968a6e72
Use business-owned imagery for a real site; do not misrepresent the sample.
