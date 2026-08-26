# Oddpath

Oddpath is a QA-focused AI workspace for test cases, bug reports, edge cases, checklist generation, visual review, and chat export/import.

## What It Does

- Generates practical QA artifacts: test cases, bug reports, edge cases, QA checklists, and visual reviews.
- Supports guest demo usage with backend credit limits before AI calls.
- Supports password accounts with httpOnly session cookies.
- Persists signed-in user chats in PostgreSQL with ownership checks.
- Links signed-in chats to owned projects through the persistence API and project access boundary.
- Provides signed-in project management with project-scoped chats, instructions, and documents.
- Injects isolated Account Memory, Project Instructions, and Project Documents into AI prompts.
- Imports and safely previews supported text, data, and code files as project knowledge.
- Accepts inline image and text/data attachments for QA context.
- Tracks credits by model, workflow, attachment count, and provider token metadata when available.
- Routes AI workflows and model selection through backend services instead of hardcoded frontend prompts.

## Stack

- Frontend: Vue 3, TypeScript, Vite, Bootstrap
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- AI provider layer: provider registry with Gemini active
- Styling: Bootstrap plus app SCSS under `apps/web/src/styles`

## Architecture Snapshot

```text
Vue app
  -> /api/auth       cookie-backed password sessions
  -> /api/chat       chat orchestration, usage guard, workflow routing
  -> /api/chats      signed-in user chat persistence and project links
  -> /api/projects   projects, instructions, and project documents
  -> /api/memories   signed-in account memory
  -> /api/ai/models  active provider model catalog
  -> /api/settings   signed-in user preferences
  -> /api/usage      current identity usage summary

Express API
  -> Prisma/PostgreSQL for users, sessions, chats, projects, knowledge, and usage
  -> shared project access boundary for project-owned resources
  -> AI provider registry for Gemini today and future providers later
  -> model router + fallback for general, visual, and fallback model choices
  -> workflow router for multilingual and ambiguous QA intent detection
```

Key architecture docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Development Guide](docs/DEVELOPMENT_GUIDE.md)
- [Oddpath Real-User Launch Plan](docs/ODDPATH_LAUNCH_PLAN.md)
- [Cloudflare + Render Deployment Runbook](docs/DEPLOYMENT_CLOUDFLARE_RENDER.md)
- [Production Deployment And Readiness](docs/PRODUCTION_READINESS.md)
- [Next Steps](docs/NEXT_STEPS.md)

## Project Structure

```text
apps/
  api/        TypeScript Express API
  web/        Vue 3 web app
    src/
      styles/ App SCSS partials imported by Vite

docs/         Architecture, migration, cleanup, readiness, and development notes
docker-compose.yml
```

## Development

Install dependencies:

```bash
npm install
```

Start PostgreSQL and apply migrations:

```bash
npm run db:up
npm run db:migrate
```

Run the API and web app in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

In VS Code, use the included tasks `dev:api` and `dev:web` from **Terminal > Run Task**. Do not use Live Server for this app; it only serves static root files and will not run the Vite app correctly.

The web app runs on:

```text
http://127.0.0.1:5173
```

The API runs on:

```text
http://127.0.0.1:5000
```

## Environment

Create `apps/api/.env` from `apps/api/.env.example`.

At minimum, local development expects:

```text
GEMINI_API_KEY=your_key
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public
```

If `DATABASE_URL` is omitted, the API uses the local PostgreSQL URL above.

For split web/API deployments, review `COOKIE_SAME_SITE`, `COOKIE_SECURE`, and
`CORS_ORIGIN` in
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

## Database

PostgreSQL is managed through Docker Compose:

```bash
npm run db:up
npm run db:down
npm run db:logs
npm run db:migrate
```

Use Prisma Studio to inspect local data:

```bash
npm run db:studio
```

If auth returns `DATABASE_UNAVAILABLE` or Prisma Studio cannot load tables, make sure Docker Desktop is running and PostgreSQL is reachable on `localhost:5432`.

## Auth Notes

Password auth uses httpOnly session cookies and hashed passwords. Email
verification, forgot-password email, and the reset-password page are
implemented. Local development captures auth email in memory by default;
production fails closed unless a complete SMTP configuration is present.

## Verification

Deployment builds of the web app fail closed unless the exact HTTPS API origin
is available at build time. For a local production-build check, copy
`apps/web/.env.production.example` to the ignored
`apps/web/.env.production.local`, review `VITE_API_BASE_URL`, and then run the
commands below. If direct browser transfers to the private EU R2 bucket are
enabled later, also set `VITE_R2_ENDPOINT` to that exact account endpoint; do
not use a wildcard or path. CI and Cloudflare Pages inject their own reviewed
environment-specific values.

```bash
npm run verify
npm run build:api
npm run build:web
```

The scheduled operations commands run compiled API artifacts. Run
`npm run build:api` before `npm run cleanup:retention` or
`npm run assets:cleanup`. For local source execution only, use the explicit
`npm run cleanup:retention:dev` and `npm run assets:cleanup:dev` variants;
production schedulers must not use `tsx` or a `*:dev` command.

`npm run verify` starts with API source, API test, and web type checks so
generated Prisma client code exists even on a clean CI checkout and test mocks
cannot silently drift from application contracts. It then runs both test
suites. The API check also enforces repository contract boundaries and rejects
runtime dependency cycles through `npm run check:architecture`. GitHub CI
also applies every committed migration to a fresh PostgreSQL 16 service before
the verification and build gates. It then fails closed if migration history or
the deployed database shape differs from `schema.prisma`, and runs a focused
real-PostgreSQL suite for terms, private assets, the auth-email outbox, and
concurrent usage, project-count, chat-count, document-count, and asset-byte
reservations. The suite also matches Prisma's applied migration rows to every
committed migration, exercises owner-scoped project mutations, and verifies
that invalid source-asset links roll back atomically.

To run those database-only gates locally, point at a disposable migrated test
database whose name contains a distinct `test` or `ci` segment. The integration
suite mutates and cleans up test-owned rows. Name the exact target separately so
a copied command cannot silently run against the normal development database:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oddpath_test?schema=public npm run db:migrate:deploy
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oddpath_test?schema=public npm run db:drift:check
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/oddpath_test?schema=public ODDPATH_DB_INTEGRATION_DATABASE=oddpath_test ODDPATH_DB_INTEGRATION_TESTS=1 npm run test:integration:db
```

On PowerShell, set `DATABASE_URL`, `ODDPATH_DB_INTEGRATION_DATABASE`, and
`ODDPATH_DB_INTEGRATION_TESTS="1"` as process environment variables before
running the three commands. The suite never creates a database or starts Docker
itself. It refuses production-like database names, name mismatches, non-public
schemas, and remote hosts; a deliberately isolated remote test database needs
the additional `ODDPATH_DB_INTEGRATION_ALLOW_REMOTE=1` acknowledgement.

Before sharing or deploying the app, use
[docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md). The current
`db:migrate` script is for local development; production uses the existing
`npm run db:migrate:deploy` command backed by `prisma migrate deploy`.

Current verification status and exact test counts are tracked in
[docs/AI_HANDOFF.md](docs/AI_HANDOFF.md) so this README does not become stale.

## Current Gaps

- Google OAuth is not wired yet; the UI button is disabled intentionally.
- Project member authorization, smart memory import/export, and broader
  attachment support are future work.
- Admin usage, plans/billing, PDF/video, and provider file uploads are roadmap items.
- Real-user production remains gated on managed PostgreSQL, automated backups,
  a tested restore, staging smoke tests, host/proxy rate limiting, and the
  reviewed retention policy plus scheduled/monitored retention and external
  object-deletion jobs. Relational account deletion and bounded retention
  cleanup are already implemented.

## Styling

Edit SCSS under `apps/web/src/styles/`. Vite compiles it directly from `apps/web/src/main.ts`, so there is no separate root CSS build step.

Prefer Bootstrap utilities for generic spacing, display, and controls. Keep custom SCSS for product-specific surfaces like the sidebar, chat bubbles, composer, Project Knowledge, markdown output, modals, and themes.
