# AI Handoff

Use this file as the first context block for a fresh AI chat. It is intentionally short. For deeper roadmap details, read `docs/NEXT_STEPS.md`; for architecture details, read `docs/ARCHITECTURE.md`; for QA lifecycle and integration contracts, read `docs/QA_CONTROL_PLANE.md`; for the RecipeV1/local Runner boundary, read `docs/QA_EXECUTION_HARNESS.md`; for coding rules, read `docs/DEVELOPMENT_GUIDE.md`. Memory Intelligence decisions and retained review requirements live in `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.

Last updated: 2026-09-11

## Core Documentation Map

- `AI_HANDOFF.md`: short current-state entry point for a new AI session.
- `ARCHITECTURE.md`: system-wide architecture and active module boundaries.
- `QA_CONTROL_PLANE.md`: QA Request lifecycle, owner/agent capabilities,
  evidence, REST/MCP, scopes, concurrency, idempotency, and current gaps.
- `QA_EXECUTION_HARNESS.md`: immutable RecipeV1, exact owner approval, local
  Runner protocol, production double confirmation, and execution limits.
- `NEXT_STEPS.md`: completed work, active release tasks, and execution order.
- `MEMORY_INTELLIGENCE_ARCHITECTURE.md`: accepted Account/Project Memory,
  Conversation Summary, Recent Turns, and extraction decisions.
- `RAG_RETRIEVAL_EVALS.md`: Project Document retrieval quality contract and
  lexical/semantic evaluation results.
- `PRODUCTION_READINESS.md`: production deployment, data safety, migration,
  backup/restore, rollback, and smoke-test source of truth.

## Current Repo State

- The 2026-09-11 pre-commit review fixes are saved: generic owner/REST/MCP
  mutations cannot bypass the Runner lease; claim/reclaim/acceptance bind to
  the immutable approved profile; Recipe identity includes the profile hash;
  and Workspace late responses cannot override newer navigation/account
  context. Follow-up review also fixed initial loading when projects already
  exist and the A -> pending B -> A selection race. A new additive migration,
  `20260911000100_bind_recipe_identity_to_profile`, changes only the Recipe
  unique index; do not rewrite the earlier migrations or approved smoke.
- Post-interruption verification on Node 24.19.0 passed `npm run verify`
  (863 API, 271 web, 18 Runner, 4 shared-contract tests; 1156 total). The
  guarded PostgreSQL suite passed 23/23, including real profile-change
  claim/accept/reclaim failure persistence, concurrent profile-bound
  deduplication, and owner/REST/MCP generic-mutation rejection without side
  effects. All 21 migrations deployed with zero drift on the newly created
  `oddpath_review_test_0911_01`; it was removed after its 44 application tables
  were confirmed empty. Normal application data and the approved smoke were
  untouched. API, Runner, and web production builds passed, as did Git
  connectivity and whitespace checks. The web build used the placeholder
  origin described below. The exact Node runtime was temporary (npm cache),
  not a global upgrade or dependency change. No authenticated browser visual
  rerun or live provider call was made during this review.
- Security dependency remediation is saved (2026-09-11): Nodemailer 9.1.1,
  fast-uri 3.1.7, qs 6.16.0, and a `prisma@7.9.1`-scoped mysql2 3.23.1
  override. Both production and full dependency audits return zero advisories;
  the earlier restricted audit's no-fix result was superseded by complete
  registry metadata and verified upstream patches. Six bounded offline
  dependency regressions passed, and `npm ci --dry-run --ignore-scripts`
  validated the lockfile. No Prisma major change or audit bypass was used;
  rationale and upstream references are in `PRODUCTION_READINESS.md`.
- Final post-security verification also passed on Node 24.19.0: full `verify`
  (including the six added dependency regressions), API/Runner/web production
  builds, and guarded PostgreSQL 23/23. All 21 migrations applied with zero
  drift in `oddpath_security_test_0911_02`; after testing its 44 application
  tables had zero rows and that disposable database was removed. Both audits
  were rerun and again reported zero advisories. No live provider/browser run,
  application-database mutation, or credential change was performed.
- Push destination still needs confirmation because
  `main` is configured for Render checks-pass deployment and automatic
  migrations. Do not infer deployment approval from an interrupted turn.
- Local TEXT-evidence smoke is complete as of 2026-09-09, based on the user's
  screenshots/manual validation, not an independently rerun agent test.
  `Login page — browser smoke test` kept Revision 1, its review passed, the
  owner brought the Runner online and approved the exact execution, and real
  Playwright execution completed with four PASS results and one intentional
  FAIL for the absent `Oddpath smoke marker` heading. The TEXT evidence gate
  is COMPLETE and the owner approved the QA record: APPROVED 1, Running 0,
  Evidence needed 0, Ready 0. Record approval does not change the FAIL outcome
  or approve a product release. Retain this record and its earlier failures;
  do not retry review, regenerate, recreate credentials, or rerun it merely
  to close the phase or recover conversation context.
- Bounded closeout completed on 2026-09-10 after the conversation interruption:
  the modal explains local Runner startup/offline state and derives queue
  eligibility and its accessible explanation from the same approval gates.
  Current processing is separated from collapsible earlier attempts without
  hiding active work, discarding failure codes, or inferring cross-Recipe
  recovery. New copy is localized in English, Arabic, and German.
  `npm run verify` returned exit 0, including 261 web tests and the expanded
  Runner suite. The focused web/i18n set passed 46/46; three new fake-client
  Runner recovery cases passed (execution tests 6/6). `build:web` and
  `git diff --check` passed. No live provider call, normal-database mutation,
  migration, credential change, or repeat of the approved request was needed.
  At that checkpoint changes were local/uncommitted; unrelated work was preserved.
  Separate manual interruption/recovery and Request changes/re-run drills,
  real SCREENSHOT/private-upload proof, and staging/production gates remain
  outside the completed local TEXT smoke. See `QA_EXECUTION_HARNESS.md`.
- Latest repair on 2026-09-09: the user's `Retry review` reached Gemini but
  failed with `AI_PROVIDER_REQUEST_REJECTED`. Three explicitly authorized
  synthetic probes (256 output tokens maximum each, one request each) isolated
  native `suggestions.maxItems: 80`: the original schema returned HTTP 400;
  removing only that keyword succeeded and passed local assessment validation
  (35 reported input tokens, 18 output tokens). The provider schema now omits
  that keyword; local Zod max(80), required arrays, string bounds, status
  invariants, usage accounting, and execution gates are unchanged. Regression
  tests cover 80 accepted/81 rejected and one-call accounting for invalid output.
  The probes established schema compatibility only; the later user-validated
  live review and browser outcome are recorded separately above.
- Verification after that fix completed successfully: `npm run verify`
  returned exit 0 (824 API, 247 web, 4 shared-contract, 15 Runner tests;
  1090 total), and `build:api` and `git diff --check` passed. An initial run
  overlapped API build/Prisma generation and reported two file-level project
  test failures; their 11 tests passed independently and the complete verify
  rerun passed without source changes. Avoid overlapping Prisma generation
  with API tests. No further Gemini probe or real QA retry is needed merely
  to recover from a conversation interruption.
- The interrupted Recipe-generation and review repair is complete in the
  working tree (2026-09-08): full RecipeV1 prompt examples, classified output
  errors, sanitized worker diagnostics, native review JSON Schema with strict
  local validation, and owner-only `Retry review` on the existing immutable
  Recipe. Duplicate retry clicks share one operation; old failures remain;
  FAILED/PENDING reviews cannot authorize execution. Web retry handles stale
  selections, read failures, and synchronous duplicate clicks.
- Final verification on 2026-09-08: `npm run verify` passes (API 822 tests,
  web 247, shared contract 4, Runner 15); i18n 7/7; API/web/Runner production
  builds pass. The guarded PostgreSQL suite passes 16/16 with real retry
  concurrency, rollback, old-lease rejection, and failed/pending approval gates.
  All 20 migrations deployed with zero drift on `oddpath_review_test_0908`;
  this newly-created test database was removed after confirming its 44
  application tables had zero rows. The original application database was
  not migrated, reset, or modified by this repair.
- The web verification build uses `https://api.oddpath.invalid` as an
  ephemeral placeholder API origin, not deployment configuration. Earlier
  checks ran on installed Node 24.15.0; the 2026-09-11 review uses a temporary
  Node 24.19.0 runtime. Keep >=24.19.0 <25 for future release checks.
- Before the user's successful live retry, read-only inspection had found
  Revision 1, two failed assessments (invalid suggestions, then provider
  rejection), and zero Runs. That was a historical pre-smoke checkpoint,
  superseded by the user-validated APPROVED state above. The synthetic probes
  did not requeue or mutate the real request.
- Workspace: `C:\Users\hatem\ai-qa-assistant`
- Current working branch: `main`.
- The QA phase adds the Oddpath QA Control Plane and execution harness. Use
  `git status`/`git log` for current commit and push state. Preserve all existing
  user-owned preview/design files; these exploratory assets are excluded from
  the reviewed implementation commit.
- `#/` is the QA Workspace product home and `#/chat` is the explicit QA Chat
  route. The primary objects are QA Requests, immutable artifacts, status,
  runs/results, evidence, history, and Human Review.
- Project-scoped bearer connections expose one shared agent domain through REST
  and stateless Remote Streamable HTTP MCP. Codex, Claude, and other compatible
  clients are transports, not hardcoded workflow owners.
- Slice 2 chat identity/complete Recent Turns, Slice 3 Conversation Summary
  foundation, Slice 4 controlled Summary Generation, and Slice 5 manual
  Project Memory are committed on `main`. The former Project Memory AI
  suggestion/review flow was removed from the MVP.
- The repository contains 21 ordered Prisma migrations. `prisma validate`
  passes; GitHub CI applies the complete migration set to a fresh PostgreSQL 16
  database before verification. Do not infer that an unstarted local Docker
  database has received the latest migrations.
- The local PostgreSQL volume was found empty on 2026-06-14. The services and
  migrations were healthy, but there were zero users, projects, chats,
  messages, or sessions. Treat prior local data as unavailable unless it can
  still be recovered from browser-local chat storage or an external backup.
- Earlier baseline verification was recorded on 2026-08-31: the architecture gate
  covered 267 source files and 134 test files; the API suite passed 769/769
  tests in 140 suites; the web suite passed 226/226 tests in 56 suites; the
  shared Recipe/Runner contract passed 4/4 tests; the local Runner passed 15/15
  tests; and the guarded PostgreSQL suite passed 16/16 against the disposable
  `oddpath_harness_test_0830` database. API, Runner, and web production builds
  passed, Prisma validation passed, all 20 migrations deployed cleanly from an
  empty disposable database with no schema drift, and `git diff --check`
  passed. The web build used a safe placeholder HTTPS `VITE_API_BASE_URL`, as
  required by its fail-closed build configuration.
- `check:api` now includes a TypeScript-AST architecture gate for repository
  contracts and runtime cycles. A fail-closed deployment smoke harness provides
  GET-only and explicitly confirmed authenticated project-lifecycle modes.
- The guarded real-PostgreSQL suite verifies migration parity, PostgreSQL 16+,
  ownership/rollback behavior, concurrent usage/project/chat/document/asset
  quotas, binary-import finalization/rollback, exact cleanup lease fencing, and
  the QA lifecycle/current-run guards across concurrent instances. It passed
  locally on 2026-08-31 against the explicitly named disposable database; CI
  continues to run it against `oddpath_ci` after migrations.
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
- Prisma/PostgreSQL stores users, sessions, projects, QA Requests and their
  immutable lifecycle records, project connections/idempotency, chats, usage,
  settings, and manual memory.
- `qa-requests` owns one lifecycle used by cookie-authenticated owner routes,
  bearer REST, and stateless MCP. Agents can plan/execute/attach evidence;
  artifact selection and Human Review are owner-only.
- QA context snapshots reuse `ProjectDocumentRetriever`, so future RAG quality
  improvements strengthen chat and QA without a duplicate retrieval path.
- QA text generation/review resolves through `AiProviderAdapter`, obeys
  `AI_ENABLED`, and reserves/reconciles shared owner/global usage. Gemini is the
  only registered runtime provider today.
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
- Project File Import v1 accepts up to four `txt`, `md`, `log`, `csv`, `json`, `html`, `css`, `js`, or `ts` files per import, with a 250KB limit per file. Imported files are stored as read-only `ProjectDocument` records with source metadata; replacement is delete and re-import.
- Rich Markdown rendering and syntax highlighting fall back to plain source for files above 200,000 characters to keep the preview responsive.
- Project-linked chat saves, Project Instructions, Project Documents, and project retrieval all use `projects/project-access.service.ts` as the owner-only authorization boundary. Add future member/role logic there instead of duplicating ownership checks.
- `ProjectsPage.vue` delegates Project Instructions/Documents async state to `useProjectKnowledge`, including stale-response protection when the active project changes.
- Project Knowledge component styling is isolated in `_project-knowledge.scss`; the generic workspace partial should not absorb feature-specific document/instruction rules.
- Gemini provider adapter and model catalog live behind provider/model routing abstractions.
- Attachments support images and text/data files. Large file/PDF/provider Files API is future work.

## Current Product Status

Complete enough:

- QA Workspace as the product home, with QA Chat on an explicit route.
- Owner QA Request lifecycle: generated/agent checklist revisions, selection,
  versioned runs/results, evidence gates, history, and Human Review.
- Project-scoped REST and 12 MCP tools for external agents, with hashed
  bearer tokens, scopes, expiry/revocation, pre-body IP/token rate limits, and
  required, conservatively fenced external-mutation idempotency.
- Asynchronous checklist/Recipe generation and review plus the local
  `apps/runner` Playwright harness. Owner approval binds the current request
  version, immutable Recipe hash, and Runner profile-manifest hash; production
  also requires web confirmation and `--allow-production` locally.
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
  `POST /api/portability/projects/:projectId/export`, with CSRF, canonical
  `data/project.json`, document files, optional chats, readable Markdown, and
  no derived retrieval state. Legacy v1 packages remain supported; exports
  with stored private files use bounded v2 descriptors/entries and exact
  message/document bindings.
- Authenticated zero-write Project Import Preview through
  `POST /api/portability/projects/import/preview`, with bounded ZIP/path/schema
  validation, per-file hashes, package digest, counts, warnings, and no
  project-data lookup or database writes beyond normal session authentication.
- Create-new Project Import Commit through
  `POST /api/portability/projects/import/commit`, using
  `X-Package-Digest`, full package revalidation, new IDs, transactional
  canonical writes, imported Project Memory/Document provenance, and
  post-transaction best-effort document indexing.
- Project portability is usable from the Projects UI: project actions expose
  ZIP export with an Include chats option, and the Projects page exposes a
  local-file Preview/Commit modal that displays counts and warnings, commits
  the same previewed file, refreshes project and account-chat state, and opens
  the imported project.
- Account Data portability is the Settings product. Owner-scoped
  `POST /api/portability/account/export` requires CSRF and downloads canonical profile/settings,
  Account Memory, projects, documents, chats/messages, readable Markdown, and
  provider-neutral migration references as `account-data-export.zip`.
  Legacy v1 packages remain importable. Exports containing stored private
  files use bounded v2 descriptors and ZIP entries; Preview validates their
  bytes/bindings, and Commit uses staged assets plus durable cleanup jobs and
  atomic canonical finalization. Web Preview/Commit surfaces optional binary
  counts for Account and Project packages. Restore rows now carry a persisted
  session/attempt/token fence revalidated around every object write and inside
  finalization. Cleanup renewal/failure/completion uses an exact database lease
  CAS and exposes lease conflicts to scheduler monitoring.
- Unified Account Import exposes zero-write Preview and digest-confirmed
  create-new Commit under `/api/portability/account/import/...`. It
  automatically detects native Account Data ZIPs and supported external
  conversation archives. The lazy Settings modal keeps the file local, has no
  provider dropdown, displays all portable-record counts and localized
  warnings, then
  refreshes Account Memory, projects, and chats after transactional Commit.
  Production import routes default off through
  `PORTABILITY_IMPORTS_ENABLED=false`; when deliberately enabled they enforce
  bounded ZIP/semantic limits, shared persisted-data quotas, advisory locks,
  per-user/IP rates, and process-local concurrency caps before extraction.
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
  `npm run db:migrate:deploy` command exists. Cloudflare Pages/R2, Render,
  Brevo, and paid Gemini are the selected provider shape. Real-user deployment
  remains blocked on provisioning managed PostgreSQL, automated backups, a
  tested restore drill, staging smoke tests, host/proxy rate limiting, and the
  remaining operational/legal gates. Keep `PRIVATE_ASSETS_ENABLED=false` in
  production until the real PostgreSQL suite and EU R2 interruption matrix are
  recorded, process-kill/freeze recovery is proven against the real services,
  production-scale timeout/latency behavior is measured, and scheduled cleanup
  is validated across multiple API instances. The fail-closed, sanitized R2
  mutation runner and its local contract tests are implemented; actual bucket
  credentials/CORS and provider execution remain operator work.
- Phase 1's repository foundation is complete: `render.yaml`, a pinned Node
  version, clean-checkout CI, production environment fail-fast checks,
  liveness/readiness separation, security headers, graceful shutdown, exact
  web API-origin validation, and reset/verification URL-token cleanup.

Still unfinished:

- QA records/evidence are not portable in Project or Account ZIPs, ambiguous
  idempotency receipts have no automatic reconciliation, and the local Runner
  has not passed the real staging/production operational gates.
- Google OAuth.
- Live SMTP/domain-deliverability and HTTPS cookie/CSRF smoke testing remain;
  reset and verification delivery are implemented behind the email adapter.
- The owned-auth checkpoint is implemented for the initial beta. Revisit a
  maintained auth library when OAuth, MFA/passkeys, or organizations enter
  scope.
- Project member authorization.
- Project Knowledge Retrieval v2: implementation and controlled real-provider evaluation are complete. Embeddings remain disabled by default and are ready for controlled opt-in use.
- The Memory Intelligence architecture checkpoint, typed context contract,
  owner-scoped chat identity/complete Recent Turns, Conversation Summary
  persistence and controlled generation, and manual Project Memory singleton
  are complete. The Project Portable ZIP Export/Preview/Commit round trip and
  frontend workflow plus unified Account Export/Import are complete; additional
  archive adapters and AI-assisted memory suggestions remain unfinished.
- Admin usage dashboard.
- Plans/entitlements and billing.
- PDF/video/large file support.
- Continue i18n audits as future admin, billing, and upload surfaces are added.
- README screenshots/GIFs.

## Likely Next Work

Pick one track before coding:

1. Product value: QA pilot
   - The owner-approved local Playwright/TEXT smoke and bounded setup/status
     clarity polish are complete. Do not reopen the approved QA record.
   - Run a first-user onboarding test: can someone understand within 20 seconds
     why Oddpath adds value beyond asking an agent to “test checkout”?
   - A separate external-agent pilot against another small real feature is
     future validation; the local Runner smoke does not prove every client,
     recovery path, or private-upload integration.

2. Portfolio polish:
   - README screenshots/GIFs.
   - Demo pass.
   - Deployment smoke test.

3. Production safety:
   - Follow `docs/PRODUCTION_READINESS.md`.
   - Provision the selected Cloudflare/Render/Brevo/Gemini shape from
     `docs/DEPLOYMENT_CLOUDFLARE_RENDER.md` without committing secrets.
   - Provision managed PostgreSQL with backups and test a restore.
   - Run staging and production smoke/rollback rehearsals.
   - Smoke-test the hardened auth flow over the real HTTPS domains before
     opening invite-only registration.

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
   - The Project Portable ZIP Export, zero-write Import Preview, create-new
     transactional Import Commit, and Projects UI workflow are complete.
   - Full Account Data ZIP export and the Settings workflow are complete.
   - Unified Account Import Preview/Commit is complete for native account ZIPs
     and supported external conversation archives. Keep additional adapters
     blocked on stable fixtures and versioned schemas.
   - Account Memory remains included in complete Account Data export and
     editable through the normal Settings CRUD panel.
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
