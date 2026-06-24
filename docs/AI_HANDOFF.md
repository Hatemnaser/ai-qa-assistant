# AI Handoff

Use this file as the first context block for a fresh AI chat. It is intentionally short. For deeper roadmap details, read `docs/NEXT_STEPS.md`; for architecture details, read `docs/ARCHITECTURE.md`; for coding rules, read `docs/DEVELOPMENT_GUIDE.md`. Memory Intelligence decisions and retained review requirements live in `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.

Last updated: 2026-06-23

## Core Documentation Map

- `AI_HANDOFF.md`: short current-state entry point for a new AI session.
- `ARCHITECTURE.md`: system-wide architecture and active module boundaries.
- `NEXT_STEPS.md`: completed work, active release tasks, and execution order.
- `MEMORY_INTELLIGENCE_ARCHITECTURE.md`: accepted Account/Project Memory,
  Conversation Summary, Recent Turns, and extraction decisions.
- `RAG_RETRIEVAL_EVALS.md`: Project Document retrieval quality contract and
  lexical/semantic evaluation results.
- `PRODUCTION_READINESS.md`: production deployment, data safety, migration,
  backup/restore, rollback, and smoke-test source of truth.

## Current Repo State

- Workspace: `C:\Users\hatem\ai-qa-assistant`
- Current working branch: `main`.
- Slice 2 chat identity/complete Recent Turns, Slice 3 Conversation Summary
  foundation, Slice 4 controlled Summary Generation, and Slice 5 manual
  Project Memory are committed on `main`. The former Project Memory AI
  suggestion/review flow was removed from the MVP.
- Migration `20260614000100_add_conversation_summary` was applied locally on
  2026-06-14. Migration `20260614000200_add_project_memory` was also applied
  locally. Prisma reports all nine migrations are up to date.
- The local PostgreSQL volume was found empty on 2026-06-14. The services and
  migrations were healthy, but there were zero users, projects, chats,
  messages, or sessions. Treat prior local data as unavailable unless it can
  still be recovered from browser-local chat storage or an external backup.
- Latest Project Import Preview verification on 2026-06-24: 378 API
  tests, 99 web tests,
  `npm run check:api`, and `npm run check:web` passed. The previous broader
  2026-06-17 gate also included `npm run db:validate`, `npm run build:api`,
  `npm run build:web`, and `git diff --check`.
- Start the API with `npm run dev:api` when needed; do not assume a server is
  already running.
- `main` matched `origin/main` before the current production-safety script work
  started.
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

Production/staging migrations:

```bash
npm run db:migrate:deploy
```

`npm run db:migrate` is local-development only. Do not use `migrate dev`,
`migrate reset`, or `db push` against staging or production.

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
- Prisma/PostgreSQL stores users, sessions, chats, usage, settings, projects, and manual memory.
- Auth foundation exists with password auth, httpOnly cookies, sessions, guest mode, and chat adoption on login/register.
- Auth is an owned foundation, not a final production security sign-off. Before
  real-user production, choose custom hardening or a maintained auth library
  migration. Do not mix that decision into unrelated feature work.
- `My Usage` is personal only. Do not expose global usage until admin roles exist.
- Settings page/API exists for language, theme, and default model. Language now
  drives the core web i18n foundation for `en`, `ar`, and `de`: the frontend
  applies `html lang/dir`, stores guest locale locally, uses account settings
  for signed-in users, and localizes the core auth/chat/settings/usage and
  Projects/Knowledge/Documents surfaces.
- Project CRUD API exists for signed-in users with owner-only authorization.
- Project management UI exists for signed-in users with a searchable/sortable card grid, project detail view, project chat list, project Add Chats modal, and app-modal create/edit/delete flow.
- The project detail composer reuses the main chat composer. Submitting from a project prepares a new chat linked to that project, then opens the normal chat workspace.
- After the first project exists, the sidebar shows a collapsible Projects section inside the scroll area above collapsible Recent Chats. The Projects section starts with New Project and All Projects rows, then the project folders. Project rows expand to show their linked chats; Recent Chats shows ordinary non-project chats. Before the first project, Projects stays as a top workspace nav item.
- Sidebar row hover and active states are intentionally separate. A project folder should look active only when the active chat belongs to that project and the folder is collapsed.
- Projects are workspace containers. Recent Chats is only a shortcut list, not a separate managed entity. If a full chat-history page is needed later, it should grow out of Search rather than mirroring the Projects page.
- Project assignment exists in the chat topbar for signed-in chats.
- Existing chats can be assigned or moved to projects through the chat context menu once at least one project exists.
- Existing chats can also be added or moved into a project from the project detail Add Chats modal with search and multi-select.
- Project-linked chats show a chat topbar breadcrumb instead of a visible "no project" selector.
- Sidebar project navigation opens the project management page; the sidebar does not filter chats by project.
- Manual account memory exists for signed-in users through `GET/POST/PUT/DELETE /api/memories` and the Settings page.
- Each project has one optional Project Instructions record through `GET/PUT /api/projects/:projectId/instructions`, with owner-only project checks. Saving empty content clears it.
- Each project has one optional manual Project Memory record through
  `GET/PUT /api/projects/:projectId/memory`. It is owner-scoped, bounded to
  6,000 characters, stored separately from documents and summaries, and cleared
  by saving empty content.
- The project knowledge panel includes simple manual Project Memory management:
  saved memory preview, one textarea editor, explicit Save memory, and Clear
  after confirmation. There is no active AI suggestion/review flow in the MVP.
- The project detail panel previews two instruction lines. Longer content opens the existing edit modal through Show more.
- Account Memory remains a separate list of user-provided notes. Normal chats use account memory; project chats add owned Project Instructions, Project Memory, and Project Documents as separate layers. Guest chats do not load memory.
- Manual project documents and imported text/data/code files exist through `/api/projects/:projectId/documents`. The Project detail page supports Add text, file picker, and drag/drop. User-entered text is stored as Markdown-backed project content.
- The project detail panel shows at most four document slots. With five or more documents, the fourth slot becomes a `+N` control that opens the full project document library modal.
- The compact panel and full document library modal share the same `+` dropdown component for Upload files and Create Markdown. The whole library modal is a drag/drop import target.
- Clicking a document card opens a read-only preview. Markdown renders as sanitized HTML; code files use syntax highlighting and line numbers; text/data files use a source viewer. Imported HTML is source-only and is never executed.
- Each document card uses the shared dropdown styling for Download and Delete, plus Edit for user-created Markdown documents.
- Project chat prompt serialization is: system behavior, Project Instructions, Account/Project Memory, Project Document chunks, conversation context, current attachments, then the current message.
- Project Documents are normalized and split into deterministic boundary-aware chunks. The latest user message ranks documents and chunks with a provider-independent lexical retriever.
- Retrieval takes up to six chunks across four documents within a bounded character budget. If no query term matches, it falls back to deterministic latest-document round-robin selection.
- Deterministic chunks are persisted in `ProjectDocumentChunk` with document/content hashes, a chunking version, indexing status, and provider-neutral embedding metadata. Create/import/update synchronizes the index; pending legacy documents are indexed when their project document library is loaded.
- A provider-independent embedding adapter now exists with Gemini as the first implementation. It uses `gemini-embedding-2`, asymmetric question-answering/document formatting, configurable dimensions, timeouts, stale-write guards, and model-aware re-indexing.
- Runtime embedding generation is disabled by default through `PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false`. Enabling it with a configured API key stores vectors for pending/current chunks without making document CRUD or lexical retrieval depend on provider availability.
- `ProjectDocumentRetriever` now supports hybrid semantic/lexical selection. It reads only current owned vectors with compatible hashes, chunking version, model, and dimensions, then combines normalized cosine similarity with lexical query-term coverage.
- The controlled Gemini retrieval eval passed on 2026-06-13: Hybrid Hit@1 was `6/6`, semantic-case Hit@1 was `5/5`, mean provider latency was `304.23 ms`, and P95 was `519.01 ms`. Exact lexical retrieval remained stable.
- Context preparation is two-phase: ownership checks and lexical context are prepared before usage reservation; query embeddings and semantic enhancement run only after credits are reserved.
- Hybrid retrieval remains disabled by default. Missing, stale, failed, oversized, or unavailable semantic candidate sets fall back to the deterministic lexical baseline.
- In-process semantic scoring is capped at 1,000 compatible chunks. Larger projects require a future database vector index instead of an unbounded application-memory scan.
- Project File Import v1 accepts up to four `txt`, `md`, `log`, `csv`, `json`, `html`, `css`, `js`, or `ts` files per import, with a 1MB limit per file. Imported files are stored as read-only `ProjectDocument` records with source metadata; replacement is delete and re-import.
- Rich Markdown rendering and syntax highlighting fall back to plain source for files above 200,000 characters to keep the preview responsive.
- Project-linked chat saves, Project Instructions, Project Documents, and project retrieval all use `projects/project-access.service.ts` as the owner-only authorization boundary. Add future member/role logic there instead of duplicating ownership checks.
- `ProjectsPage.vue` delegates Project Instructions/Documents async state to `useProjectKnowledge`, including stale-response protection when the active project changes.
- Project Knowledge component styling is isolated in `_project-knowledge.scss`; the generic workspace partial should not absorb feature-specific document/instruction rules.
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
- Projects management page with modal create/edit/delete flow, project detail view, project-scoped chat creation, and multi-select Add Chats workflow.
- Project assignment controls for chats.
- Context-menu project assignment/removal for existing chats.
- Manual Account Memory CRUD plus singleton Project Instructions with signed-in prompt retrieval and owner isolation.
- Project document CRUD, text/data/code file import, safe previews, Add text, drag/drop, and signed-in project prompt retrieval.
- Owner-scoped Project Portable ZIP export through
  `GET /api/portability/projects/:projectId/export`, with canonical
  `data/project.json`, document files, optional chats, readable Markdown, and
  no derived retrieval state.
- Authenticated zero-write Project Import Preview through
  `POST /api/portability/projects/import/preview`, with bounded ZIP/path/schema
  validation, per-file hashes, package digest, counts, warnings, and no
  project-data lookup or database writes beyond normal session authentication.
- Centralized project access checks and stale-response-safe Project Knowledge state.
- Sidebar Projects navigation.
- Gemini model strategy, routing, and fallback.
- Inline image/text/data attachments.
- Core web i18n foundation for English, Arabic RTL, and German across auth,
  chat shell, settings, account memory, usage, Projects, Project Knowledge,
  Project Documents, known frontend API error messages, localized quick-action
  prompts, and locale-aware dates. Translation copy uses domain-split JSON
  catalogs with typed locale loaders and a dedicated `npm run test:i18n` gate.
- The production runbook is documented and a production-safe
  `npm run db:migrate:deploy` command exists. Real-user deployment remains
  blocked on deployment provider selection, managed PostgreSQL, automated
  backups, a tested restore drill, staging smoke tests, host/proxy rate
  limiting, and the auth security checkpoint.

Still unfinished:

- Google OAuth.
- Real forgot-password email delivery.
- Auth security checkpoint: decide whether to keep and harden owned auth or
  migrate to Better Auth/Auth.js before real-user production.
- Project member authorization.
- Project Knowledge Retrieval v2: implementation and controlled real-provider evaluation are complete. Embeddings remain disabled by default and are ready for controlled opt-in use.
- The Memory Intelligence architecture checkpoint, typed context contract,
  owner-scoped chat identity/complete Recent Turns, Conversation Summary
  persistence and controlled generation, and manual Project Memory singleton
  are complete. Project Portable ZIP Export and Import Preview backends are
  complete; Project Import Commit, Account Memory portability, and AI-assisted
  memory suggestions remain unfinished.
- Admin usage dashboard.
- Plans/entitlements and billing.
- PDF/video/large file support.
- Continue i18n audits as future admin, billing, and upload surfaces are added.
- README screenshots/GIFs.

## Likely Next Work

Pick one track before coding:

1. Product value: Projects
   - Run a focused Projects demo/UX pass and keep only the workflow polish that still feels necessary.

2. Portfolio polish:
   - README screenshots/GIFs.
   - Demo pass.
   - Deployment smoke test.

3. Production safety:
   - Follow `docs/PRODUCTION_READINESS.md`.
   - Keep provider selection deferred while product features are still moving,
     but preserve the target shape: static web, long-running Node API, managed
     PostgreSQL.
   - Provision managed PostgreSQL with backups and test a restore.
   - Run staging and production smoke/rollback rehearsals.
   - Complete the auth security checkpoint before real-user launch.

4. AI quality:
   - Expand AI behavior evals.
   - Tune workflow routing.
   - Verify model routing/fallback under quota/provider errors.

5. SaaS direction:
   - Plans/entitlements before Stripe.
   - Admin role model before admin usage dashboards.

6. Long-term intelligence:
   - Project Knowledge Retrieval v2 is complete and verified. Keep shared-environment embeddings opt-in until quota and operational policy are selected.
   - Follow the accepted decisions in `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.
   - The typed context contract foundation is complete with explicit behavior, durable-memory, evidence, conversation, and current-message boundaries.
   - Signed-in chat identity now uses an owner-scoped lookup and the latest four
     persisted complete turns; guests and unpersisted chats retain bounded
     client history.
   - Conversation Summary now uses a dedicated owner-scoped chat singleton and
     is injected before Recent Turns when present.
   - Controlled Summary Generation runs after successful authenticated chat
     persistence through a best-effort use-case boundary, owner-scoped message
     reload, separate usage telemetry, and transactional cursor comparison.
   - Project Memory now uses a dedicated owner-scoped singleton, manual GET/PUT
     API, 6,000-character limit, and `durableMemory.project` context slot.
   - Project Portable ZIP Export and zero-write Import Preview are complete.
     Follow `docs/SMART_EXPORT_IMPORT_ARCHITECTURE.md` for create-new Project
     Import Commit next.
   - Project Memory is manual-only in the MVP. Keep AI-assisted suggestions
     deferred without adding direct automatic canonical writes.
   - Do not store Project Memory or Conversation Summary in generic `Memory` rows.

## Styling And Frontend Rules

- Prefer Vue templates and Bootstrap utilities.
- Use shared UI classes like `.btn-primary`, `.btn-secondary`, `.btn-success`, `.btn-danger`, `.btn-control`, `.form-control`, `.form-label`, `.form-check`, `.ui-row`, and `.ui-icon-btn`.
- Keep styling in `apps/web/src/styles`.
- Use semantic tokens such as `--surface-*`, `--text-*`, `--border-*`, `--action-*`, and `--status-*`.
- Do not add raw hex colors in component SCSS unless updating tokens.
- Do not add new root-level CSS build steps.
- Add user-facing frontend copy through the matching
  `apps/web/src/i18n/messages/<locale>/<domain>.json` file and `useI18n()`
  instead of introducing new hardcoded English strings. Locale `index.ts`
  files are loaders only. English is the key schema source; every supported
  locale must satisfy the same key map and interpolation placeholders. Run
  `npm run test:i18n` after catalog changes. Preserve stable internal values
  such as chat mode ids, model ids, and stored user content.

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
