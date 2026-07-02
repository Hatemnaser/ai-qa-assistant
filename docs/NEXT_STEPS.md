# AI QA Assistant Next Steps

This file is the working roadmap for what is done, what is still foundation work, and what should come next. Use it as the reference when asking "what is next?" or "what still needs cleanup?"

Last reviewed: 2026-07-03

For a short fresh-chat context, start with `docs/AI_HANDOFF.md`.
Before future work on Project Memory, conversation summaries, AI-extracted memory,
or memory embeddings, follow `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.
For deployment, data safety, migrations, backups, rollback, and production
smoke tests, follow `docs/PRODUCTION_READINESS.md`.

## Current Health

- [x] Monorepo structure is in place: `apps/web` and `apps/api`.
- [x] Legacy vanilla app was migrated to Vue + TypeScript.
- [x] Backend is modular Express + TypeScript + Prisma.
- [x] PostgreSQL schema is established for users, sessions, chats, projects, memory, usage events, and settings.
- [x] Latest Account Memory portability backend verification on 2026-07-03
  passed:
  - 411 API tests passing.
  - 111 web tests passing.
  - API and web TypeScript checks and production builds passing.
- [x] Latest pushed baseline was clean before the current project assignment work.

## What Is Complete Enough For The Current Foundation

- [x] Chat workspace with sidebar, composer, messages, export/import, copy, and delete flow.
- [x] Password auth foundation: register, login, logout, current session.
- [x] Optional guest mode for portfolio/demo use.
- [x] Guest and user credit limits before AI calls.
- [x] Credit tracking with token-based completion updates when provider usage metadata is available.
- [x] `My Usage` page for the current identity only.
- [x] Project CRUD API foundation with owner-only authorization.
- [x] Modal-based project list/create/edit/delete UI for signed-in users.
- [x] Searchable/sortable project card grid.
- [x] Project detail view with project chat list.
- [x] Project detail composer starts a new chat linked to the current project.
- [x] Project detail Add Chats modal with search, multi-select, and immediate assignment/move.
- [x] Project portability UI with ZIP export, Include chats option, local-file
  Import Preview, confirmed create-new Commit, warnings, project/chat refresh,
  and navigation.
- [x] Collapsible sidebar Projects section after the first project exists.
- [x] Sidebar Projects section has an All Projects row once projects exist.
- [x] Nested project chats inside the sidebar Projects section.
- [x] Collapsible sidebar Recent Chats section.
- [x] Project assignment UI for signed-in chats.
- [x] Existing chat assignment/move from the chat context menu after the first project exists.
- [x] Project-linked chat breadcrumb in the chat topbar.
- [x] Sidebar Projects navigation for opening the project management page.
- [x] Manual account memory API and UI for signed-in users.
- [x] Singleton Project Instructions API and UI with owner-only project checks.
- [x] Account Memory and Project Instructions are injected into signed-in chat prompts with scope isolation.
- [x] Manual project document API and UI with owner-only project checks.
- [x] Project Documents remain a distinct evidence layer in the prompt context contract.
- [x] Project Documents are split into deterministic boundary-aware chunks with bounded query-aware selection.
- [x] Project Document retrieval uses the latest user message for deterministic lexical ranking with a no-match fallback.
- [x] Project Document retrieval has a provider-independent `ProjectDocumentRetriever` contract and documented RAG eval cases.
- [x] Persist deterministic Project Document chunks with document hashes, chunking version, indexing lifecycle, and provider-neutral embedding fields.
- [x] Import text/data/code project files as read-only project documents with source metadata and owner-only checks.
- [x] Project Documents UI supports Add text, file picker, drag/drop, and safe read-only previews. User-entered text is stored as Markdown-backed content.
- [x] Chat persistence for signed-in users, including optional project links with ownership checks.
- [x] Guest chats can be adopted into the signed-in user scope during login/register.
- [x] Chat ownership checks prevent another user from updating/deleting a chat they do not own.
- [x] Gemini provider adapter and model catalog are behind a provider registry.
- [x] Model routing and fallback are implemented.
- [x] AI workflow routing exists for intent detection beyond fixed quick-action buttons.
- [x] Attachments support images plus text/data files:
  - Images: `png`, `jpg`, `jpeg`, `webp`
  - Text/data: `txt`, `md`, `log`, `csv`, `json`
- [x] Composer supports picker, multiple files, drag/drop, and paste.
- [x] Design tokens and SCSS organization exist.

## Not Complete Yet

- [ ] Google OAuth is not wired. The UI button is intentionally disabled.
- [ ] Forgot password only returns a safe generic response. It does not send reset emails yet.
- [x] Settings page/API is implemented for language, theme, and default model.
- [x] Project assignment controls are implemented for signed-in chat workspaces.
- [x] Project Knowledge v1 includes singleton Project Instructions, manual/imported Project Documents, and isolated prompt retrieval.
- [x] Project Instructions use a two-line project-panel preview; Show more opens the existing edit modal.
- [x] Project Documents use a four-slot panel preview with a full-library modal for five or more documents.
- [x] The compact panel and full Project Documents library share one add-menu component; the whole library modal accepts drag/drop imports.
- [x] Project document cards open a read-only preview and expose Download/Delete actions, plus Edit for user-created Markdown documents, through a three-dot dropdown.
- [x] Markdown previews are sanitized; code previews use syntax highlighting and line numbers; imported HTML is displayed as source and never executed.
- [x] Project Knowledge Retrieval v2 implementation and controlled real-provider evaluation are complete; shared environments remain opt-in.
- [ ] Memory Intelligence remains incomplete: controlled Conversation Summary
  and manual Project Memory are implemented. The Project Portable ZIP
  Export/Preview/Commit round trip, frontend workflow, and Account Memory
  portability backend are complete; AI-assisted memory suggestions remain
  future work.
- [ ] Admin usage dashboard does not exist. Current `My Usage` is personal only.
- [ ] Credits are configured through environment variables, not plans/entitlements from the database.
- [ ] Billing/subscriptions are not implemented.
- [ ] PDF/video/large file upload is not implemented.
- [ ] Provider Files API is not implemented.
- [ ] Full i18n cleanup is not complete. Core web i18n is implemented for
  `en`, `ar`, and `de` across auth, chat shell, settings, account memory,
  usage, Projects, Project Knowledge, Project Documents, known frontend API
  error mappings, localized quick-action prompts, locale-aware dates, and
  `html lang/dir`. Continue catalog audits as new admin, billing, upload, and
  future product surfaces are added.

## Active Release Plan

### Production Safety Gate

Goal: make deployment operationally safe before real users depend on stored
data. `docs/PRODUCTION_READINESS.md` is the source of truth.

- [x] Document the target web/API/managed-PostgreSQL deployment shape.
- [x] Document production environment, cookie, CORS, AI, and usage settings.
- [x] Document data-safety, backup, restore, rollback, and smoke-test procedures.
- [x] Add `db:migrate:deploy` using `prisma migrate deploy`.
- [x] Keep `prisma migrate dev`, `migrate reset`, and `db push` out of
  production release commands.
- [ ] Keep deployment provider selection deferred until the core releasable
  feature set is closer to done.
- [ ] Keep the app compatible with static web hosting, a long-running Node API,
  and managed PostgreSQL.
- [ ] Select and provision the production hosts and managed PostgreSQL plan.
- [ ] Enable automated database backups and record retention.
- [ ] Enable point-in-time recovery if supported by the selected plan.
- [ ] Complete a restore drill into an isolated temporary database.
- [ ] Provision a separate staging database and environment.
- [ ] Run the full staging deployment and smoke checklist.
- [ ] Add host/proxy-level public API rate limiting.
- [ ] Complete the auth security checkpoint before real-user launch.
- [ ] Decide and document whether the first release is a disposable portfolio
  demo or a real-user production release.
- [ ] For real-user production, define account recovery, privacy/data
  retention, account deletion, monitoring, and incident ownership.

### Project Knowledge Retrieval v2

Goal: finish semantic retrieval for Project Documents without widening the scope
into automatic memory or conversation summarization.

In scope:

- [x] Deterministic Project Document chunking and persisted chunk indexes.
- [x] Provider-independent embedding adapter and guarded embedding generation.
- [x] Lexical retrieval baseline, prompt budgets, isolation tests, and retrieval eval contract.
- [x] Add query embeddings behind the existing provider adapter.
- [x] Add hybrid semantic/lexical ranking behind `ProjectDocumentRetriever`.
- [x] Read only current vectors with compatible source hash, model, and dimensions.
- [x] Preserve lexical retrieval when embeddings are disabled, missing, stale, or unavailable.
- [x] Compare hybrid behavior against the automated contract in `docs/RAG_RETRIEVAL_EVALS.md`.
- [x] Run the full verification, build, migration, and local smoke-test gates.

Release gates:

- [x] `npm run verify`, `npm run build:api`, and `npm run build:web` pass.
- [x] The local database is migrated and Prisma reports no pending migrations.
- [x] Authorization tests prove that retrieval cannot cross user or project boundaries.
- [x] Retrieval budgets remain bounded and lexical fallback remains deterministic.
- [x] Provider failure does not block document CRUD or project chat.
- [x] Embeddings remain disabled by default until quality, latency, and cost are reviewed.
- [x] Handoff, architecture, eval, and production-readiness docs match the implemented behavior.
- [x] Controlled real-provider quality, latency, and cost evaluation supports controlled opt-in enablement.

Still deferred from automatic intelligence scope:

- AI-extracted Account Memory or Project Memory proposals.
- Background memory update jobs or a broad Memory Orchestrator.
- Memory embeddings and combined document/memory vector indexes.
- Account Memory portability frontend UI.

Project Memory and Conversation Summary now exist as separate scoped layers:
manual Project Memory is user-edited only, and Conversation Summary generation
is chat-scoped, bounded, and not Project Memory.

### Auth Security Checkpoint

Goal: decide whether the current owned auth module is sufficient after
hardening, or whether to migrate to a maintained auth library before real-user
production.

Current state:

- [x] Password register/login/logout with server-side sessions.
- [x] httpOnly cookie-backed sessions with configurable secure/sameSite/domain
  settings.
- [x] Opaque session tokens are hashed before database storage.
- [x] Passwords are hashed with Node crypto `scrypt`.
- [x] Forgot-password endpoint returns a generic response.

Required before real-user launch:

- [ ] Decide custom hardening vs Better Auth/Auth.js migration.
- [ ] Add auth route rate limiting for login, register, and forgot password.
- [ ] Implement real password reset tokens and email delivery.
- [ ] Invalidate existing sessions after password reset.
- [ ] Review password policy against OWASP/NIST-style guidance.
- [ ] Review CSRF risk for cookie-authenticated state-changing routes.
- [ ] Verify production cookie settings over HTTPS.
- [ ] Consider email verification before enabling real user accounts broadly.

Library direction:

- Prefer no immediate auth migration while product features are still moving.
- Re-evaluate Better Auth first if the app needs email/password plus OAuth,
  organization roles, MFA/passkeys, or managed account/session flows.
- Re-evaluate Auth.js if OAuth/social login becomes the main driver.
- Do not mix auth migration with unrelated project, memory, or retrieval work.

## Immediate Cleanup Tasks

These should happen before large new product features.

- [x] Update `docs/ARCHITECTURE.md`
  - Add `#/usage`.
  - Add `GET /api/usage/summary`.
  - Mention credit-based usage, model routing, fallback, and attachment behavior.
- [x] Update `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
  - Add provider abstraction requirements.
  - Add personal usage privacy rules.
  - Add credit/entitlement direction.
- [x] Keep this file updated after each meaningful feature or refactor.
- [x] Centralize owner-only project access for chat assignment, instructions, documents, and retrieval.
- [x] Extract Project Knowledge async state from `ProjectsPage.vue` into a stale-response-safe composable.
- [x] Split Project Knowledge SCSS from the generic workspace partial.
- [x] Split `apps/api/src/modules/usage/usage.service.ts` responsibilities:
  - `usage.service.ts` for reserve/complete/fail.
  - `usage-insights.ts` for `My Usage` summaries.
  - `usage.scope.ts` for identity scope/window helpers.
- [x] Split `apps/web/src/features/chat/composables/useChatController.ts` responsibilities:
  - [x] `useChatSubmit`
  - [x] `useChatAttachments`
  - [x] `useChatExportImport`
- [x] Review error UX copy and backend error codes.
  - Added shared frontend backend-error parsing.
  - Added clearer local setup guidance for database/provider/upload failures.
  - Added Prisma `P1001` handling for unavailable PostgreSQL.
- [x] Add deployment cookie configuration.
  - Added configurable `COOKIE_SAME_SITE`, `COOKIE_SECURE`, and `COOKIE_DOMAIN`.
  - Documented same-site versus split web/API deployment behavior.
- [x] Consider unifying attachment policy between web and API.
  - Current runtime duplication is intentionally small and covered by policy tests.
  - Web text-file limits now match the API inline text limit.
  - Longer-term, expose backend capabilities or move shared constants into a package.

## Product Roadmap Checklist

### Phase 1: Foundation Hardening

- [x] Clean migration from legacy app.
- [x] Auth foundation.
- [x] Chat persistence and ownership.
- [x] Usage credits and guest protection.
- [x] Personal usage view.
- [x] AI workflow routing foundation.
- [x] Update docs after latest features.
- [x] Review error UX copy and backend error codes.
- [x] Confirm production env checklist.
- [x] Decide first deploy target.

### Phase 2: Settings

- [x] Build settings route/page.
- [x] Add API for user settings.
- [x] Persist theme preference server-side for signed-in users.
- [x] Persist preferred language.
- [x] Apply preferred language to the core web UI.
- [x] Apply Arabic RTL through document `dir`.
- [x] Store translation copy in domain-split JSON catalogs with typed loaders,
  duplicate-key protection, and a dedicated i18n validation command.
- [x] Keep registration locale and saved settings language aligned with the
  shared supported-locale list.
- [x] Persist default model.
- [x] Add tests for settings service and API.

### Phase 3: Projects

- [x] Build project list and management page.
- [x] Add modal-based project create/edit/delete flow.
- [x] Add searchable/sortable project card grid.
- [x] Localize Projects list/detail, create/edit/delete, Add Chats, and project
  menu copy through the shared i18n catalog.
- [x] Add project detail view with empty/filled chat states.
- [x] Reuse the main chat composer to start new chats inside a project.
- [x] Build sidebar navigation to the project management page.
- [x] Add All Projects row to the collapsible sidebar Projects section.
- [x] Add project CRUD API.
- [x] Add chat-to-project persistence contract and ownership guard.
- [x] Add project assignment UI for chats.
- [x] Add existing-chat project assignment/removal from the chat context menu.
- [x] Replace project delete browser confirm with an app modal.
- [x] Add owner-only project authorization.
- [x] Add project detail Add Chats modal with search, multi-select, and immediate assignment.
- [ ] Add popup-based project/chat workflow polish when the UX direction is settled.
- [ ] Add project member authorization only when collaboration/members become an active product requirement.
- [x] Add tests for project ownership.

### Phase 4: Project Knowledge And Memory

- [x] Add user memory service/API.
- [x] Replace multi-note project memory with one Project Instructions record per project.
- [x] Keep Account Memory, Project Instructions, and Project Documents as separate retrieval layers.
- [x] Localize Project Instructions, Project Memory, Project Documents, document
  import validation, previews, and library modals through the shared i18n
  catalog.
- [x] Decide what memory is manually saved versus AI-extracted.
  - Canonical Project Memory remains manual `USER_PROVIDED` content.
  - AI-assisted replacement proposals are deferred from the MVP and must remain
    reviewed, bounded, and non-automatic if reintroduced later.
- [x] Add memory controls in UI.
- [x] Add tests for memory isolation by user/project.
- [x] Preserve separate prompt layers for Project Instructions, Account Memory, Project Document chunks, conversation context, current attachments, and the current message.
- [x] Add manual project documents to the project retrieval layer.
- [x] Add imported `txt`, `md`, `log`, `csv`, `json`, `html`, `css`, `js`, and `ts` files to the project retrieval layer.
- [x] Split imported project documents into retrieval chunks.
  - The deterministic chunker was introduced before persistence and now feeds the persisted chunk index.
  - Retrieval is capped at six chunks from the four highest-ranked documents within a fixed prompt budget.
  - Query-aware ranking can retrieve an older relevant document ahead of newer unrelated documents.
  - No-match retrieval remains round-robin so project context does not disappear.
- [x] Define retrieval evaluation cases before embeddings.
  - The contract is documented in `docs/RAG_RETRIEVAL_EVALS.md`.
  - Automated coverage includes relevance, multilingual terms, fallback, limits, ownership, and prompt ordering.
- [x] Add embedding persistence foundation.
  - Deterministic chunks are stored in `ProjectDocumentChunk`.
  - Document hashes and `boundary-v1` identify the indexed source version.
  - Index and per-chunk embedding statuses support retries and model changes.
  - Existing pending documents are lazily chunk-indexed when their project library is loaded.
  - The lexical retriever remains active and provider-independent.
  - Migration `20260611000100_add_project_document_chunk_index` was applied locally on 2026-06-12.
- [x] Add embedding provider and generation lifecycle.
  - Vendor calls live behind `EmbeddingProviderAdapter`.
  - Gemini uses `gemini-embedding-2` with 768 dimensions by default.
  - Query/document formatting follows the asymmetric question-answering retrieval contract.
  - Runtime generation is feature-flagged off by default.
  - Stale chunk hashes cannot receive late embedding results.
  - Model/dimension changes make existing vectors eligible for regeneration.
  - Failed chunks remain available to lexical retrieval and are not retried repeatedly with the same configuration.
- [x] Add semantic/hybrid retrieval.
  - Embed the latest user query through the provider adapter.
  - Query embeddings run only after usage credits are reserved.
  - Read only owned/current persisted chunks with matching source hash, chunk hash, model, dimensions, and chunking version.
  - Blend normalized cosine similarity and lexical query-term coverage.
  - Keep lexical matches slightly stronger when an otherwise relevant chunk has no vector.
  - Cap in-process semantic scoring at 1,000 compatible candidates; larger sets fall back to lexical retrieval until a database vector index is introduced.
  - Keep lexical retrieval as the failure/no-index fallback.
- [x] Run controlled real-provider retrieval evaluation before shared-environment enablement.
  - Compare representative semantic-only, exact-match, multilingual, stale-vector, and provider-failure queries.
  - Record latency and embedding cost before setting `PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=true`.
  - Result on 2026-06-13: Hybrid Hit@1 `6/6`, semantic-case Hit@1 `5/5`, mean provider latency `304.23 ms`, P95 `519.01 ms`, and 12 provider calls for 1,002 input characters.
  - The provider response did not expose billable token metadata, so calls and input characters are the recorded cost proxy.
  - The shared default remains off; the result approves controlled opt-in use.
- [x] Complete a Memory Intelligence architecture checkpoint after the retrieval release.
  - Accepted decisions are documented in `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.
  - The context contract separates behavior, durable memory, retrieved evidence, conversation summary, recent turns, and the current message.
  - The checkpoint selected four complete turns instead of an arbitrary message
    count; that policy is now implemented.
  - Dedicated Conversation Summary and Project Memory models are now active.
  - Account Memory, Project Memory, and Project Document vectors remain
    separate retrieval concerns.
- [x] Add the typed context contract foundation without changing current prompt behavior.
  - Separate behavior, durable memory, evidence, conversation continuity, and the current message in API types.
  - Preserve the current Project Document two-phase retrieval and usage-reservation boundary.
  - Add prompt ordering, omission, and budget regression tests.
  - Completed on 2026-06-14 with the existing guest, usage, and retrieval behavior preserved.
- [x] Add signed-in chat identity and complete Recent Turns retrieval.
  - Add optional `chatId` to signed-in `/api/chat` requests.
  - Resolve persisted chats through one owner-scoped `chatId + userId` lookup.
  - Treat missing and foreign ids identically as new conversations without
    server-side context or chat-existence disclosure.
  - Use the latest four persisted complete, non-error turns as the authoritative
    signed-in context.
  - Keep bounded client-provided history for guests and chats not yet persisted.
  - Completed on 2026-06-14 without changing credits, provider fallback, or
    Project Document retrieval behavior.
- [x] Add the Conversation Summary persistence/context foundation.
  - Use a dedicated `ConversationSummary` model rather than `MemoryScope.CHAT`.
  - Keep one optional owner-scoped record per persisted chat.
  - Store `throughMessageId` as cursor data and inject only non-empty summaries.
  - Preserve Recent Turns, guest behavior, Project Document retrieval, and
    provider routing.
  - Completed on 2026-06-14 with no provider generation or background work.
- [x] Add controlled Conversation Summary generation.
  - Run best-effort generation only after a successful authenticated chat save
    has sent its response.
  - Re-read complete persisted turns through owner-scoped access and keep the
    latest four complete turns outside the summary.
  - Start after six complete turns; refresh after three additional eligible
    turns or 6,000 unsummarized characters.
  - Use in-process deduplication plus transactional cursor comparison to drop
    concurrent or stale results.
  - Record provider work under a separate zero-credit
    `conversation_summary` usage action.
  - Preserve chat responses when generation, telemetry, or summary persistence
    fails.
  - Completed on 2026-06-14 without a durable queue, Project Memory writes, or
    changes to chat routing, fallback, guest behavior, or document retrieval.
- [x] Add manual Project Memory with explicit provenance and scope isolation.
  - Use a dedicated `ProjectMemory` singleton keyed by `projectId` rather than
    `MemoryScope.PROJECT`.
  - Reuse the shared owner-only project access boundary for reads and writes.
  - Support owner-scoped GET/PUT with empty-content clear semantics.
  - Bound content to 6,000 characters and retain the documented optional
    Stack/Decisions/Constraints/Risks/Conventions/Open Questions template.
  - Inject only non-empty owned Project Memory through
    `durableMemory.project`, before Project Documents.
  - Completed on 2026-06-14 with migration
    `20260614000200_add_project_memory` applied locally.
- [x] Add the Project Memory frontend manual edit workflow.
  - Load, edit, save, and explicitly clear the singleton from the existing
    project knowledge panel.
  - Keep the UI close to Project Instructions: one textarea, character count,
    explicit Save memory, and Clear after confirmation.
  - Completed on 2026-06-17 without suggestion UI, backend route changes,
    automatic writes, chat changes, summary changes, or retrieval changes.
- [ ] Evaluate AI-assisted Project Memory suggestions later if the manual flow
  proves valuable enough to justify provider cost, abuse protection, and review
  UX. Do not add automatic canonical writes.
- [x] Add owner-scoped Project Portable ZIP Export with versioned canonical
  JSON, readable Markdown, Project Documents, optional chats, attachment
  metadata warnings, and no derived retrieval state.
- [x] Add Project Import Preview with ZIP/path/digest validation and no
  project-data reads or database writes beyond normal session authentication.
- [x] Add Project Import Commit as create-new only, then re-index imported
  documents after the canonical transaction succeeds.
- [x] Add the Project portability frontend flow for ZIP export, local Preview,
  same-file Commit, warnings, project/chat refresh, and opening the imported
  project.
- [x] Add Account Memory versioned JSON export, zero-write Preview, and
  digest-confirmed create-new-record Commit with fixed limits, imported
  provenance, and trim-only exact-duplicate skipping.
- [ ] Add Account Memory portability frontend UI.

### Phase 5: Credits, Plans, And Admin

- [ ] Move credit limits from env-only config toward plan/entitlement records.
- [ ] Add user plan field or entitlement table.
- [ ] Add admin role/permission model before exposing global usage.
- [ ] Build admin usage dashboard only after roles exist.
- [ ] Add per-model usage analytics for admins.
- [ ] Prepare billing module structure, but do not add Stripe until product limits are stable.

### Phase 6: Attachments V2

- [x] Inline images and text/data files.
- [ ] Add provider file upload path for large files.
- [ ] Add PDF support.
- [ ] Add video support only when the provider path is clear.
- [ ] Add file persistence if users should reopen old attachments.
- [ ] Keep exports from embedding large base64 content unless explicitly requested.

### Phase 7: Deployment And Portfolio Readiness

- [x] Expand the production deployment guide into the deployment source of
  truth.
- [x] Add `.env` production checklist.
- [x] Add rate limit/proxy notes.
- [x] Add demo-safe defaults.
- [x] Add short architecture section to README.
- [x] Document first deployment target shape.
- [x] Add production-safe Prisma migration scripts.
- [ ] Provision managed PostgreSQL with automated backups.
- [ ] Complete and record a database restore drill.
- [ ] Deploy staging and complete the smoke/rollback checklist.
- [ ] Add host/proxy rate limiting and production monitoring.
- [ ] Add screenshots/GIFs to README.

## Gemini / Google AI Studio Model Strategy

This section is based on the model screenshots shared in the chat. Availability and quotas can change, so verify in Google AI Studio before production decisions.

### Current Practical Models

- `Gemini 3.1 Flash Lite`
  - Best current default for high-volume text QA.
  - Screenshot showed higher daily room than some older models.
  - Good for general QA, routing-compatible answers, checklist/test-case generation, and cost-conscious usage.

- `Gemini 2.5 Flash Lite`
  - Good fallback for fast text tasks.
  - Useful when the main default model is unavailable or near quota.
  - Keep as a fallback/general text option.

- `Gemini 2.5 Flash`
  - Better for deeper reasoning and visual review.
  - More expensive in our credit policy because it should be treated as a stronger model.
  - Good for image/visual QA review, harder QA analysis, and more complex outputs.

### Possible Later Models / Capabilities

- TTS models
  - Useful only if the app adds spoken summaries, voice QA coaching, or accessibility/audio output.
  - Not needed for current chat foundation.

- Imagen / image generation models
  - Not needed for QA assistant core.
  - Could be useful later for generating mock screenshots, test data visuals, or design examples, but that is a separate product direction.

- Embedding models
  - Important later for memory and semantic search.
  - Best use cases:
    - user memory retrieval
    - project document retrieval
    - similar bug/test-case search
    - requirement chunk retrieval
  - Do not add until deterministic Project Document chunking and retrieval evaluation are defined.

- Search grounding / tool-capable models
  - Useful later if QA answers need current external documentation.
  - Should be treated carefully because it changes privacy, cost, and reliability assumptions.

- Live/audio models
  - Future feature only.
  - Could support real-time QA coaching, but not needed for the current product foundation.

### Model Routing Policy Direction

- General text QA:
  - Prefer `Gemini 3.1 Flash Lite`.
- Fast fallback:
  - Use `Gemini 2.5 Flash Lite`.
- Visual/image QA:
  - Prefer `Gemini 2.5 Flash` if quota allows.
- Workflow router:
  - Use a cheap/fast model with low output and low temperature.
  - It should classify intent only, not answer the user.
- Future memory retrieval:
  - Use embeddings instead of asking the chat model to remember everything.

### Credit Policy Direction

- Keep credits model-agnostic enough to support multiple providers later.
- Count by estimated prompt/output/attachment cost before calling the provider.
- Update with actual token metadata after provider response.
- Charge extra for:
  - image attachments
  - text/data file attachments
  - workflow router calls
  - stronger models
- Keep user-facing credits simple.
- Keep admin-facing usage more detailed later.

## Architectural Rules To Keep

- Do not expose global usage data until admin roles/permissions exist.
- Do not let selected UI mode override the latest user message.
- Do not let older attachment context force future replies into visual/file review.
- Do not store base64 image content in chat history exports or database metadata unless file persistence is explicitly added.
- Do not add large SCSS blocks for each new page if a shared UI component or Bootstrap utility can handle it.
- Do not add new providers directly inside chat service. Add providers through the adapter/registry pattern.
- Do not add billing before plan/credit rules are stable.
- Do not add projects/memory UI or retrieval behavior without authorization/isolation tests.
- Do not add new user-facing frontend copy as hardcoded English. Add a key to
  the matching domain catalog in
  `apps/web/src/i18n/messages/<locale>/<domain>.json` and use `useI18n()` at the
  component boundary. Keep locale `index.ts` files limited to loading catalogs.
  Keep English as the key schema source and preserve `npm run test:i18n`
  coverage for every supported locale.
- Treat Projects as workspace containers and Recent Chats as a shortcut list. If full chat browsing is needed, build it as Search/Chat History rather than a Recent Chats page.
- Prompt serialization follows the typed context contract. Future embedding changes must replace only Project Document chunk selection and stay inside the evidence layer.

## Next-Step Decision Guide

When asking "what is next?", choose the first unfinished item that matches the current goal:

1. If the goal is foundation quality:
   - Keep verification, migrations, and docs clean before each commit/push.
   - Before any live deployment, complete the Production Safety Gate in
     `docs/PRODUCTION_READINESS.md`.
2. If the goal is user product value:
   - Continue Projects only with focused demo/UX polish; do not add collaboration authorization until members become real product scope.
3. If the goal is portfolio/demo polish:
   - Add README screenshots/GIFs and run a portfolio demo pass.
4. If the goal is SaaS direction:
   - Build plans/entitlements before Stripe.
5. If the goal is AI quality:
   - Expand AI behavior evals and tune workflow routing.
6. If the goal is long-term intelligence:
   - Project Knowledge Retrieval v2 is complete and validated against the lexical baseline and controlled real-provider fixtures.
   - The Memory Intelligence architecture checkpoint is complete in `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.
   - The typed context contract foundation is complete.
   - Signed-in chat identity and complete Recent Turns are complete.
   - Conversation Summary persistence and prompt injection are complete.
   - Controlled Conversation Summary generation is complete.
   - The bounded manual Project Memory singleton and context injection are
     complete.
   - Project Memory frontend manual edit/save/clear is complete.
   - The Project Portable ZIP Export, zero-write Import Preview, create-new
     transactional Import Commit, and Projects UI workflow are complete.
   - Account Memory portability backend is complete with JSON Export,
     zero-write Preview, and digest-confirmed Commit.
   - Implement the Account Memory portability frontend workflow next.
   - Keep AI-assisted Account or Project Memory suggestions deferred until
     review UX, provider cost, abuse protection, and provenance policy are
     explicitly designed.
