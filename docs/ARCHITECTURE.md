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
- `auth`: password registration, password login, password reset request contract, and server-side session records.
- `ai`: provider adapters, prompt building, model normalization, AI error mapping.
- `chat`: chat API contract and orchestration.

## Active Frontend Routes

- `#/`: chat workspace.
- `#/login`: sign-in UI shell.
- `#/register`: account creation UI shell.
- `#/forgot-password`: password reset UI shell.

The auth pages are still not wired to the API. The backend auth module now owns password registration, password login, and password reset request contracts. Google OAuth and real reset emails are still future integrations.

## Later Backend Modules

- `projects`: project ownership, members, and chat grouping.
- `memory`: user memory, project memory, chat summaries, and later vector search.
- `settings`: user preferences, language, model defaults, and theme.

## Active API Routes

- `GET /api/health`: health check.
- `POST /api/auth/register`: create a password user and session token.
- `POST /api/auth/login`: validate credentials and create a session token.
- `POST /api/auth/forgot-password`: accept reset requests with a generic response.
- `POST /api/chat`: generate a QA assistant reply.

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
```

Billing and integrations will add their own tables only when those phases begin. The active schema should stay focused on users, sessions, settings, projects, chats, messages, memory, and AI usage.

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
