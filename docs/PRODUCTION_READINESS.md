# Production Deployment And Readiness

This document is the source of truth for preparing, deploying, verifying, and
operating AI QA Assistant outside local development.

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

The repository is not yet approved for real-user production traffic because
the operational data-safety gates below have not been completed.

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
- [ ] Add host/proxy-level rate limiting for public API traffic.
- [ ] Complete the auth security checkpoint: decide whether to keep and harden
  owned auth or migrate to a maintained auth library before real-user launch.
- [ ] Decide whether the first release is a portfolio demo or a real-user
  product. Real-user production also needs an account recovery decision,
  privacy/data-retention policy, and user-data deletion path.

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

The hosting provider decision is intentionally deferred while product features
are still moving. Keep the app deployment-agnostic and compatible with a low-cost
shape:

- Static host for `apps/web/dist`.
- Managed long-running Node host for `apps/api/dist/server.js`.
- Managed PostgreSQL with backups enabled.
- HTTPS for both web and API.
- Exact public origins in CORS and cookie configuration.

Preferred low-cost candidates when deployment becomes active:

- Web: Vercel Hobby or Cloudflare Pages static hosting.
- API: Railway Hobby, Render Starter, or another long-running Node host.
- Database: Neon Free/Launch or another managed PostgreSQL provider with a
  documented restore path.
- Domain: use provider subdomains first; buy a custom domain only when the
  release target is stable.

Do not commit to a provider-specific architecture until the product is closer to
release. Provider-specific setup belongs in a deployment decision record or this
runbook once selected.

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
PORT=5000
CORS_ORIGIN=https://your-web-origin.example
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
USAGE_IP_HASH_SALT=long_random_secret
```

Do not use local defaults or committed placeholder secrets in production.

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
MAX_MESSAGE_CHARS=3000
MAX_HISTORY_MESSAGES=10
REQUEST_BODY_LIMIT=25mb
```

Review provider quota and billing before increasing limits. Application
credits protect Gemini usage, but they do not replace host/proxy rate limiting.
Review request and message limits against the selected host's proxy limits
before enabling larger uploads.

### Web Configuration

Build the frontend with:

```text
VITE_API_BASE_URL=https://your-api-origin.example
```

The value is embedded at build time. Rebuild the web app when it changes.

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

- [ ] Health endpoint returns success.
- [ ] Registration creates a user.
- [ ] Login succeeds and survives refresh.
- [ ] Logout clears the session.
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

- Working account recovery.
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

Possible hosts include Vercel or another static host for the web app, and
Render, Railway, Fly.io, or another managed Node/PostgreSQL platform for the
API and database. Select providers based on verified current capabilities, not
this document alone.
