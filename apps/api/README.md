# Oddpath API

This is the TypeScript API for Oddpath. The legacy backend source has been removed after parity migration.

## Commands

```bash
npm --prefix apps/api run dev
npm --prefix apps/api run check
npm --prefix apps/api run build
npm --prefix apps/api run db:validate
npm --prefix apps/api run db:generate
npm --prefix apps/api run db:migrate
npm --prefix apps/api run db:migrate:deploy
npm --prefix apps/api run db:drift:check
npm --prefix apps/api run db:studio
npm --prefix apps/api run test:integration:db
npm --prefix apps/api run assets:cleanup
npm --prefix apps/api run cleanup:retention
npm --prefix apps/api run assets:cleanup:dev
npm --prefix apps/api run cleanup:retention:dev
```

From the repository root, these shortcuts are also available:

```bash
npm run dev:api
npm run dev:web
npm run check:api
npm run check:web
npm run build:api
npm run build:web
npm run db:up
npm run db:down
npm run db:migrate
npm run db:migrate:deploy
npm run db:drift:check
npm run test:integration:db
npm run db:studio
npm run assets:cleanup
npm run cleanup:retention
npm run assets:cleanup:dev
npm run cleanup:retention:dev
```

The unsuffixed cleanup commands are production entrypoints. Run the API build
first; they execute `node dist/scripts/*.js` and do not require `tsx` at
runtime. The explicit `*:dev` variants execute the TypeScript sources with
`tsx` for local development only. Never configure a production scheduler to
use a `*:dev` command.

## Environment

Create `apps/api/.env` from `apps/api/.env.example`.

Required later for real database work:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public
```

Start the local database from the repository root:

```bash
npm run db:up
npm run db:migrate
```

Required for live AI requests:

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key_here
```

Keep local secrets in ignored `apps/api/.env`.

The real-PostgreSQL integration suite is intentionally separate from the unit
suite. It mutates only an explicitly acknowledged database whose exact name
contains a `test` or `ci` segment. Set `DATABASE_URL`,
`ODDPATH_DB_INTEGRATION_DATABASE=<exact-name>`, and
`ODDPATH_DB_INTEGRATION_TESTS=1`; see the root README for the complete local
gate and remote-target safety acknowledgement. Never point it at the normal
development, staging, or production database.

## AI Providers

The chat service talks to the AI layer through a provider registry instead of calling Gemini directly.

Active provider:

```text
gemini
```

To add another provider later, add a provider adapter in `src/modules/ai`, register its model catalog in `provider-registry.ts`, and keep the shared `AiProviderAdapter` contract unchanged.

## Routes

```text
GET  /api/health
GET  /api/health/ready
POST /api/auth/register
POST /api/auth/login
POST /api/auth/forgot-password
POST /api/auth/reset-password
POST /api/auth/verify-email
POST /api/auth/resend-verification
GET  /api/auth/me
POST /api/auth/logout
POST /api/chat
POST /api/assets/initiate
POST /api/assets/:assetId/complete
GET  /api/assets/:assetId/download
DELETE /api/assets/:assetId
```

Auth uses password hashes, server-side session rows, an httpOnly `qa_session`
cookie, verified-email registration, and provider-backed password-reset email.
Google OAuth is intentionally not wired.

## Usage Limits

`POST /api/chat` stays available to guests for portfolio demos, but usage is reserved as credits before Gemini is called. Successful chat responses include a `usage` summary so the frontend can show the remaining daily credits.

Defaults:

```env
GUEST_DAILY_CREDITS=20
USER_DAILY_CREDITS=100
USAGE_TOKENS_PER_CREDIT=1000
USAGE_IMAGE_CREDITS=4
USAGE_TEXT_FILE_CREDITS=1
USAGE_ROUTER_CREDITS=1
USAGE_WINDOW_HOURS=24
MAX_MESSAGE_CHARS=3000
MAX_HISTORY_MESSAGES=10
```

Guests are tracked with an httpOnly `qa_guest_id` cookie plus a hashed IP fallback. Signed-in users are tracked by `userId`. Each `UsageEvent` stores the reserved/actual credits, model, workflow, attachment counts, and token metadata when the provider returns it.

## Private Assets (Disabled Until Staging Activation)

Private assets are fail-closed and disabled by default. When enabled, the API
supports authenticated initiate -> direct presigned PUT -> complete/validate ->
short-lived GET, backed by a private Cloudflare R2 EU-jurisdiction bucket.
Server-generated keys contain purpose/date/random data but no user ID. The PUT
signature binds content length, MIME, SHA-256 checksum, and `If-None-Match: *`.
The initial release validates in place rather than copying from a staging key:
the conditional PUT prevents overwriting an existing object, and every delete
is delayed until the upload URL expiry plus five minutes so a still-valid URL
cannot recreate an orphan after deletion. A presigned URL remains a bearer
credential until its short TTL ends, so real-browser/R2 staging verification is
still mandatory.

Supported initial types are PNG, JPEG, WebP, valid JSON, and the bounded UTF-8
text/code types already accepted by Project Knowledge. Project Document source
assets must be text and require access to a `projectId`; chat assets may
optionally be associated with an accessible project. Limits and bucket
credentials are documented in `.env.example`.

The signed-in integration contract accepts `{ assetId }` chat attachments and
`{ sourceAssetId }` Project Document imports while retaining legacy inline
input for rollout and guests. Before any provider read or database link, the
API rechecks owner, `READY` status, purpose, and exact project scope. Chat saves
upsert stable messages and persist normalized `MessageAttachment` rows; Project
Documents keep extracted text/chunks in PostgreSQL and link the original object
through `sourceAssetId`. Responses expose only safe metadata and opaque IDs.

After `npm run build:api`, run the compiled `npm run assets:cleanup` command
from a trusted scheduler (recommended every five minutes). The single-run
worker uses a non-blocking PostgreSQL try-lock plus
leases, renews and completes each object deletion with an exact lease-token
compare-and-set, retries failed
private-object deletion with bounded backoff, and removes expired pending,
stale validating, failed, and old unreferenced asset rows. It logs counts and
backlog/failure/lease-conflict metrics as one structured JSON event, never
object keys, provider errors, or presigned URL queries. A deletion failure or
lease conflict makes the scheduled command exit nonzero for alerting.
Configured storage cleanup continues even when the feature flag is turned off,
so disabling new uploads cannot strand deletion-outbox work.

After `npm run build:api`, run the compiled `npm run cleanup:retention` command
at least daily. Each database transaction takes a non-blocking advisory
try-lock and removes at most `RETENTION_CLEANUP_BATCH_SIZE` rows from each
eligible table. One scheduler invocation drains up to 20 such transactions,
stops early when drained or when a full batch makes no progress, and aggregates
the removal counts. It also cancels expired pending/processing auth-email jobs
and clears their encrypted payloads, then purges old terminal email jobs. A
remaining `mayHaveMore: true` value makes the command exit nonzero so the
scheduler can alert; an immediate overlapping run exits without waiting.

Archive v2 and the frontend Preview/Commit flow include bounded private files.
Keep `PRIVATE_ASSETS_ENABLED=false` in production until the guarded real-
PostgreSQL restore/cleanup suite, EU R2 interruption smoke, and scheduled
multi-instance cleanup validation are recorded.

The EU R2 provider check is an explicit create/verify/delete operation with
sanitized output. Provisioning, CORS prerequisites, confirmation, and the
compiled `npm run smoke:r2` command are documented in
`docs/R2_SMOKE_RUNBOOK.md`.
