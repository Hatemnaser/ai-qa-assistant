# AI QA Assistant Architecture

## Direction

AI QA Assistant has moved from the original vanilla prototype into a Vue and TypeScript product structure. The legacy frontend and CommonJS backend have been removed after parity migration.

Target stack:

- Frontend: Vue 3, TypeScript, Vite, Bootstrap
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- Background jobs later: Redis and BullMQ
- Payments later: Stripe with webhook-first state updates

## Principles

- Keep features modular by domain, not by technical layer only.
- Keep API contracts explicit with request schemas and response types.
- Keep provider integrations behind adapters so Gemini, Stripe, and future platforms do not leak across the app.
- Keep user, project, chat, and memory data in PostgreSQL instead of browser storage.
- Keep billing, integrations, and AI usage auditable through event tables.
- Keep frontend styling in `apps/web/src/styles`. Do not add ad hoc CSS files for new Vue work. Prefer Bootstrap utilities for generic layout and keep SCSS for product-specific UI.

## Repository Shape

```text
apps/
  web/
    src/
      features/
      ui/
      styles/
      App.vue
      main.ts

  api/
    src/
      app.ts
      server.ts
      config/
      middleware/
      modules/
      lib/
```

See `docs/MIGRATION.md` for the cleanup and removal policy.

## Backend Module Pattern

Each backend module should follow this pattern when the module has enough behavior to justify the files:

```text
modules/<feature>/
  <feature>.routes.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.repository.ts
  <feature>.schema.ts
  <feature>.types.ts
```

Small modules can start with fewer files, but should not put business logic directly in route definitions.

## Active Backend Modules

- `health`: service status and deployment checks.
- `auth`: password registration, password login, password reset request contract, httpOnly session cookies, and server-side session records.
- `ai`: provider registry, provider adapters, model catalog, QA workflow intent analysis, prompt building, model normalization, AI error mapping.
- `chat`: chat API contract and orchestration.
- `usage`: portfolio/demo usage limits for guests and signed-in users before AI provider calls.

## Active Frontend Routes

- `#/`: chat workspace.
- `#/login`: sign-in page wired to cookie-backed auth.
- `#/register`: account creation page wired to cookie-backed auth.
- `#/forgot-password`: password reset request page.

The frontend auth pages call the API with `credentials: "include"` so sessions stay in the httpOnly cookie. Google OAuth and real reset emails are still future integrations.

## Later Backend Modules

- `projects`: project ownership, members, and chat grouping.
- `memory`: user memory, project memory, chat summaries, and later vector search.
- `settings`: user preferences, language, model defaults, and theme.

## Active API Routes

- `GET /api/health`: health check.
- `POST /api/auth/register`: create a password user and set a session cookie.
- `POST /api/auth/login`: validate credentials and set a session cookie.
- `POST /api/auth/forgot-password`: accept reset requests with a generic response.
- `GET /api/auth/me`: read the current user from the session cookie.
- `POST /api/auth/logout`: delete the current session when present and clear the cookie.
- `POST /api/chat`: generate a QA assistant reply.

`POST /api/chat` allows anonymous portfolio usage. Guests receive an httpOnly `qa_guest_id` cookie and are limited separately from signed-in users. The API also hashes the request IP as a fallback abuse guard. Usage is reserved before calling Gemini so the API key is protected from unbounded demo traffic. Successful chat responses include a `usage` summary with `used`, `remaining`, and `limit`.

## AI Workflow Layer

The chat service talks to AI providers through the provider registry, not directly through a specific vendor SDK. Gemini is the active provider today. Future providers should implement the shared provider adapter contract and register their model catalog without changing chat orchestration, usage limits, auth, or workflow analysis.

The backend treats the selected chat mode as a helpful default, not as an absolute instruction. Before building the provider prompt, the `ai` module analyzes the latest user message, attachment state, and selected mode to detect the active QA workflow:

- conversational follow-up
- language preference
- test cases
- bug report
- edge cases
- checklist
- visual review

The latest user message is the strongest signal. For example, a short follow-up such as "thanks" or "can you speak Arabic?" should be answered naturally even if the previous mode was Bug Report or Checklist. A direct artifact request such as "create test cases for checkout" should still produce the requested artifact even when the selected mode is General QA.

Prompt templates should stay workflow-aware and practical. They should state assumptions, ask focused questions when a request is underspecified, and avoid inventing product rules that were not provided by the user.

The behavior contract is covered by `docs/AI_BEHAVIOR_EVALS.md` and `apps/api/tests/ai-behavior.test.ts`.

The frontend composer uses generic attachment state, even though the current backend payload only sends image data to Gemini. This keeps the UI and chat storage ready for later file types without changing the chat controller contract again.

## Future Backend Modules

These are planned, but should not get active code or database tables until the core app is working:

- `billing`: plans, subscriptions, Stripe webhooks, entitlements, and usage limits.
- `integrations`: OAuth accounts, encrypted tokens, platform adapters, and sync jobs.

## Initial Data Model

```text
User
  id
  email
  name
  passwordHash
  createdAt
  updatedAt

Session
  id
  userId
  tokenHash
  expiresAt
  createdAt

Project
  id
  ownerId
  name
  description
  createdAt
  updatedAt

ProjectMember
  id
  projectId
  userId
  role
  createdAt

Chat
  id
  userId
  projectId
  title
  mode
  model
  createdAt
  updatedAt

Message
  id
  chatId
  role
  content
  mode
  model
  metadata
  createdAt

Memory
  id
  userId
  projectId
  scope
  content
  source
  confidence
  createdAt
  updatedAt

UserSettings
  id
  userId
  language
  theme
  defaultModel
  aiPreferences
  updatedAt

UsageEvent
  id
  userId
  guestId
  ipHash
  action
  units
  createdAt
```

Billing and integrations will add their own tables only when those phases begin. The active schema should stay focused on users, sessions, settings, projects, chats, messages, memory, AI usage, and demo usage limits.

## Migration Plan

1. Create the new TypeScript API in `apps/api`.
2. Port the existing `/api/chat` behavior into modular API files.
3. Add Prisma and PostgreSQL.
4. Add the Vue app shell in `apps/web`.
5. Move the existing chat screen and local chat behavior into the new web app.
6. Delete legacy code only after parity testing. Done.
7. Add auth, projects, settings, i18n, and memory after the migration is stable.
8. Add billing and integrations after the core product data model is stable.

## Prisma Setup Notes

The API uses Prisma ORM 7. Prisma 7 generates the client into an explicit source folder instead of relying on hidden `node_modules` output.

```text
apps/api/prisma/schema.prisma
apps/api/prisma.config.ts
apps/api/src/generated/prisma/
```

The generated client is ignored by Git and recreated by `npm run db:generate`, `npm run check`, or `npm run build` inside `apps/api`.
