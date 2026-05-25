# AI QA Assistant

AI QA Assistant is a QA-focused chat workspace for test cases, bug reports, edge cases, checklist generation, visual review, and chat export/import.

## What It Does

- Generates practical QA artifacts: test cases, bug reports, edge cases, QA checklists, and visual reviews.
- Supports guest demo usage with backend credit limits before AI calls.
- Supports password accounts with httpOnly session cookies.
- Persists signed-in user chats in PostgreSQL with ownership checks.
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
  -> /api/chats      signed-in user chat persistence
  -> /api/ai/models  active provider model catalog
  -> /api/usage      current identity usage summary

Express API
  -> Prisma/PostgreSQL for users, sessions, chats, messages, usage events
  -> AI provider registry for Gemini today and future providers later
  -> model router + fallback for general, visual, and fallback model choices
  -> workflow router for multilingual and ambiguous QA intent detection
```

Key architecture docs:

- [Architecture](docs/ARCHITECTURE.md)
- [Development Guide](docs/DEVELOPMENT_GUIDE.md)
- [Production Readiness](docs/PRODUCTION_READINESS.md)
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

For split web/API deployments, review `COOKIE_SAME_SITE`, `COOKIE_SECURE`, and `CORS_ORIGIN` in [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

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

Password auth uses httpOnly session cookies and hashed passwords. Passwords cannot be viewed after registration; reset them by updating the password hash or by adding real reset email delivery later.

The forgot-password page currently returns a generic local response only. Email delivery and reset links are not implemented yet.

## Verification

```bash
npm run verify
npm run build:api
npm run build:web
```

Before sharing or deploying the app, use [docs/PRODUCTION_READINESS.md](docs/PRODUCTION_READINESS.md).

Current expected local verification:

- API tests: 110 passing
- Web tests: 36 passing
- API and web TypeScript checks passing

## Current Gaps

- Google OAuth is not wired yet; the UI button is disabled intentionally.
- Forgot password returns a safe generic response, but reset emails are not implemented yet.
- Settings, projects, memory, admin usage, billing, and provider file uploads are roadmap items.

## Styling

Edit SCSS under `apps/web/src/styles/`. Vite compiles it directly from `apps/web/src/main.ts`, so there is no separate root CSS build step.

Prefer Bootstrap utilities for generic spacing, display, and controls. Keep custom SCSS for product-specific surfaces like the sidebar, chat bubbles, composer, markdown output, modals, and themes.
