# Oddpath Cloudflare + Render Deployment Runbook

This runbook covers the selected small-beta deployment. It is intentionally
specific to Oddpath and complements `PRODUCTION_READINESS.md`.

## Resource Map

| Resource | Provider | Region / jurisdiction | Public name |
| --- | --- | --- | --- |
| Vue static build | Cloudflare Pages | global static delivery | `oddpath.eluthira.com` |
| Node/Express API | Render Starter | Frankfurt | `api.oddpath.eluthira.com` |
| PostgreSQL | Render Basic-256mb, 1 GB | Frankfurt | private network only |
| Binary objects | Cloudflare R2 | EU jurisdiction | private bucket, no public name |
| Auth email | Brevo SMTP | provider-managed EU data flow | `no-reply@eluthira.com` |
| AI | paid Gemini project | provider contract/data-flow decision | server-side only |

`eluthira.com/oddpath` is a page on the future Eluthira site. This repository
serves the product subdomain, not that parent-site path.

## Before Connecting Any Account

- Enable 2FA for Porkbun, Cloudflare, Render, Brevo, GitHub, and Google.
- Store recovery codes outside the repository.
- Never paste passwords, API keys, SMTP credentials, database URLs, or R2
  presigned URLs into issues, commits, or chat.
- Keep development, staging, and production databases and keys separate.
- Save a dated copy of each accepted DPA/AVV and subprocessor list.

## 1. Domain And Cloudflare DNS

1. Buy `eluthira.com` at Porkbun and enable renewal and WHOIS privacy.
2. Add `eluthira.com` to Cloudflare.
3. Replace the Porkbun nameservers with the two nameservers Cloudflare assigns.
4. Wait until Cloudflare shows the zone as active before adding application
   records.
5. Do not create a separate registration for each project. Subdomains such as
   `oddpath.eluthira.com` and future project names use the same domain.

Porkbun remains the registrar. Cloudflare becomes authoritative DNS.

## 2. Cloudflare Pages

Create a Pages project from the Git repository with these settings:

```text
Root directory: /
Build command: npm ci --include=dev && npm run build:web
Build output directory: apps/web/dist
Production environment variable:
  VITE_API_BASE_URL=https://api.oddpath.eluthira.com
Optional after direct private-asset transfers are activated:
  VITE_R2_ENDPOINT=https://<32-character-account-id>.eu.r2.cloudflarestorage.com
```

The root lockfile and `.node-version` are required, so do not set the Pages root
to `apps/web`. The repository currently pins Node `24.19.0`, the latest Node 24
LTS release selected for this launch; move that exact pin forward promptly when
Node publishes another 24.x security release.

Add `oddpath.eluthira.com` as the production custom domain. Every Vite build
generates `apps/web/dist/_headers` from its own exact `VITE_API_BASE_URL` and
optional exact EU-jurisdiction `VITE_R2_ENDPOINT`. Missing or unsafe values fail
the build; the generated enforced CSP never uses an origin wildcard. Private
assets remain disabled, so omit `VITE_R2_ENDPOINT` initially. Before enabling
direct R2 upload/download, set that variable in the matching staging and
production Pages environments and verify both builds without CSP violations.
Do not hand-edit generated output.

Do not connect Pages preview deployments to the production API or database.
Disable preview deployments initially. If previews are enabled later, give the
preview environment its own `VITE_API_BASE_URL`, staging API, database, secrets,
and exact CORS origin. Give it its own exact `VITE_R2_ENDPOINT` only when that
isolated environment tests direct R2 transfers. Leaving the API variable unset
makes the deployment build fail closed instead of silently using same-origin or
production API traffic.

The production branch should be `main`. Protect it so the required `CI / verify`
check passes before merge. CI also runs a separate fail-closed production
dependency audit; any high or critical advisory prevents the check and Render
deployment from succeeding. Both Render's `autoDeployTrigger: checksPass` and
the Cloudflare production deployment must point at that same reviewed commit.

## 3. Render Blueprint

The root `render.yaml` creates:

- `oddpath-api`: one paid Starter Node web service in Frankfurt, explicitly
  locked to `branch: main` and `numInstances: 1`.
- `oddpath-db`: Basic-256mb PostgreSQL 16 in Frankfurt with 1 GB storage,
  storage autoscaling disabled, and no public database IP allowlist.

The Blueprint intentionally leaves Render's `onrender.com` subdomain enabled
for initial TLS and staging diagnosis. Disable it only after the custom domain
is verified and the smoke gate passes.

Connect the repository as a Render Blueprint and review the estimated charge
before applying it. Render will prompt for every `sync: false` value on initial
creation:

- `CURRENT_TERMS_VERSION` (leave empty for the initial closed-registration
  deploy; later use the identifier of the reviewed, archived legal text)
- `REGISTRATION_INVITE_CODE_HASHES` (leave empty for the initial
  closed-registration deploy; later use only comma-separated 64-character
  SHA-256 hex digests, never raw invite codes)
- `SMTP_USER`
- `SMTP_PASS`
- `GEMINI_API_KEY`
- `GEMINI_PAID_SERVICE_CONFIRMED` (enter `true` only after confirming the key's
  project has active paid billing)

`EMAIL_OUTBOX_ENCRYPTION_SECRET` is generated once by the Blueprint rather
than entered manually. Do not rotate it while encrypted jobs are pending.

The committed Blueprint deliberately sets:

```text
AI_ENABLED=false
GUEST_AI_ENABLED=false
PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false
```

This makes the first deploy fail closed for AI traffic. Change `AI_ENABLED` to
`true` in the Blueprint only after paid Gemini, cost controls, and staging smoke
tests are complete. Keep guest AI disabled for the invite-only beta.

Render commands are:

```text
Build: npm ci --include=dev && npm run build:api
Pre-deploy: npm run db:migrate:deploy
Start: npm --prefix apps/api run start
Health: /api/health/ready
Graceful shutdown window: 70 seconds
```

Liveness never depends on PostgreSQL. Readiness uses a dedicated one-connection
pool with 1.5-second connection, client-query, and PostgreSQL statement
timeouts, a one-second result cache, and one shared in-flight probe. Concurrent
requests coalesce; after the HTTP deadline, later requests fail fast until the
raw driver probe settles instead of queueing behind the pool. Every actual
probe emits one count/status-only `readiness_probe` JSON event. Graceful
shutdown closes both that pool and Prisma after the HTTP server stops accepting
new requests.

The pre-deploy command is the only production migration path. Never use
`prisma migrate dev`, `prisma migrate reset`, or `prisma db push` on staging or
production.

The API binds to Render's `PORT` on `0.0.0.0`. Production startup fails unless
`APP_ORIGIN` is an exact HTTPS origin also present in `CORS_ORIGIN`, the
database URL is a non-local PostgreSQL URL, cookies are secure, the two email
link paths remain same-origin paths, and `TRUST_PROXY_HOPS=1` matches this
direct-to-Render topology. Do not increase the proxy hop count without a new
topology and spoofing review.

The database explicitly uses 1 GB because omitting `diskSizeGB` gives new Basic
instances a larger default allocation. Create alerts around 70-80% usage and
increase the disk deliberately before it is full. Do not enable autoscaling
without a new budget decision.

## 4. API Custom Domain

1. Let the initial Render service deploy on its `onrender.com` hostname.
2. Confirm both `/api/health` and `/api/health/ready` succeed.
3. In Render, confirm the custom domain is
   `api.oddpath.eluthira.com` and copy the exact DNS target Render provides.
4. In Cloudflare DNS, create the requested `api` CNAME as **DNS only** (grey
   cloud), not proxied.
5. Wait for Render domain verification and TLS certificate issuance.
6. Verify the production frontend sends credentialed requests only to
   `https://api.oddpath.eluthira.com`.

Keeping the API DNS-only prevents prompts, chats, and documents from being
silently routed through Cloudflare's HTTP proxy. Revisit this only with an
explicit privacy, WAF, and trusted-proxy decision.

After the custom domain is stable, the Render default subdomain can be disabled
in a later Blueprint change. Do not disable it during initial certificate and
staging diagnosis.

## 5. Brevo Email

1. Add and authenticate `eluthira.com` in Brevo.
2. Add the exact SPF and DKIM records Brevo supplies to Cloudflare DNS.
3. Add a DMARC policy and monitoring address appropriate for the beta.
4. Confirm the configured sender `Oddpath <no-reply@eluthira.com>` is accepted.
5. Run the complete flow in staging:
   registration -> verification email -> verify -> login -> forgot password ->
   reset email -> choose a new password -> login with the new password.

SMTP startup validation proves only that settings are present. The staging flow
is required to prove credentials, DNS, deliverability, and links actually work.
Port 587 is configured with mandatory STARTTLS, not opportunistic plaintext
fallback. The application also bounds SMTP connection and greeting waits at 10
seconds and socket activity at 30 seconds so auth requests cannot hang forever.

## 6. Cloudflare R2 (Staging-Integrated; Production Activation Blocked)

The private lifecycle plus signed-in chat and Project Document integration are
available behind `PRIVATE_ASSETS_ENABLED=false`. Provision it first in staging
and keep the flag off in production. Production startup currently rejects
`PRIVATE_ASSETS_ENABLED=true`. Account and Project archive v2 formats now
include eligible stored files through bounded manifests and remain compatible
with v1 packages. Import uses quota-locked staging rows and durable deletion
jobs, immutable object writes, and atomic canonical relation finalization.

That application implementation does not open the production gate. Before
changing it, run the guarded real-PostgreSQL finalization/rollback suite and a
real EU R2 interruption matrix covering conditional PUT, checksum/content
length, bounded/range reads, authorization, delete, and cleanup retry. Persisted
restore fencing, local freeze/lease tests, maximum-boundary coverage, and exact
cleanup lease CAS are implemented; still prove process-kill/freeze with real
services, validate production-scale transaction timeout/retry behavior, and
operate monitored cleanup across the intended instance count. See
`docs/BINARY_ASSET_PORTABILITY.md` and the opt-in operational runner in
`docs/R2_SMOKE_RUNBOOK.md`.

- Choose **EU jurisdiction** at bucket creation. A location hint alone is not
  the same guarantee and jurisdiction cannot be changed later.
- Keep the bucket private and disable public `r2.dev` access.
- Create a token scoped only to the Oddpath bucket.
- Use the exact S3 endpoint
  `https://<32-hex-account-id>.eu.r2.cloudflarestorage.com`; the API refuses a
  global/non-EU endpoint or partial credentials even while disabled.
- Configure browser CORS for the exact staging/product origins, methods
  `PUT`, `GET`, and `HEAD`, request headers `Content-Type`,
  `If-None-Match`, and `x-amz-checksum-sha256`, and exposed header `ETag`.
  Browsers set signed `Content-Length` themselves; frontend code must upload the
  exact `File`/`Blob` and must not try to override that forbidden header.
- Do not add a blanket age-expiration rule to the current
  `chat-attachments/` or `project-documents/` prefixes: a key stays in that
  prefix after it becomes READY, so such a rule could delete live user data.
  The database-backed cleanup/outbox worker is primary. A provider lifecycle
  rule is safe only after a separate disposable staging prefix/lifecycle is
  designed and tested.

Set the `R2_*`, `ASSET_*`, and `PRIVATE_ASSETS_ENABLED` variables from
`apps/api/.env.example` in Render; never commit credentials to `render.yaml`.
Every cleanup cron build must run `npm ci --include=dev && npm run build:api`.
Its start command must use the API package's unsuffixed production script, which
executes `node dist/scripts/*.js`. The explicit `*:dev` scripts use `tsx` and
are only for local source execution; never use them in Render.

Schedule `npm --prefix apps/api run assets:cleanup` at least every five minutes.
Overlap is safe: a claim-phase overlap exits without waiting, while invocations
that begin after that short phase may split the backlog through database leases.
Every delete renews and then fences failure/completion by its exact lease token,
so a stale instance cannot overwrite or complete a newer claim. Alert on
`asset_cleanup.status=failed`, `failed>0`, `leaseConflicts>0`, a persistent
`cleanupCandidatesMayRemain=true`, or growing `deletionBacklog`/
`dueDeletionBacklog` values.
Presigned URLs and object keys must never enter logs or monitoring query fields.

Keep `PORTABILITY_IMPORTS_ENABLED=false` for the first production beta. ZIP
exports remain available through authenticated `POST + CSRF`; imports return a
fail-closed 503 until the flag is deliberately enabled after staging tests of
the 10 MB compressed/20 MB expanded limits, shared data quotas, advisory locks,
and rate/concurrency behavior.

Schedule `npm --prefix apps/api run cleanup:retention` at least daily with the
reviewed retention windows and `RETENTION_CLEANUP_BATCH_SIZE=100`. It uses a
non-blocking try-lock and drains at most 20 bounded, repeat-safe transactions
per invocation. It stops on no progress rather than spinning and aggregates
all batch counts in one event. Any remaining `mayHaveMore=true` backlog exits
nonzero; alert on `retention_cleanup.status=failed`. Expired
pending/processing auth-email jobs are cancelled with their encrypted payload
removed; old terminal jobs are purged with the other auth records.

The root Blueprint deliberately creates no cron services, because each cron
service can add a separate charge. After verifying current Render support and
reviewing the estimate, merge only the desired entries from
`ops/render-cron-services.example.yaml` into the root Blueprint. The example is
not independently deployable and contains no secret values; every
`sync: false` value must come from the corresponding API environment.

## 7. Reproducible Temporary Staging Environment

Staging is deliberately not part of `render.yaml`: applying that production
Blueprint must not silently double the monthly bill. Provision the following
temporary isolated resources before the first real-user launch and before any
high-risk migration. Review the provider cost before creating them.

1. Turn off automatic production-branch deployments in Cloudflare Pages and
   temporarily set the Render production service's Auto-Deploy to **Off**. This
   prevents the candidate commit from reaching production before the gate.
2. Create a separate Cloudflare Pages project named `oddpath-staging` with the
   same root, build command, output directory, and Node pin as production.
3. Clone the Render service/database settings under the names
   `oddpath-api-staging` and `oddpath-db-staging`: Frankfurt, the same runtime
   and PostgreSQL major, exactly one API instance, no public database access,
   and Auto-Deploy **Off**. Do not attach a production custom domain.
4. Give staging its own database, CSRF/IP salts, SMTP credentials or approved
   SMTP test account, and future R2 bucket/token. Never copy production data or
   secrets. Keep AI and guest AI disabled unless that exact integration is the
   subject of the test.
5. Set staging `APP_ORIGIN` and `CORS_ORIGIN` to the exact staging Pages HTTPS
   origin. Set its frontend `VITE_API_BASE_URL` to the exact staging Render
   HTTPS origin. Keep `TRUST_PROXY_HOPS=1`.
6. Deploy the same reviewed Git commit SHA to both staging resources. Render's
   **Deploy a specific commit** action disables that service's auto-deploy;
   record the SHA with the smoke-test result.
7. Run the gate below. Only after it passes, re-enable production deployment
   controls and deploy that exact SHA. Delete the temporary staging database
   and API after the validation window if the budget does not support keeping
   them, following the provider's safe deletion confirmation.

This is an operator-owned gate. Repository checks cannot prove account-level
isolation, TLS issuance, email delivery, backups, or live proxy behavior.

## 8. Staging Smoke Gate

Start with the repository-owned, fail-closed automation against the exact
compiled release candidate. Configure the variables documented in
`ops/smoke.env.example` through the operator shell or a protected deployment
job; never commit or print the dedicated test-account password.

```text
npm run build:api
npm run smoke:read-only
```

Set both the exact staging Render API origin in `ODDPATH_SMOKE_BASE_URL` and the
exact staging Pages origin in `ODDPATH_SMOKE_WEB_ORIGIN`. The read-only command
uses GET only and checks liveness, database readiness, hardened response
headers, registration configuration, unauthenticated access, CSRF issuance,
and CORS allow/reject behavior.

Only after that succeeds, use a dedicated verified empty staging account and
set `ODDPATH_SMOKE_EMAIL`, `ODDPATH_SMOKE_PASSWORD`, plus the exact interlock:

```text
ODDPATH_SMOKE_MUTATION_CONFIRMATION=CREATE_AND_DELETE_ODDPATH_SMOKE_PROJECT
npm run smoke:authenticated-mutation
```

This second command exercises login and a temporary create/update/list/delete
project lifecycle, attempts cleanup after a partial failure, and logs out. A
non-zero result or `temporary_project_cleanup` failure blocks promotion. The
runner never prints the target, credentials, cookies, tokens, response bodies,
or raw errors. Keep these commands out of untrusted pull-request jobs. Full
command behavior and variable constraints are specified in
`docs/PRODUCTION_READINESS.md`.

Then run the checks below in a clean browser; automation does not prove email,
provider, browser layout, proxy-IP, or cross-account behavior.

Run these checks in a clean browser before production DNS or invitations:

- CI is green on the exact release commit.
- Liveness succeeds with the database both up and down; readiness returns 503
  when the database is down.
- Registration, email verification, login, refresh, logout, forgot-password,
  and reset-password all work.
- Cookies are host-only, HttpOnly where appropriate, Secure, and SameSite=Lax.
- CORS allows exactly the staging frontend and rejects other origins.
- CSRF rejects a state-changing request without the signed cookie/header pair.
- `req.ip` matches the real client through Render and cannot be replaced by a
  browser-supplied `X-Forwarded-For` value.
- Guest AI is disabled; verified invite accounts respect conservative limits.
- A second user cannot access the first user's chats, projects, memory,
  documents, exports, or stored assets.
- A running AI request receives the intended shutdown window during redeploy.
- Logs contain no prompt, document content, credential, token, raw provider
  error, or presigned URL.

## 9. Backup And Restore Gate

Before accepting real user data:

1. Confirm the selected Render plan's actual backup/PITR behavior and retention
   in the dashboard.
2. Restore into a separate temporary database, never over production.
3. Apply/check migrations and start a temporary API against the restored copy.
4. Verify representative users, chats, projects, documents, memories, and
   sessions according to the restore checklist.
5. Record date, duration, operator, outcome, and corrective actions.
6. Remove the temporary restore after verification.

## Contract And Setup Links

- Cloudflare terms and DPA:
  <https://www.cloudflare.com/terms/> and
  <https://www.cloudflare.com/cloudflare-customer-dpa/>
- Render terms and DPA:
  <https://render.com/terms> and <https://render.com/dpa>
- Google Cloud data-processing addendum:
  <https://cloud.google.com/terms/data-processing-addendum>
- Gemini API terms:
  <https://ai.google.dev/gemini-api/terms>
- Brevo terms/DPA:
  <https://www.brevo.com/legal/termsofuse/>

Archive the accepted version and date; links can change after acceptance.

## Provider Documentation

- Render Blueprint reference: <https://render.com/docs/blueprint-spec>
- Render monorepos: <https://render.com/docs/monorepo-support>
- Render health checks: <https://render.com/docs/health-checks>
- Render Cloudflare DNS configuration:
  <https://render.com/docs/configure-cloudflare-dns>
- Cloudflare Pages monorepos:
  <https://developers.cloudflare.com/pages/configuration/monorepos/>
- Cloudflare Pages headers:
  <https://developers.cloudflare.com/pages/configuration/headers/>
- R2 pricing: <https://developers.cloudflare.com/r2/pricing/>
- R2 data location:
  <https://developers.cloudflare.com/r2/reference/data-location/>
- R2 presigned URLs:
  <https://developers.cloudflare.com/r2/api/s3/presigned-urls/>
- R2 S3 compatibility:
  <https://developers.cloudflare.com/r2/api/s3/api/>
