# Production Deployment And Readiness

This document is the source of truth for preparing, deploying, verifying, and
operating Oddpath outside local development.

It separates three different states:

- **Local development:** data may be disposable and PostgreSQL may run in Docker.
- **Portfolio demo:** limited public traffic with explicit product gaps and
  conservative AI credits.
- **Production:** real user data requires durable storage, tested backups,
  production-safe migrations, monitoring, and a rollback plan.

Do not call a release production-ready while any item in **Production
Blockers** remains open.

## Current Release Status

The application architecture can be deployed as:

- `apps/web`: static Vite build.
- `apps/api`: long-running Node/Express service.
- PostgreSQL: managed durable database.
- Gemini: server-side provider integration.
- R2: the fail-closed private EU storage foundation and browser/API product
  integration are implemented; provider provisioning, scheduler monitoring,
  and staging validation remain launch workstreams.

The repository is not yet approved for real-user production traffic because
the operational data-safety gates below have not been completed.

Incident containment and data-subject request handling are defined in
`docs/INCIDENT_AND_DATA_REQUEST_RUNBOOK.md`. The operator-specific contacts,
competent state authority, and reviewed legal decisions must still be filled in
outside the public repository before registration is enabled.

The account-independent deployment foundation is implemented: the committed
Render Blueprint, Node version pin, CI workflow, fail-fast production
configuration, database readiness probe, API/browser security headers, and
graceful shutdown path are covered by automated checks. This does not replace
provider provisioning or the staging smoke gate.

The CI workflow includes a separate fail-closed production dependency audit.
Any high or critical advisory in the deployable dependency tree blocks Render's
checks-pass deployment until the dependency is upgraded or a reviewed,
documented reachability decision is made.

`deepmerge-ts` is pinned directly at `8.0.1` and overridden at the workspace
root because Prisma `7.9.1` still declares vulnerable `7.1.5` through its CLI
configuration package (GHSA-ggr8-5vv4-36mx). Prisma CLI is therefore a root
development tool, while `apps/api` keeps only the generated-client runtime
dependency. Do not remove the override until a stable Prisma release resolves
to `deepmerge-ts >= 8.0.0`; every change must keep `npm ls`, the production
audit, Prisma validation/generation, and the full build/test gates green.

## Production Blockers

- [x] Add a production-only migration command that runs
  `prisma migrate deploy`.
- [x] Document that `prisma migrate dev`, `prisma migrate reset`, and
  `prisma db push` must never run against production.
- [ ] Select and provision a managed PostgreSQL instance with durable storage.
- [ ] Enable automated backups and confirm the retention period.
- [ ] Enable point-in-time recovery when the selected database plan supports it.
- [ ] Complete and document one real restore drill before accepting user data.
- [ ] Keep local, staging, and production databases and credentials separate.
- [ ] Confirm that deleting or redeploying the API cannot delete the production
  database.
- [ ] Deploy a staging environment and run the full smoke checklist.
- [x] Add a fail-closed automated target smoke runner with a GET-only default
  and a separately confirmed authenticated project lifecycle check.
- [ ] Add host/proxy-level rate limiting for public API traffic.
- [ ] Configure and smoke-test a production SMTP provider for auth email,
  including sender domain DNS, SPF, DKIM, and DMARC.
- [x] Keep and harden the owned auth boundary for the initial private beta;
  revisit a maintained platform when OAuth, MFA/passkeys, or organizations
  enter scope.
- [x] Implement password account recovery end to end, including SMTP delivery,
  token validation, and the reset-password web route.
- [x] Decide that the first real-user release is an invite-only beta with
  verified accounts and guest AI disabled by default.
- [x] Implement the fail-closed registration gate, hashed invite-code check,
  public non-secret registration config, and versioned acceptance audit fields.
- [ ] Publish reviewed Oddpath-specific Terms/Privacy pages at
  `/oddpath/terms` and `/oddpath/privacy` with German counterparts under
  `/de/oddpath/*`, assign their reviewed `CURRENT_TERMS_VERSION`, and only then
  switch `REGISTRATION_MODE` from `disabled` to `invite`. The umbrella
  Eluthira legal drafts do not satisfy this product notice.
- [x] Implement password-confirmed relational account deletion, transactional
  object-deletion outbox enqueueing, usage-row deletion, session-cookie
  clearing, and local account-cache cleanup.
- [ ] Complete the privacy/data-retention policy and deploy/monitor the external
  object-deletion worker.
- [x] Implement private R2 asset lifecycle endpoints, atomic quota/validation
  claims, conservative content checks, and the overlap-safe deletion worker
  behind a disabled-by-default feature flag.
- [ ] Provision a private EU-jurisdiction R2 bucket/token, configure exact CORS,
  schedule and monitor `npm run assets:cleanup`, and run real-provider smoke
  tests without recording presigned URLs.
- [x] Reconcile stable chat messages, normalized attachment links, authorized
  provider reads, and stored-source Project Document imports in the API.
- [x] Implement and verify the signed-in browser chat/Project Document asset
  flows with opaque IDs, temporary previews/URLs, and legacy guest fallback.
- [x] Implement the provider-neutral bounded binary foundation: exact owner and
  READY checks, sequential bounded reads, immutable bounded writes, SHA-256 and
  MIME/content verification, safe archive paths, source bindings, and
  untrusted-package validation.
- [x] Wire bounded private files into Account/Project archive v2 while retaining
  v1 import compatibility; add exact owner-scoped relation completeness,
  staged assets/deletion jobs, and atomic canonical relation finalization.
- [x] Keep `PRIVATE_ASSETS_ENABLED=false` in production; startup rejects an
  attempted production enablement.
- [ ] Complete the activation proof: guarded real-PostgreSQL restore/cleanup
  and concurrency, real EU R2 interruption matrix, deployed process-kill/
  freeze recovery, production-scale timeout/latency behavior, and monitored
  scheduled multi-instance cleanup.
- [x] Change account/project ZIP export triggers to `POST + CSRF`; bound ZIP
  semantics and destination quotas; add pre-body rate/concurrency guards; and
  default `PORTABILITY_IMPORTS_ENABLED=false` in production.
- [x] Add a bounded, overlap-safe retention cleanup command for expired
  sessions/tokens, old usage/IP records, and old sessionless unverified
  accounts, including transactional private-object deletion jobs and expired
  auth-email payload cleanup.
- [x] Add count/status-only structured readiness/cleanup events and opt-in
  Render cron examples that cannot create paid services from the root Blueprint.
  Asset cleanup exits nonzero when object deletions fail so a scheduler can
  alert instead of treating a partial run as successful.
- [ ] Schedule and monitor `npm run cleanup:retention` with the final reviewed
  retention periods (`AUTH_TOKEN_RETENTION_DAYS`,
  `UNVERIFIED_ACCOUNT_RETENTION_DAYS`, and `USAGE_RECORD_RETENTION_DAYS`).

### Required Migration Script

Production-safe migration scripts are available:

```json
"db:migrate:deploy": "prisma migrate deploy"
```

The root script delegates to the API workspace. For staging or production, use:

```bash
npm run db:migrate:deploy
```

The local development command remains:

```bash
npm run db:migrate
```

`npm run db:migrate` runs `prisma migrate dev` and is local-development only.
Never run `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`
against staging or production.

Run migrations from a controlled release step against the production
`DATABASE_URL`, not automatically from every API replica at startup.

## Target Deployment Shape

The deployment decision is now fixed for the first beta:

- Web: Cloudflare Pages at `https://oddpath.eluthira.com`.
- API: Render Starter in Frankfurt at
  `https://api.oddpath.eluthira.com`.
- Database: Render PostgreSQL Basic-256mb in Frankfurt, starting with an
  explicit 1 GB disk and private-network access from the API.
- Binary storage: private Cloudflare R2 bucket created with EU jurisdiction.
- Email: Brevo SMTP with an authenticated `eluthira.com` sender.
- AI: paid Gemini service; production starts with AI disabled until the paid
  key, cost gate, and staging checks are complete.

The API hostname remains Cloudflare DNS-only for the initial privacy boundary;
prompts and documents go directly to Render. The committed `render.yaml` and
`docs/DEPLOYMENT_CLOUDFLARE_RENDER.md` are the provider-specific sources of
truth.

Avoid:

- A local Docker volume as the production database.
- Ephemeral container or application filesystems for user data.
- A static-only deployment for the whole application.
- A serverless API platform if long Gemini requests or Prisma connection
  management are unreliable there.
- Public Prisma Studio access.
- Sharing one database between local development, staging, and production.

## Data Safety

### Database Requirements

- Use a managed PostgreSQL service or an independently managed durable database.
- Store `DATABASE_URL` as a deployment secret.
- Require encrypted database connections when the provider supports or requires
  them.
- Restrict database network access to the API and trusted operational access.
- Confirm storage persists across API restarts, redeployments, scaling, and
  host replacement.
- Record the production database name, region, owner, provider, and retention
  policy in the private deployment configuration.

### Backup Policy

Before accepting real user data:

- Enable automatic daily backups at minimum.
- Prefer point-in-time recovery for production.
- Keep backups outside the API container lifecycle.
- Define retention appropriate to the release; 7-30 days is a practical MVP
  starting range.
- Take or confirm a fresh backup before a risky schema migration.
- Protect backup access with the same care as the live database.

### Restore Drill

A backup is not considered ready until restoration has been tested.

The restore drill must:

1. Restore a backup into a separate temporary database.
2. Run `prisma migrate status` against the restored database.
3. Start the API against the restored database.
4. Verify users, projects, chats, messages, documents, and memory records.
5. Run representative login, project, chat, and document smoke tests.
6. Record the restore date, duration, operator, and result.
7. Delete the temporary restored environment after verification.

Never test a restore by overwriting the active production database.

## Environment Configuration

### API Secrets And Core Configuration

Required:

```text
NODE_ENV=production
APP_ORIGIN=https://oddpath.eluthira.com
CORS_ORIGIN=https://oddpath.eluthira.com
TRUST_PROXY_HOPS=1
DATABASE_URL=postgresql://...
USAGE_IP_HASH_SALT=long_random_secret
CSRF_SECRET=long_random_secret
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
EMAIL_PROVIDER=smtp
EMAIL_FROM="Oddpath <no-reply@eluthira.com>"
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
EMAIL_OUTBOX_ENCRYPTION_SECRET=separate_random_secret_at_least_32_characters
SMTP_SECURE=false
EMAIL_OUTBOX_POLL_INTERVAL_MS=5000
EMAIL_OUTBOX_BATCH_SIZE=10
EMAIL_OUTBOX_MAX_ATTEMPTS=5
AUTH_EMAIL_RESPONSE_FLOOR_MS=350
REGISTRATION_MODE=disabled
CURRENT_TERMS_VERSION=
REGISTRATION_INVITE_CODE_HASHES=
LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=false
AI_ENABLED=false
GUEST_AI_ENABLED=false
GEMINI_API_KEY=...
GEMINI_PAID_SERVICE_CONFIRMED=true
```

`GEMINI_API_KEY` and `GEMINI_PAID_SERVICE_CONFIRMED` are required only when
`AI_ENABLED=true`; the Blueprint begins with AI disabled. `TRUST_PROXY_HOPS`
must remain exactly `1` while browsers connect directly to Render. The
password-reset and verification paths must be same-origin absolute paths, and
`APP_ORIGIN` must also appear in `CORS_ORIGIN`.

Do not use local defaults or committed placeholder secrets in production.

### Auth Email

Password reset and email verification require SMTP in production:

```text
EMAIL_PROVIDER=smtp
EMAIL_FROM="Oddpath <no-reply@eluthira.com>"
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=false
EMAIL_OUTBOX_ENCRYPTION_SECRET=separate_random_secret_at_least_32_characters
EMAIL_OUTBOX_POLL_INTERVAL_MS=5000
EMAIL_OUTBOX_BATCH_SIZE=10
EMAIL_OUTBOX_MAX_ATTEMPTS=5
AUTH_EMAIL_RESPONSE_FLOOR_MS=350
PASSWORD_RESET_PATH=/#/reset-password
EMAIL_VERIFICATION_PATH=/#/verify-email
```

Rules:

- Production startup fails if `EMAIL_PROVIDER` is missing or `noop`.
- Production startup fails if SMTP host, port, username, password, or sender is
  missing.
- Use a transactional email provider or trusted SMTP relay, not a personal
  mailbox for real users.
- Configure and verify the sender domain with the provider.
- Publish SPF, DKIM, and DMARC records before accepting real users.
- Smoke-test register, verify-email, forgot-password, and reset-password in the
  deployed HTTPS environment.
- Confirm the encrypted outbox drains after a restart and emits no recipient,
  token, URL, provider response, or raw error in logs. Do not rotate its
  encryption secret until there are no pending jobs.
- Prefer hash-route reset and verification paths so raw tokens stay out of
  hosting and proxy request logs. The web client removes each token from the
  visible URL/history entry immediately after consuming it.

### Cookies

Same-site web/API deployment:

```text
COOKIE_SAME_SITE=lax
COOKIE_SECURE=true
COOKIE_DOMAIN=
```

Cross-site HTTPS web/API deployment:

```text
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
COOKIE_DOMAIN=
```

Rules:

- `CORS_ORIGIN` must list exact trusted origins. Do not use `*` with cookies.
- Keep `COOKIE_SECURE=true` in production.
- Set `COOKIE_DOMAIN` only when intentionally sharing cookies across
  subdomains of the same parent domain.
- Verify login, logout, session refresh, and guest cookies in the deployed
  browser environment.

### AI And Retrieval

Recommended controlled defaults:

```text
AI_PROVIDER=gemini
AI_WORKFLOW_ROUTER_ENABLED=true
AI_WORKFLOW_ROUTER_MODEL=gemini-3.1-flash-lite
AI_MODEL_ROUTER_ENABLED=true
AI_GENERAL_MODEL=gemini-3.1-flash-lite
AI_VISUAL_MODEL=gemini-2.5-flash
AI_FALLBACK_MODEL=gemini-2.5-flash-lite
AI_SUMMARY_MODEL=gemini-3.1-flash-lite
AI_SUMMARY_TIMEOUT_MS=15000
AI_TIMEOUT_MS=55000
AI_MAX_OUTPUT_TOKENS=2048

PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false
EMBEDDING_PROVIDER=gemini
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=768
EMBEDDING_TIMEOUT_MS=15000
```

Keep `PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false` for the first shared
deployment unless the release intentionally accepts the evaluated quota,
latency, and cost behavior in `docs/RAG_RETRIEVAL_EVALS.md`.

### Usage Protection

Conservative demo defaults:

```text
GUEST_DAILY_CREDITS=20
USER_DAILY_CREDITS=100
USAGE_TOKENS_PER_CREDIT=1000
USAGE_IMAGE_CREDITS=4
USAGE_TEXT_FILE_CREDITS=1
USAGE_ROUTER_CREDITS=1
USAGE_WINDOW_HOURS=24
AI_GLOBAL_USAGE_WINDOW_MS=3600000
AI_GLOBAL_REQUEST_LIMIT=100
AI_GLOBAL_CREDIT_LIMIT=500
AI_GLOBAL_DAILY_REQUEST_LIMIT=500
AI_GLOBAL_DAILY_CREDIT_LIMIT=2500
AI_GLOBAL_MONTHLY_REQUEST_LIMIT=5000
AI_GLOBAL_MONTHLY_CREDIT_LIMIT=25000
MAX_MESSAGE_CHARS=3000
MAX_HISTORY_MESSAGES=10
REQUEST_BODY_LIMIT=25mb
```

Review provider quota and billing before increasing limits. Application
credits protect Gemini usage, but they do not replace host/proxy rate limiting.
They are deliberately approximate and are not a euro-denominated hard cap;
configure provider billing alerts and an external budget as well.
Review request and message limits against the selected host's proxy limits
before enabling larger uploads.

### Private Object Storage Activation Gate

The private R2 lifecycle and deletion-outbox foundation is intentionally
fail-closed. Do not enable it merely because the bucket credentials exist.
The application-side prerequisites now implemented are:

- signed-in browser upload integration using the initiate/PUT/complete flow;
- server-side chat and project-document linking that verifies owner, purpose,
  project, and `READY` status inside the write transaction;
- stable chat-message reconciliation so ordinary autosave never drops links or
  schedules still-referenced objects for deletion;
- bounded Account/Project archive v2 entries with v1 import compatibility;
- zero-write package validation plus quota-locked staged restore; and
- exact unreferenced cleanup claims, delayed quarantine for ambiguous failure,
  and atomic `READY`/relation finalization in the canonical import transaction;
- persisted restore session/attempt/token fencing before and after every write
  and inside finalization, with automated freeze and lease-boundary coverage;
- exact lease-token CAS for cleanup renewal/failure/completion, scheduler-
  visible conflicts, and a guarded real-PostgreSQL concurrency case; and
- a fail-closed, sanitized EU R2 mutation runner covering conditional upload,
  CORS, integrity, bounded reads, authorization, and exact retrying cleanup.

Production configuration still refuses `PRIVATE_ASSETS_ENABLED=true`.
Complete and record all of these activation checks before changing that guard:

- run the existing real-PostgreSQL binary finalization/rollback tests; they
  have not been run locally in the current environment;
- run a real EU-jurisdiction R2 CORS/presigning/replay/expiry/interruption
  matrix, including conditional PUT, checksum/content length, bounded/range
  reads, authorization, delete, and cleanup retry;
- prove process-kill/freeze recovery against real PostgreSQL and R2 at every
  staging/write/finalize boundary;
- exercise the locally covered maximum package size against production
  transaction timeouts, serialization retries, storage latency, and API
  memory limits; and
- schedule and monitor `npm run assets:cleanup`, prove reconciliation after
  failures, and validate coordination with multiple API instances.

The current archive path is bounded to 64 assets, 4 MiB each and 8 MiB total;
it is not an arbitrary-size streaming contract. Staging may exercise R2, but
this production guard is not a waiver and must remain closed until the matrix
above passes.

### Web Configuration

Build the frontend with:

```text
VITE_API_BASE_URL=https://your-api-origin.example
# Optional only after direct private-asset transfers are enabled:
VITE_R2_ENDPOINT=https://<32-character-account-id>.eu.r2.cloudflarestorage.com
```

The values are embedded at build time. The Vite build generates
`apps/web/dist/_headers` with those exact origins and fails when the API origin,
or a configured R2 origin, is unsafe. Never use a wildcard. Rebuild the web app
when either value changes, and use separate exact values for staging and
production.

## Release Preparation

### Code And Documentation Gate

- [ ] Working tree contains only intended release changes.
- [ ] No `.env`, secrets, database dumps, `.vscode/changelists.json`, generated
  output, or unrelated local files are included.
- [ ] All intended migrations are committed exactly once.
- [ ] `schema.prisma` matches the migration history.
- [ ] `AI_HANDOFF.md`, `ARCHITECTURE.md`, `NEXT_STEPS.md`, and this guide match
  implemented behavior.
- [ ] Known product gaps are explicitly accepted for the selected release type.

### Verification Gate

Load the reviewed `VITE_API_BASE_URL` (and optional exact EU
`VITE_R2_ENDPOINT`) into the build environment before running this gate.

Run:

```bash
npm ci
npm run verify
npm run build:api
npm run build:web
git diff --check
```

Also confirm:

- API and web TypeScript checks pass.
- API and web tests pass.
- Production builds complete without warnings that hide real failures.
- No pending or duplicated Prisma migration exists.
- The release commit and version are recorded.

## Deployment Procedure

Follow the provider-specific account, DNS, and secret sequence in
`docs/DEPLOYMENT_CLOUDFLARE_RENDER.md` in addition to the provider-neutral
procedure below.

### 1. Provision Infrastructure

1. Provision managed PostgreSQL.
2. Enable backups and point-in-time recovery when available.
3. Create separate staging and production databases.
4. Configure API and web deployment targets.
5. Configure HTTPS domains.
6. Store all secrets in the host secret manager.

### 2. Validate The Target Database

1. Confirm `DATABASE_URL` targets the intended environment.
2. Confirm the database is reachable from the release runner/API host.
3. Check migration status.
4. Confirm a current backup exists.
5. Run `npm run db:migrate:deploy` once.
6. Check migration status again.

Never use reset, development migration, or schema-push commands to repair a
production deployment.

### 3. Deploy The API

1. Build `apps/api`.
2. Start `apps/api/dist/server.js` with `NODE_ENV=production`.
3. Confirm the process remains healthy after startup.
4. Check `GET /api/health`.
5. Inspect logs for database, migration, CORS, cookie, or provider errors.

### 4. Deploy The Web App

1. Set the production `VITE_API_BASE_URL`.
2. Build `apps/web`.
3. Deploy `apps/web/dist`.
4. Open the public URL in a clean browser session.
5. Verify frontend requests target the production API.

### 5. Run Post-Deploy Smoke Tests

Run the compiled automated baseline before the manual checklist:

```text
npm run build:api
npm run smoke:read-only
```

The operator supplies configuration through environment variables. Use
`ops/smoke.env.example` as a reference, but keep real values in a local ignored
file or CI/host secret manager:

| Variable | Required | Purpose |
| --- | --- | --- |
| `ODDPATH_SMOKE_BASE_URL` | yes | Exact API origin, for example `https://api-staging.example.com`; credentials, paths, queries, and fragments are rejected. |
| `ODDPATH_SMOKE_WEB_ORIGIN` | recommended for read-only; required for authenticated mutation | Exact deployed web origin. When present, the runner proves that origin is allowed and an unrelated origin is rejected; mutation requests always send this browser origin. |
| `ODDPATH_SMOKE_TIMEOUT_MS` | no | Per-request bound from 500 through 30000 milliseconds; default 10000. |
| `ODDPATH_SMOKE_CSRF_HEADER_NAME` | no | Defaults to `X-CSRF-Token`; set it only when the API's `CSRF_HEADER_NAME` was customized. |

`smoke:read-only` sends only `GET` requests. It verifies API liveness and
payload identity, database readiness, API security headers (including HSTS on
HTTPS), registration/legal configuration, the unauthenticated session
boundary, CSRF cookie issuance, and optional exact-origin CORS behavior. It
needs no account credentials and is the safe default for repeated availability
checks.

After that passes on isolated staging, an operator may deliberately run the
authenticated write baseline with a dedicated verified test account that has
no valuable data:

```text
npm run smoke:authenticated-mutation
```

That command additionally requires the exact web origin plus all three
secret-manager values below:

```text
ODDPATH_SMOKE_EMAIL=dedicated-verified-test-account@example.com
ODDPATH_SMOKE_PASSWORD=stored-only-in-the-secret-manager
ODDPATH_SMOKE_MUTATION_CONFIRMATION=CREATE_AND_DELETE_ODDPATH_SMOKE_PROJECT
```

The exact confirmation is an execution interlock, not a general approval for
destructive testing. The runner logs in, verifies the current session, creates
one uniquely named temporary project, updates and lists it, deletes that exact
returned project id, confirms its absence, and logs out. If a later check fails
after creation, it attempts that same id's cleanup before exiting. It never
registers or deletes an account, touches a pre-existing project, or invokes AI.
If `temporary_project_cleanup` fails, stop and remove the project with the
`Oddpath deployment smoke` prefix through the product after investigating the
target; do not treat that run as passed.

Both commands refuse non-HTTPS remote targets, credentials embedded in URLs,
redirects, oversized JSON responses, and unbounded waits. Their success output
contains only fixed check names and durations. Failure output contains only a
fixed check name and reason; URLs, email, password, cookies, CSRF/session
tokens, response bodies, raw errors, and stack traces are deliberately omitted.
The commands return a non-zero exit code on the first failed gate. Do not expose
authenticated smoke secrets to pull-request jobs or untrusted logs.

The `*:dev` variants execute TypeScript directly for local runner development.
A release gate must use the unsuffixed commands above after `build:api`, so the
exact compiled candidate is tested.

The automated baseline does not replace the browser/provider/isolation checks
below. Email delivery, two-user authorization, AI behavior, R2 presigning,
mobile layout, and backup restoration still require their dedicated staging
tests.

- [ ] Health endpoint returns success.
- [ ] Registration creates a user.
- [ ] Closed mode rejects registration; invite mode rejects wrong codes and
  records the current `acceptedTermsVersion` and `acceptedTermsAt` for a valid
  registration.
- [ ] Login succeeds and survives refresh.
- [ ] Logout clears the session.
- [ ] Account deletion rejects a wrong current password, accepts the correct
  password, clears the session, and removes the user's database graph.
- [ ] Guest chat works within its configured credit limit.
- [ ] Signed-in chat is saved and reopens after refresh.
- [ ] Project create/edit/delete works.
- [ ] Project chat assignment and project access work.
- [ ] Project Instructions load and save.
- [ ] Project Documents upload, preview, download, and retrieval work.
- [ ] Project Memory load, edit, save, and clear work through explicit user
  actions.
- [ ] Conversation Summary failure does not block the main chat response.
- [ ] Usage page shows only the current identity.
- [ ] Unsupported uploads and oversized requests return safe errors.
- [ ] A second test user cannot access the first user's chats, projects,
  documents, or memory.
- [ ] Light/dark themes and mobile layout remain usable.

After smoke testing, remove test accounts and data when appropriate.

## Monitoring And Operations

At minimum, monitor:

- API availability and response errors.
- Database connectivity and storage capacity.
- Migration failures.
- Authentication failures and unusual request volume.
- Gemini quota, timeout, and provider errors.
- `429`, `5xx`, and database error rates.
- Backup success and restore readiness.

Do not log:

- Passwords or password hashes.
- Session cookies or tokens.
- Gemini API keys or database credentials.
- Full private user documents unless explicitly required for a secured support
  workflow.

The current API uses normal process logging and does not yet provide a complete
production observability stack. Select host logging, retention, and alerting
before real-user launch.

## Rollback Plan

Before deployment, record:

- Previous known-good application release.
- Database backup or point-in-time recovery position.
- Migration list included in the new release.
- Person responsible for the rollback decision.

If the application release fails:

1. Stop or route traffic away from the failing release.
2. Roll the API/web application back to the previous compatible build.
3. Do not run `prisma migrate reset`.
4. Prefer a forward-fix migration for schema issues.
5. Restore the database only when data/schema damage requires it and the
  recovery impact is understood.
6. Re-run health and smoke checks.
7. Record the incident and corrective action.

Migrations should follow expand-and-contract compatibility when possible so an
application rollback does not require an immediate destructive database
rollback.

## Error UX Contract

Important API error codes:

- `VALIDATION_ERROR`
- `PAYLOAD_TOO_LARGE`
- `DATABASE_UNAVAILABLE`
- `DATABASE_SCHEMA_OUT_OF_DATE`
- `USAGE_LIMIT_REACHED`
- `RATE_LIMITED`
- `QUOTA_EXCEEDED`
- `MODEL_UNAVAILABLE`
- `UNSUPPORTED_MODEL`
- `SESSION_REQUIRED`

Do not expose raw provider stack traces, database credentials, or Prisma
internals to users.

## Release Decision

### Acceptable Portfolio Demo

A portfolio demo may launch with:

- Google OAuth disabled.
- Generic forgot-password response without email delivery.
- Conservative guest/user credits.
- Embeddings disabled.
- Clearly disposable demo accounts and data.

It still requires durable database storage, HTTPS, secrets, safe migrations,
and backups if visitors can create accounts or content.

### Real-User Production

Before inviting users to rely on stored data, also resolve or explicitly design:

- Privacy policy and data-retention rules.
- Account and user-data deletion.
- Support and incident response ownership.
- Monitoring and alerting.
- Backup retention and tested recovery objectives.
- Provider budget and abuse controls.

## External Provider Checks

Provider plans and limits change. Before deployment, verify current:

- Database backup/PITR support.
- Region and data-residency options.
- API process sleep and timeout limits.
- Persistent storage guarantees.
- Build/release command support.
- Secret management.
- Logging and alerting.
- Pricing and quota limits.

The selected providers are Cloudflare Pages/R2, Render, Brevo, and paid Gemini.
Re-verify their current limits, contracts, regions, and prices at provisioning
time; this document does not freeze external provider behavior.
