# Protected Hostinger Pilot

## Verified Target

Read-only inspection on 2026-09-03 confirmed SSH `root@213.210.37.204` and host
`srv1773065`. Docker, Coolify and Traefik v3.6 already run here. The proxy uses
the `coolify` network, entrypoints `http`/`https`, the `letsencrypt` HTTP challenge
resolver, and `/data/coolify/proxy/dynamic` as its watched file directory.
Existing Coolify, Supabase, Buzl and Formhub containers must not be modified.

## DNS Boundary

The authoritative nameservers for rclk.in are `lunar.dns-parking.com` and
`solar.dns-parking.com`, not this VPS. Changing `/etc/hosts`, installing a DNS
daemon, or editing the VPS resolver does not configure public DNS.

Add only these records in Hostinger DNS:

| Type | Name | Target | TTL |
| --- | --- | --- | --- |
| A | preview | 213.210.37.204 | 300 |
| A | *.preview | 213.210.37.204 | 300 |

Keep the apex, www, mail, TXT/CAA, and all existing records unchanged. Check for
conflicting AAAA/CNAME records at these exact new names before adding records.
DNS changes have NOT been made by the current implementation.

## Architecture

- Develop/generate in the existing local builder. No source development on VPS.
- Deploy only the isolated gateway container, not the builder or its database.
- Gateway: `preview.rclk.in`; reviewed sites: `<label>-<id>.preview.rclk.in`.
- Every site and candidate URL requires the review username/password.
- Upload endpoints require a separate long server-side bearer token and only
  accept the gateway hostname. Customer hosts cannot reach administration APIs.
- No application ports are exposed publicly. Port 3310 binds to loopback only.
- The gateway trusts exactly one reverse-proxy hop for client rate limits.
  Keep Traefik as the only public entrypoint; do not expose the container port
  directly or insert another proxy without reviewing this setting. Host-based
  access checks continue to use the original Host header, not forwarded hosts.
- `prepare` uploads a checksummed, allowlisted immutable release. A per-host
  Traefik router triggers an individual certificate using HTTP-01, not a
  wildcard certificate or a new DNS challenge per business.
- The local publisher checks all assets over real HTTPS and checks Google data
  before `activate` switches the active release. Compare-and-set activation
  rejects stale operations. Retrying the identical release is idempotent.
- The gateway stores only release metadata, reviewed routing labels, place_id
  and liveGoogle configuration. Google responses/photos remain transient.
- New local generation never automatically publishes. Reference-only public
  publishing remains disabled; this is a separate authenticated test channel.

## Installation Gate

1. Run `npm run check` and the staging browser checks locally.
2. Verify both DNS records against the authoritative nameserver.
3. Capture the existing proxy file hashes and container state.
4. Package only package.json, package-lock.json, server/ and deploy/ locally.
   Never include `.env`, `.data`, uploads, npm caches or the old app directory.
5. Upload that release to a new `/opt/proto1-staging/releases/<timestamp>` folder.
6. Create `/opt/proto1-staging/data` owned by UID 1000, mode 700, and a dedicated
   `/data/coolify/proxy/dynamic/proto1-staging.yaml` file owned by UID 1000.
   Never replace an existing file without an explicit backup and read-back.
7. Store secrets in `/opt/proto1-staging/secrets.env`, mode 600, root-owned:
   STAGING_HOST=preview.rclk.in, STAGING_DEPLOY_TOKEN (at least 32 random chars),
   STAGING_REVIEW_USERNAME=review, STAGING_REVIEW_PASSWORD (at least 20 random
   chars), GOOGLE_MAPS_API_KEY, LOOKUP_DAILY_LIMIT and PHOTO_DAILY_LIMIT.
   Generate credentials locally; do not paste credentials into chat or commands.
8. Validate `docker compose -p proto1-staging -f deploy/compose.yml config --quiet`
   from the uploaded release, then build/start only that Compose project.
9. Verify protected gateway responses, TLS, Google connectivity and unchanged
   existing services before enabling STAGING_* in the local ignored environment.
10. Restart the local Node process to load the new backend modules/configuration.
    Vite reloads React files only; it does not reload Express/configuration.

## Rollback

During the initial pilot, stop ONLY `proto1-staging` and move its dedicated route
file into the app's backup directory outside the watched proxy directory. Do not
stop Coolify, Traefik or any unrelated container. Keep the gateway database,
versioned releases and secrets for recovery. Disable STAGING_ORIGIN locally and
restart the builder to remove the publishing capability.

For a site-only rollback, activate a previously uploaded version through the
authenticated `/internal/activate` endpoint with the current expectedActive.
Never overwrite historical release files. Upload verification failure does not
activate the candidate; an uncertain activation response must be reconciled by
retrying the same release, not by guessing that publication failed.

## Limits

Single process/SQLite, one upload at a time, maximum 100 files/32 MB decoded per
release, 48 MB JSON request limit, no anonymous sites, no auto-sharing or Meta.
Uploads interrupted before DB commit may leave an incoming/orphan directory;
these are not served and need deliberate maintenance, not automatic deletion.
Public launch still needs separate business authorization, policy/terms/privacy
review and a reviewed deployment model. This pilot is not an offline Google
content export and does not establish public-launch readiness.

References: https://doc.traefik.io/traefik/v3.6/reference/routing-configuration/http/tls/overview/
and https://developers.google.com/maps/documentation/places/web-service/policies
