# AI Handoff

Use this file as the first context block for a fresh AI chat. It is intentionally short. For deeper roadmap details, read `docs/NEXT_STEPS.md`; for architecture details, read `docs/ARCHITECTURE.md`; for coding rules, read `docs/DEVELOPMENT_GUIDE.md`.

Last updated: 2026-05-30

## Current Repo State

- Workspace: `C:\Users\hatem\ai-qa-assistant`
- Local branch should start from `main`.
- Last known pushed baseline before local follow-up work: `main` synced with `origin/main` at `2747456 Add chat project assignment UI`.
- Do not assume old root-level HTML/JS/backend structure. The app is now a monorepo:
  - `apps/web`: Vue + TypeScript + Vite frontend.
  - `apps/api`: Express + TypeScript + Prisma backend.
- Remaining old remote branches may exist:
  - `origin/migration-cleanup-foundation`
  - `origin/refactor/ai-qa-assistant`
  Do not delete them unless the user explicitly asks.

## Before Any Work

Run:

```bash
git status --short --branch
git fetch origin
git pull --ff-only origin main
```

If starting implementation:

```bash
git switch -c feature/<short-name>
```

Rules:

- Inspect the current code before editing.
- Do not revert user changes unless explicitly asked.
- Keep edits scoped to the requested feature or fix.
- Do not commit generated noise, `dist`, `node_modules`, or unrelated watcher output.
- If a command fails because of sandbox/network permissions, request escalation instead of working around it.

## Local Development Commands

Use Vite and the TypeScript API. Do not use VS Code Live Server for this app.

Database:

```bash
npm run db:up
npm run db:migrate
```

Frontend:

```bash
npm run dev:web
```

API:

```bash
npm run dev:api
```

Root `npm run dev` currently starts the web app only through `npm run dev:web`.

Verification:

```bash
npm run verify
```

Targeted checks:

```bash
npm run test:api
npm run test:web
npm run check:api
npm run check:web
npm run build:web
npm run build:api
```

## Architecture Summary

- Frontend uses Vue components, composables, feature folders, and shared UI classes.
- Backend uses thin routes/controllers and service modules.
- Prisma/PostgreSQL stores users, sessions, chats, usage, settings, and foundations for projects/memory.
- Auth foundation exists with password auth, httpOnly cookies, sessions, guest mode, and chat adoption on login/register.
- `My Usage` is personal only. Do not expose global usage until admin roles exist.
- Settings page/API exists for language, theme, and default model.
- Project CRUD API exists for signed-in users with owner-only authorization.
- Project management UI exists for signed-in users.
- Project assignment and sidebar filtering exist for signed-in chats.
- Gemini provider adapter and model catalog live behind provider/model routing abstractions.
- Attachments support images and text/data files. Large file/PDF/provider Files API is future work.

## Current Product Status

Complete enough:

- Migrated chat workspace.
- Auth foundation.
- Guest mode and usage credit protection.
- Chat persistence and ownership checks, including optional project links.
- Personal usage page.
- Settings foundation.
- Projects API foundation.
- Projects management page.
- Project assignment controls for chats.
- Project switcher/sidebar filtering for chats.
- Gemini model strategy, routing, and fallback.
- Inline image/text/data attachments.
- Production/deployment docs are mostly in place.

Still unfinished:

- Google OAuth.
- Real forgot-password email delivery.
- Project member authorization.
- Memory UI/API and embeddings.
- Admin usage dashboard.
- Plans/entitlements and billing.
- PDF/video/large file support.
- README screenshots/GIFs.

## Likely Next Work

Pick one track before coding:

1. Product value: Projects
   - Member authorization tests.

2. Portfolio polish:
   - README screenshots/GIFs.
   - Demo pass.
   - Deployment smoke test.

3. AI quality:
   - Expand AI behavior evals.
   - Tune workflow routing.
   - Verify model routing/fallback under quota/provider errors.

4. SaaS direction:
   - Plans/entitlements before Stripe.
   - Admin role model before admin usage dashboards.

5. Long-term intelligence:
   - User/project memory with embeddings.
   - Retrieval, isolation tests, and manual memory controls.

## Styling And Frontend Rules

- Prefer Vue templates and Bootstrap utilities.
- Use shared UI classes like `.btn-control`, `.form-control`, `.form-label`, `.form-check`, `.ui-row`, and `.ui-icon-btn`.
- Keep styling in `apps/web/src/styles`.
- Use semantic tokens such as `--surface-*`, `--text-*`, `--border-*`, `--action-*`, and `--status-*`.
- Do not add raw hex colors in component SCSS unless updating tokens.
- Do not add new root-level CSS build steps.

## Suggested Prompt For A New Chat

```text
Read docs/AI_HANDOFF.md first, then docs/NEXT_STEPS.md only if needed.

Start by running git status --short --branch and checking the current repo shape.
Do not edit files until you understand the relevant code.
Answer in Arabic, but keep code/docs in English unless I ask otherwise.

Current goal:
<write the exact feature or bug here>

Constraints:
- Keep changes scoped.
- Preserve existing auth, chat persistence, usage credits, settings, attachments, import/export, dark/light theme, and tests.
- Do not delete old remote branches unless I explicitly ask.
```
