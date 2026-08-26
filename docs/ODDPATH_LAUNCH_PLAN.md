# Oddpath Real-User Launch Plan

This is the active implementation plan for preparing Oddpath for a small
real-user beta in Germany. It records the selected deployment shape, ownership
boundaries, implementation order, and launch gates.

## Fixed Decisions

- Product name: **Oddpath**.
- Parent domain: `eluthira.com`.
- Product URL: `https://oddpath.eluthira.com`.
- Product page on the future Eluthira site: `https://eluthira.com/oddpath`.
  That page belongs to the Eluthira site and should link or redirect to the
  product URL; it is not served by this repository.
- API URL: `https://api.oddpath.eluthira.com`.
- Registrar: Porkbun.
- DNS and static frontend: Cloudflare DNS and Pages.
- API and PostgreSQL: Render, both in Frankfurt and connected over Render's
  private network.
- Private object storage: Cloudflare R2 with **EU jurisdiction**.
- Transactional email: Brevo SMTP using a verified Eluthira sender domain.
- AI: paid Gemini service for every production request. Development, staging,
  and production use different keys and billing projects.

Porkbun is only the registrar. Opening a Cloudflare account does not replace
the Render account: Pages serves the compiled Vue app, Render runs the Node API
and PostgreSQL, and R2 stores private binary objects.

## Request And Data Flow

```text
Browser
  -> oddpath.eluthira.com              Cloudflare Pages (static Vue build)
  -> api.oddpath.eluthira.com          Render Frankfurt (Node/Express)
       -> private Render PostgreSQL    accounts, chats, text, metadata, indexes
       -> Gemini paid service          AI requests
       -> Brevo SMTP                   verification and password-reset email

Browser
  -> short-lived presigned R2 URL      direct private upload/download
       -> R2 EU-jurisdiction bucket    original images and files
```

The R2 bucket must remain private. The database stores an opaque asset ID and
object key, never a permanent public URL or a presigned URL. Project Document
text and search chunks remain in PostgreSQL because they are searchable RAG
content; the original uploaded file may additionally live in R2.

The API hostname should point directly to Render. Do not enable the Cloudflare
HTTP proxy for prompts, documents, or chat traffic unless the privacy/data-flow
decision is revisited. Cloudflare can still be authoritative DNS for the
hostname.

## Ownership Boundary

### Work implemented in this repository

- Provider-specific deployment configuration and production environment
  validation.
- Database-aware readiness checks, graceful shutdown, proxy/IP correctness,
  and deploy/runbook documentation.
- Private object-storage adapter, database schema, presigned upload lifecycle,
  validation, authorization, quotas, and orphan cleanup.
- Signed-in chat attachment persistence without base64 or signed URLs in local
  browser storage.
- Original Project Document storage while retaining extracted text in the
  database.
- Account export, account deletion, storage deletion, and retention jobs.
- AI cost/abuse guards, safe logging, health/monitoring hooks, and tests.
- In-product AI notice and legal-page surfaces with clearly marked fields that
  require the operator's identity and final legal wording.
- Staging and production checklists, migration procedure, restore drill, and
  post-deploy smoke tests.

### Work that requires the operator

- Buy and renew `eluthira.com`.
- Create provider accounts, enable 2FA, add a payment method, and choose the
  correct personal/individual billing profile.
- Accept and archive provider DPA/AVV terms and subprocessor lists.
- Create the production resources and enter secrets in provider secret
  managers.
- Change Porkbun nameservers, add/verify DNS records, and verify the Brevo
  sending domain.
- Enable paid Gemini billing and set provider-side budget alerts.
- Supply the legal operator name/address/contact details and obtain the final
  German privacy/legal review.
- Run the first backup restore drill with the live provider resources.

Passwords, recovery codes, and 2FA codes must never be committed or sent in
chat. Production secret values go directly into Render, Cloudflare, Brevo, or
Google's secret/billing interfaces.

## Implementation Order

### Phase 0 - Baseline and decision record

Status: complete.

- Record the selected providers, domains, regions, data flow, and cost boundary.
- Reconcile stale documentation with already implemented authentication and
  portability features.
- Keep the existing user-owned worktree changes untouched.
- Establish a clean verification baseline with `npm run verify`.

Acceptance: all current tests and TypeScript checks pass before implementation
changes. Baseline on 2026-08-09: passed.

### Phase 1 - Account-independent deployment foundation

Status: complete in the repository. Provider provisioning and live smoke tests
remain Phase 6 operator work.

- Add a Render Blueprint for one Frankfurt API service and one Frankfurt
  PostgreSQL database, without committing secret values.
- Build from the monorepo root:
  - build: `npm ci --include=dev && npm run build:api`
  - pre-deploy: `npm run db:migrate:deploy`
  - start: `npm --prefix apps/api run start`
- Document Cloudflare Pages settings:
  - root: repository root
  - build: `npm run build:web`
  - output: `apps/web/dist`
  - `VITE_API_BASE_URL=https://api.oddpath.eluthira.com`
  - omit `VITE_R2_ENDPOINT` while private assets are disabled; when activated,
    set the exact EU account endpoint separately in staging and production
- Add production fail-fast checks for the Gemini key, explicit paid-service
  acknowledgement, strong IP-hash salt, exact app origin, cookie security, and
  an explicit trusted-proxy setting.
- Add a database-aware readiness endpoint. Keep the simple liveness endpoint
  independent of external providers.
- Add graceful `SIGTERM`/`SIGINT` shutdown and database disconnect behavior.
- Add a fail-closed high/critical production dependency audit as a separate CI
  deploy gate.

Acceptance: API/web builds pass; unsafe production configuration cannot boot;
readiness fails safely when the database is unavailable; no secret is present
in the Blueprint or repository.

### Phase 2 - AI cost and request safety

Status: repository safeguards are implemented. Paid Gemini provisioning,
provider-side budgets/alerts, conservative production values, and staging
smoke tests remain Phase 6 operator work. The internal credit ledger remains a
safety guard rather than a guaranteed currency-denominated provider spend cap.

- Bound chat modes, every history entry, the total prompt envelope, provider
  names, and model identifiers.
- Add production kill switches, with guest AI disabled by default for the first
  beta and an explicit operator opt-in.
- Track provider attempts separately from successful responses. A timeout,
  crash, or unknown billing result must not silently become zero cost.
- Preserve attachment/router charges when final token usage is recorded.
- Apply per-user budgets across chat, summaries, and embeddings, not chat alone.
- Add maximum in-flight requests per identity and a conservative global guard.
- Add hourly/daily/monthly cost ceilings and provider-side budget alerts.
- Redact raw SDK/provider errors, prompts, credentials, and presigned URLs from
  logs.

Acceptance: tests cover failed/unknown provider attempts, concurrent requests,
attachments, router calls, multilingual token estimates, and all kill switches.

### Phase 3 - Private R2 asset foundation

Status: implemented for staging behind `PRIVATE_ASSETS_ENABLED=false`. The authenticated
asset lifecycle, conservative validation, atomic quota reservation, deletion
outbox worker, and replay-safe cleanup are covered by automated tests. Provider
provisioning, scheduler monitoring, and real R2 staging smoke tests remain
open; this phase must not be described as production-ready.
Production startup additionally rejects `PRIVATE_ASSETS_ENABLED=true` until
the real PostgreSQL restore/cleanup gate and EU R2 interruption matrix pass.
Account/Project archive v2 now carries eligible original objects under a
strict 64-asset, 4-MiB-per-file, 8-MiB-total ceiling and still accepts v1.
This bounded `fflate` in-memory path is not an arbitrary-size streaming export.
Uploads currently validate in place (no staging-to-final copy). Signed PUTs use
`If-None-Match: *`, and deletion is held until upload expiry plus clock-skew
grace to close the delete-then-replay orphan window. The short-lived URL is
still a bearer credential until expiry.

- Add an S3-compatible object-storage interface and an R2 implementation.
- Add normalized `StoredAsset`, `MessageAttachment`, and deletion-outbox data.
- Use additive migrations so existing chats and documents keep working.
- Implement authenticated initiate -> direct PUT -> complete/validate flow.
- Generate server-owned random object keys; never accept an object key from the
  browser.
- Validate final size, supported MIME/magic bytes, UTF-8 text, checksum where
  available, purpose, ownership, project access, expiry, and quota.
- Return short-lived download/read URLs only after authorization.
- Add cleanup for expired pending uploads, unreferenced assets, and retryable
  deletion jobs. The application worker is the primary deletion mechanism.

Initial limits remain conservative: four attachments, 4 MiB per image, 1 MB per
text file, short-lived upload/read URLs, limited concurrent uploads, and a
configurable per-user storage quota.

Acceptance: the bucket can remain fully private; cross-user asset access returns
not found; pending/failed assets cannot be used; cleanup is idempotent; no
base64, object key, or presigned URL is persisted in browser chat storage.

### Phase 4 - Product integration and deletion lifecycle

Status: password-confirmed relational account deletion, transactional deletion
outbox enqueueing, browser account cleanup, stable message reconciliation, and
the API and browser chat/Project Document StoredAsset integrations are
implemented and covered by automated tests. Running and monitoring the
deletion worker and passing real R2 staging tests remain required before this
phase is complete. Until then the R2 feature flag remains off.

- Keep current inline attachments for guests during migration; persist private
  files only for authenticated users.
- Allow the API to accept both legacy inline input and new asset IDs during the
  rollout.
- Reconcile/upsert stable messages instead of deleting and recreating all
  messages, so normalized attachment relations remain valid.
- Integrate R2 assets into signed-in chat, display, download, and Gemini input.
- Upload original Project Documents to R2 while keeping extracted text/chunks in
  PostgreSQL. Legacy documents continue working without backfill.
- Include eligible stored files through bounded Account/Project archive v2,
  preserving v1 import compatibility. Restore stages destination rows and
  cleanup jobs before immutable writes, then finalizes file relations in the
  canonical import transaction.
- Implement authenticated account deletion. Database deletion and R2 deletion
  are coupled through an outbox so a provider failure cannot leave accessible
  user files.

Acceptance: chat/project/account deletion queues every related object; export
truthfully represents file coverage; legacy records still open; restore and
orphan-cleanup tests pass. Before production, additionally run the existing
real-PostgreSQL cases and a real EU R2 conditional-PUT/checksum/range/delete
interruption matrix, prove the implemented restore fencing under real process
kill/freeze, validate the locally covered maximum boundary under production
timeout/latency conditions, and operate monitored cleanup/reconciliation
across the intended API instance count.

### Phase 5 - Retention, privacy surfaces, and operations

- Define and implement separate retention periods for sessions/tokens, chats,
  memories, project files/chunks, security logs, usage/IP hashes, backups, and
  deletion jobs.
- Add scheduled purge commands and document who runs and monitors them.
- The repository now provides `npm run cleanup:retention`. It removes expired
  sessions, old used/expired auth tokens, old usage records, and old unverified
  accounts that have no session. It also clears encrypted payloads from expired
  queued auth-email jobs and removes old terminal jobs. Account cleanup uses the
  same transactional R2 deletion outbox as explicit account deletion. Each
  transaction is bounded by `RETENTION_CLEANUP_BATCH_SIZE`, and one invocation
  drains at most 20 batches; a PostgreSQL advisory try-lock makes overlap exit
  immediately. Remaining backlog or no-progress stops exit nonzero for
  scheduler alerting. Scheduling and alert ownership remain deployment work,
  with an opt-in paid Render cron example under `ops/`.
- Add the first-interaction AI disclosure and a visible memory view/edit/delete
  path.
- Add Privacy, Impressum, Terms/AUP, and contact surfaces. Final operator details
  and legal wording remain an operator/legal-review gate.
- Add incident/breach and data-request runbooks.
- Add monitoring for API readiness, 5xx/429 rates, database capacity, backup
  state, AI spend/errors, upload failures, and deletion backlog.

Acceptance: retention jobs and user deletion are tested; no optional analytics
or tracking is loaded before a separate consent decision; operational alerts
have an owner.

### Phase 6 - Account integration and staging

- Connect Porkbun to Cloudflare nameservers.
- Create staging and production resources with separate databases and secrets.
- Configure the R2 EU-jurisdiction bucket and bucket-scoped token.
- Configure Render Frankfurt, Brevo DNS/SMTP, and paid Gemini credentials.
- Deploy staging, run migrations once, and execute the full smoke checklist.
- Verify cookie, CORS, CSRF, real client IP, object authorization, and email in a
  clean browser.
- Enable automated backups/PITR and complete one isolated restore drill.
- Only then point production DNS and invite real users.

Acceptance: no production blocker remains open in
`docs/PRODUCTION_READINESS.md`.

## Account Setup Queue

The operator can prepare these in parallel without blocking repository work:

1. Porkbun: purchase `eluthira.com`, enable 2FA, renewal, and WHOIS privacy;
   leave nameservers unchanged until Cloudflare supplies the pair to use.
2. Cloudflare: create a personal account and enable 2FA. Do not create a normal
   location-hint-only bucket; the production bucket must explicitly use EU
   jurisdiction.
3. Render: create an account and billing profile. Do not manually duplicate the
   API/database before the Blueprint is reviewed.
4. Brevo: create an account, enable 2FA, and prepare to authenticate
   `eluthira.com`; DNS records are added after Cloudflare controls DNS.
5. Google Cloud/Gemini: create a dedicated production project and individual
   billing profile, enable paid service, and set a deliberately low budget
   alert. Do not reuse a personal development key in production.

Provider contracts and current setup links are maintained in the deployment
runbook; archive a dated copy of every accepted DPA/AVV and subprocessor list.

## Launch Policy

The first real-user release is an invite-only beta with verified accounts,
guest AI disabled by default, conservative quotas, and no paid end-user plan.
Being free to users does not remove the production data-safety, privacy, or
provider-billing requirements.
