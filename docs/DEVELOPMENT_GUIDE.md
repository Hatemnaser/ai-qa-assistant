# Development Guide

This project is currently in foundation and migration mode. Do not add new product features unless the current task explicitly asks for one.

## Working Style

- Prefer Vue templates and Bootstrap classes for UI work.
- Keep TypeScript light and local. Put shared shapes in `types.ts`, but avoid clever generics or type-heavy abstractions.
- Use Bootstrap utilities first for generic layout and controls.
- Use shared Bootstrap-compatible classes for repeated UI: `.btn-control`, `.form-control`, `.form-label`, `.form-check`, `.ui-row`, and `.ui-icon-btn`.
- Treat `apps/web/src/styles/abstracts/_variables.scss` and `apps/web/src/styles/themes/_dark.scss` as the design-system source of truth.
- Use semantic tokens in component SCSS: `--surface-*`, `--text-*`, `--border-*`, `--action-*`, and `--status-*`.
- Do not put raw hex colors or one-off button/input colors in component SCSS. Add or adjust a token first.
- Keep custom styling in `apps/web/src/styles`. Vite compiles SCSS directly; there is no root CSS build step.
- Do not create new ad hoc CSS files such as `apps/web/src/styles.css`.
- Keep `styles/layout/*` structural only: app shells, page grids, sticky/scroll regions, and responsive layout.
- Put reusable component patterns in `styles/components/*`, even when they are used by a page-level feature.
- For sidebar work, keep workspace navigation outside the history scroll area and keep recent chats as compact rows.
- Row behavior belongs in shared `.ui-row*` styles; keep `_sidebar.scss` focused on shell layout and scrolling.
- For repeated controls, prefer the existing tokens and shared classes such as `.ui-icon-btn` before adding component-only CSS.
- Keep `/api/chat` open for portfolio demos, but enforce backend usage limits before provider calls.
- Legacy files have been removed after parity. Use the docs and tests as the migration reference.

## Before Changing Code

1. Check whether the change is a feature, a migration cleanup, or a bug fix.
2. If it is a future feature like settings, projects, memory, billing, or integrations, document it instead of adding active code unless the task explicitly starts that phase.
3. Auth has a backend module now. Keep password auth, httpOnly session cookies, session records, and reset request contracts there; keep Google OAuth and reset email delivery out until that phase starts.
4. If it touches UI styling, look for the matching SCSS partial first.
5. If it touches existing chat behavior, keep localStorage keys and API contracts compatible.
6. If it touches AI calls, check the `usage` module so guest and user limits keep protecting the Gemini key, and preserve the chat response `usage` summary.
7. If it touches memory or conversation continuity, follow `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.
   - Keep Account Memory, Project Memory, Conversation Summary, Project Instructions, and Project Documents as separate concepts.
   - Use complete user/assistant turns for recent context.
   - Never write AI-extracted facts directly into canonical memory without user review.

## Frontend Pattern

Use this shape for new or migrated frontend code:

```text
apps/web/src/features/<feature>/
  pages/
  components/
  composables/
  <feature>Api.ts
  <feature>Storage.ts
  <feature>Messages.ts
  types.ts
```

Do not create every file up front. Add a file only when it removes real weight from another file.

Vue components should stay mostly template + small event handlers. If a component starts carrying business logic, move that logic into a helper or composable.
Reusable UI primitives that are not tied to one feature live in `apps/web/src/ui`. Keep them thin, Bootstrap-compatible, and backed by shared SCSS classes.

Auth routes currently use a small hash route composable:

```text
#/login
#/register
#/forgot-password
```

Do not introduce Vue Router until navigation grows beyond a few shell pages.
Keep the hash route implementation in `apps/web/src/router/useAppRoute.ts`; `App.vue` should only wire the active page.
Auth pages should stay split by page, with shared framing in `features/auth/components/AuthLayout.vue`.

Account chat persistence lives in `features/chat/composables/useAccountChatSync.ts`. Keep database sync, debouncing, and local/remote merge logic out of `App.vue`.

## Backend Pattern

Use this shape when a backend module has enough behavior:

```text
apps/api/src/modules/<feature>/
  <feature>.routes.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.schema.ts
  <feature>.types.ts
```

Keep routes thin. Put validation in schemas, orchestration in services, and provider-specific code behind provider files.

## Verification

Start PostgreSQL before auth, persistence, or Prisma checks:

```bash
npm run db:up
npm run db:migrate
```

`npm run db:migrate` uses `prisma migrate dev` and is local-development only.
Never use it against staging or production. Follow
`docs/PRODUCTION_READINESS.md` for the production migration, backup, restore,
deployment, and rollback gates.

For staging or production releases, use only the deploy migration command from a
controlled release step:

```bash
npm run db:migrate:deploy
```

Run this before considering a cleanup done:

```bash
npm run verify
```

For local development, run the app through Vite:

```bash
npm run dev:web
```

Do not use VS Code Live Server for the app. It serves static files from the repository root and bypasses the Vite setup.

Run this after frontend styling or Vue changes when you want a production build check:

```bash
npm run build:web
```

Run this after API changes when you want a production API build check:

```bash
npm run build:api
```

Use Prisma Studio to inspect local accounts and chats:

```bash
npm run db:studio
```

If Prisma or auth reports `DATABASE_UNAVAILABLE`, check Docker Desktop and confirm PostgreSQL is reachable on `localhost:5432`.

## Current Priorities

1. Keep the migrated chat app stable.
2. Keep TypeScript readable for a Bootstrap-first workflow.
3. Preserve migrated chat behavior with tests and manual checks.
4. Reduce file weight when a file becomes hard to scan.
5. Keep the auth UI aligned with cookie-backed sessions and avoid browser-stored auth tokens.
6. Keep portfolio/demo access available while respecting usage limits.
7. Keep account-owned chats persisted in PostgreSQL and protected by `userId`.
