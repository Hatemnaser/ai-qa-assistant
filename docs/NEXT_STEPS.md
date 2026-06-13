# AI QA Assistant Next Steps

This file is the working roadmap for what is done, what is still foundation work, and what should come next. Use it as the reference when asking "what is next?" or "what still needs cleanup?"

Last reviewed: 2026-06-13

For a short fresh-chat context, start with `docs/AI_HANDOFF.md`.
Before future work on Project Memory, conversation summaries, AI-extracted memory,
or memory embeddings, follow `docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.

## Current Health

- [x] Monorepo structure is in place: `apps/web` and `apps/api`.
- [x] Legacy vanilla app was migrated to Vue + TypeScript.
- [x] Backend is modular Express + TypeScript + Prisma.
- [x] PostgreSQL schema is established for users, sessions, chats, projects, memory, usage events, and settings.
- [x] `npm run verify` passes:
  - 205 API tests passing.
  - 81 web tests passing.
  - API and web TypeScript checks passing.
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
- [ ] Memory Intelligence remains a later release: Project Memory, conversation summaries, reviewed AI extraction, and smart import/export.
- [ ] Admin usage dashboard does not exist. Current `My Usage` is personal only.
- [ ] Credits are configured through environment variables, not plans/entitlements from the database.
- [ ] Billing/subscriptions are not implemented.
- [ ] PDF/video/large file upload is not implemented.
- [ ] Provider Files API is not implemented.
- [ ] Full i18n is not implemented. Current multilingual behavior is AI/workflow oriented only.

## Active Release Plan

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

Explicitly deferred from this release:

- Project Memory.
- Conversation rolling summaries.
- AI-extracted Account Memory or Project Memory proposals.
- Background memory update jobs or a broad Memory Orchestrator.
- Memory embeddings and combined document/memory vector indexes.
- Smart memory import/export.

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
- [x] Persist default model.
- [x] Add tests for settings service and API.

### Phase 3: Projects

- [x] Build project list and management page.
- [x] Add modal-based project create/edit/delete flow.
- [x] Add searchable/sortable project card grid.
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
- [x] Decide what memory is manually saved versus AI-extracted.
  - V1 is manual `USER_PROVIDED` memory only. AI-extracted memory stays future work.
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
  - Recent context will use four complete turns instead of an arbitrary message count.
  - Conversation Summary will use a dedicated chat-scoped model and lifecycle.
  - Project Memory will use a dedicated project-scoped singleton and isolation boundary.
  - Account Memory, Project Memory, and Project Document vectors will not share one retrieval index.
- [x] Add the typed context contract foundation without changing current prompt behavior.
  - Separate behavior, durable memory, evidence, conversation continuity, and the current message in API types.
  - Preserve the current Project Document two-phase retrieval and usage-reservation boundary.
  - Add prompt ordering, omission, and budget regression tests.
  - Completed on 2026-06-14 with the existing guest, usage, and retrieval behavior preserved.
- [ ] Add signed-in chat identity and complete Recent Turns retrieval.
  - Add optional `chatId` to signed-in `/api/chat` requests.
  - Validate existing chat ownership while allowing a new client-generated chat id on its first message.
  - Unknown ids receive no server-side chat context until persistence succeeds.
  - Make persisted messages authoritative for signed-in recent turns.
  - Keep bounded client-provided history for guests.
- [ ] Add conversation rolling summaries after the architecture checkpoint.
  - Use a dedicated `ConversationSummary` model rather than `MemoryScope.CHAT`.
  - Add an idempotent status/cursor lifecycle before provider generation.
  - Do not trigger provider calls directly from debounced chat autosave.
- [ ] Add Project Memory with explicit provenance, update/stale rules, and user controls.
  - Use a dedicated project singleton rather than `MemoryScope.PROJECT`.
- [ ] Add AI-extracted memory proposals with explicit user review; never auto-save assistant guesses as facts.
- [ ] Add smart memory import/export after memory scope and provenance rules are stable.

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

- [x] Add production deployment guide.
- [x] Add `.env` production checklist.
- [x] Add rate limit/proxy notes.
- [x] Add demo-safe defaults.
- [x] Add short architecture section to README.
- [x] Document first deployment target shape.
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
- Treat Projects as workspace containers and Recent Chats as a shortcut list. If full chat browsing is needed, build it as Search/Chat History rather than a Recent Chats page.
- Prompt serialization follows the typed context contract. Future embedding changes must replace only Project Document chunk selection and stay inside the evidence layer.

## Next-Step Decision Guide

When asking "what is next?", choose the first unfinished item that matches the current goal:

1. If the goal is foundation quality:
   - Finish reviewing the current uncommitted Project Knowledge work, apply its database migrations locally, then commit/push only when requested.
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
   - Implement signed-in chat identity and complete Recent Turns before Conversation Summary or Project Memory persistence.
