# SiteGen

A locally developed Google Places website-builder prototype. The active
application lives in `Proto_1/`; the earlier prototype and local working data
are intentionally not included.

## Run Locally

Requires Node.js 24, 25, or 26, as specified in `Proto_1/package.json`.

```sh
cd Proto_1
npm ci
npm run dev
```

Open http://127.0.0.1:3100/. Configure server-side credentials in an ignored
`Proto_1/.env`, using `.env.example` for the available settings. Never put API
keys in frontend code or commit them. Fictional samples and automated tests do
not require live API credentials.

## Verify

```sh
cd Proto_1
npm run check
```

This runs the isolated unit/integration tests and production frontend build.
Optional browser checks are documented in [the application guide](Proto_1/README.md).

## Included

- Builder UI, Node/Express backend, website templates and required local assets.
- Package manifest and lockfile, tests and browser verification scripts.
- Asset provenance and third-party licenses.
- Protected VPS gateway Docker configuration and deployment instructions.

Credentials, databases, generated customer sites, uploads, logs, dependencies,
build output, backups and duplicate source photographs are excluded. Git tracks
application code; it is not a backup of runtime data or generated websites.

## Deployment

The intended pilot flow is Generate -> Review -> Publish -> Share manually.
The prepared gateway requires an explicitly configured VPS, DNS, HTTPS and
separate review credentials. Pushing this repository does not deploy a server
or publish customer websites. No automatic deployment workflow is enabled.

Google-backed pages are static HTML/CSS/JS shells with live backend endpoints;
they are not offline exports of Google content. Anonymous publishing remains
disabled. See [the application guide](Proto_1/README.md) and
[the protected staging guide](Proto_1/deploy/README.md).
