# AI Handoff

Use this file as the first context block for a fresh AI chat. It is intentionally short. For deeper roadmap details, read `docs/NEXT_STEPS.md`; for architecture details, read `docs/ARCHITECTURE.md`; for coding rules, read `docs/DEVELOPMENT_GUIDE.md`.

Last updated: 2026-06-07

## Current Repo State

- Workspace: `C:\Users\hatem\ai-qa-assistant`
- Current working branch: `feature/project-docs-foundation`.
- The current Project Knowledge work is still uncommitted. Do not discard or overwrite it.
- The branch started from an up-to-date `main`.
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
- Prisma/PostgreSQL stores users, sessions, chats, usage, settings, projects, and manual memory.
- Auth foundation exists with password auth, httpOnly cookies, sessions, guest mode, and chat adoption on login/register.
- `My Usage` is personal only. Do not expose global usage until admin roles exist.
- Settings page/API exists for language, theme, and default model.
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
- The project detail panel previews two instruction lines. Longer content opens the existing edit modal through Show more.
- Account Memory remains a separate list of user-provided notes. Normal chats use account memory; project chats add the owned Project Instructions and Project Documents layers. Guest chats do not load memory.
- Manual project documents and imported text/data/code files exist through `/api/projects/:projectId/documents`. The Project detail page supports Add text, file picker, and drag/drop. User-entered text is stored as Markdown-backed project content.
- The project detail panel shows at most four document slots. With five or more documents, the fourth slot becomes a `+N` control that opens the full project document library modal.
- The compact panel and full document library modal share the same `+` dropdown component for Upload files and Create Markdown. The whole library modal is a drag/drop import target.
- Clicking a document card opens a read-only preview. Markdown renders as sanitized HTML; code files use syntax highlighting and line numbers; text/data files use a source viewer. Imported HTML is source-only and is never executed.
- Each document card uses the shared dropdown styling for Download and Delete, plus Edit for user-created Markdown documents.
- Project chat context priority is: current chat, current attached file context, Project Instructions, Project Documents, then Account Memory.
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
- Centralized project access checks and stale-response-safe Project Knowledge state.
- Sidebar Projects navigation.
- Gemini model strategy, routing, and fallback.
- Inline image/text/data attachments.
- Production/deployment docs are mostly in place.

Still unfinished:

- Google OAuth.
- Real forgot-password email delivery.
- Project member authorization.
- Project document chunking, embeddings, AI extraction, chat summaries, and smart memory import/export.
- Admin usage dashboard.
- Plans/entitlements and billing.
- PDF/video/large file support.
- README screenshots/GIFs.

## Likely Next Work

Pick one track before coding:

1. Product value: Projects
   - Run a focused Projects demo/UX pass and keep only the workflow polish that still feels necessary.

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
   - Chunk imported project documents and add embedding-backed retrieval.
   - Add embeddings, AI-extracted Account Memory proposals, chat summaries, and smart knowledge import/export after retrieval isolation stays covered by tests.

## Styling And Frontend Rules

- Prefer Vue templates and Bootstrap utilities.
- Use shared UI classes like `.btn-primary`, `.btn-secondary`, `.btn-success`, `.btn-danger`, `.btn-control`, `.form-control`, `.form-label`, `.form-check`, `.ui-row`, and `.ui-icon-btn`.
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
