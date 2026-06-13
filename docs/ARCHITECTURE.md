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
- `projects`: signed-in project CRUD, owner-only authorization, and owner membership foundation records.
- `memory`: signed-in manual Account Memory CRUD. V1 stores user-provided account notes and injects compact records into signed-in chat prompts.
- `project-instructions`: one optional instructions record per owned project. It is edited as one document and applied to every chat in that project.
- `project-documents`: signed-in manual project document CRUD and text/data/code file import with owner-only project checks. It persists deterministic chunk indexes and ranks project context through a replaceable retrieval contract.
- `usage`: portfolio/demo credit limits, credit reservations before AI provider calls, completed token usage updates, and personal usage summaries.

## Active Frontend Routes

- `#/`: chat workspace. Project-linked chats show a breadcrumb in the topbar; ordinary chats do not show a project state. Before the first project exists, the sidebar keeps `Projects` in the top workspace navigation. After projects exist, the sidebar shows a collapsible Projects section inside the scroll area above collapsible Recent Chats. The Projects section starts with New Project and All Projects rows before the project folders. Project chats are nested under their project instead of being mixed into Recent Chats.
- `#/login`: sign-in page wired to cookie-backed auth.
- `#/register`: account creation page wired to cookie-backed auth.
- `#/forgot-password`: password reset request page.
- `#/usage`: personal `My Usage` page for the current guest or signed-in user.
- `#/settings`: signed-in user preferences for language, theme, and default model.
- `#/projects`: signed-in project management page with a searchable/sortable project grid, project detail view, project chat list, project Add Chats modal, project-scoped composer, and modal create/edit/delete flows.

The frontend auth pages call the API with `credentials: "include"` so sessions stay in the httpOnly cookie. Google OAuth and real reset emails are still future integrations.

## Later Backend Work

- `projects`: member authorization.
- `memory`: manual Account Memory today. Future reviewed Account Memory proposals must follow the accepted Memory Intelligence architecture.
- `project-memory`: future project-scoped singleton for distilled facts and decisions.
- `conversation-summary`: future chat-scoped derived continuity with an idempotent update lifecycle.
- `project-documents`: semantic chunk selection and scalable vector search. Account Memory, Project Instructions, and Project Documents must remain separate retrieval layers.
- `projects/project-access.service.ts`: the current owner-only authorization boundary for project-linked chats, instructions, documents, and retrieval. Future member/role rules must evolve here instead of being duplicated across feature repositories.

## Active API Routes

- `GET /api/health`: health check.
- `POST /api/auth/register`: create a password user and set a session cookie.
- `POST /api/auth/login`: validate credentials and set a session cookie.
- `POST /api/auth/forgot-password`: accept reset requests with a generic response.
- `GET /api/auth/me`: read the current user from the session cookie.
- `POST /api/auth/logout`: delete the current session when present and clear the cookie.
- `GET /api/ai/models`: expose the active provider/model catalog for the frontend model selector.
- `POST /api/chat`: generate a QA assistant reply. Signed-in requests may include `projectId` so the backend can retrieve owned Project Instructions, durable memory, and Project Document evidence.
- `GET /api/chats`: list saved signed-in user chats, including optional `projectId`.
- `PUT /api/chats/:chatId`: save a signed-in user chat and validate any `projectId` belongs to that user.
- `DELETE /api/chats/:chatId`: delete a signed-in user chat.
- `GET /api/settings`: return the signed-in user's preferences.
- `PUT /api/settings`: update language, theme, and default model for the signed-in user.
- `GET /api/memories`: list the signed-in user's manual account memory notes.
- `POST /api/memories`: create a manual account memory note.
- `PUT /api/memories/:memoryId`: update a manual account memory note owned by the signed-in user.
- `DELETE /api/memories/:memoryId`: delete a manual account memory note owned by the signed-in user.
- `GET /api/projects`: list projects owned by the signed-in user.
- `POST /api/projects`: create a signed-in user's project.
- `PUT /api/projects/:projectId`: update a project owned by the signed-in user.
- `DELETE /api/projects/:projectId`: delete a project owned by the signed-in user.
- `GET /api/projects/:projectId/instructions`: return the optional instructions record for an owned project.
- `PUT /api/projects/:projectId/instructions`: create, update, or clear the instructions record for an owned project.
- `GET /api/projects/:projectId/documents`: list manual and imported documents for an owned project.
- `POST /api/projects/:projectId/documents`: create a manual document for an owned project.
- `POST /api/projects/:projectId/documents/import`: import up to four supported text/data files into an owned project.
- `PUT /api/projects/:projectId/documents/:documentId`: update a manual document for an owned project.
- `DELETE /api/projects/:projectId/documents/:documentId`: delete a manual or imported document for an owned project.
- `GET /api/usage/summary`: return current identity usage only. Guests see their guest/IP-hash scoped usage; signed-in users see their own `userId` scoped usage.

`POST /api/chat` allows anonymous portfolio usage. Guests receive an httpOnly `qa_guest_id` cookie and are limited separately from signed-in users. The API also hashes the request IP as a fallback abuse guard. Usage credits are reserved before calling Gemini so the API key is protected from unbounded demo traffic. Successful chat responses update the reserved usage with provider token metadata when available and include a public `usage` summary with `used`, `remaining`, and `limit`.

Signed-in chat persistence can store an optional `projectId`. The chat history service validates that linked projects are owned by the current user before saving, so a user cannot attach a chat to another user's project. Existing chats can be assigned or moved to projects through the chat context menu once the account has at least one project. Project-linked chats show a topbar breadcrumb with the project and chat title; ordinary chats do not show a project state. The Projects page lists owned projects with search/sort controls and app-modal create/edit/delete flows. Opening a project shows its project chat list, a search/multi-select Add Chats modal for moving existing chats into the project, and the main chat composer; submitting there prepares a new chat linked to that project and opens the normal chat workspace. If a signed-in user opens Projects with no projects yet, the create-project modal opens and the page also shows a no-projects empty state. The sidebar moves project navigation into a collapsible scroll-area section once projects exist, above a collapsible Recent Chats section. The Projects section includes New Project and All Projects rows before the project folders; project rows expand to show chats linked to that project. Recent Chats shows chats without a project and remains a shortcut list, not a separate managed entity. Deleting a project leaves existing chats with `projectId` set to null through the database relation and the frontend clears stale local project assignments after project reloads.

Projects are workspace containers. They own one optional Project Instructions record, manual Project Documents, and imported text/data/code files. Imported files are stored as read-only `ProjectDocument` records with `source: IMPORTED`, MIME type, original name, and size metadata. V1 accepts `txt`, `md`, `log`, `csv`, `json`, `html`, `css`, `js`, and `ts`, up to four files per import and 1MB per file. User-entered document text is stored as Markdown-backed `ProjectDocument` content. Recent Chats should not grow into a parallel management surface. If full chat browsing is needed later, the Search entry should become a Search/Chat History experience with filters for all chats, project chats, and non-project chats.

The frontend project-document registry maps extensions to MIME types, preview modes, labels, and syntax-highlight languages. Document cards open a read-only preview: Markdown is rendered through the existing sanitized Markdown pipeline, source files use a line-numbered viewer, and supported code files use `highlight.js`. Imported HTML is always displayed as escaped source and is never mounted in an iframe or executed. Files above 200,000 characters fall back to plain source rendering so the viewer remains responsive. Download, delete, and manual-Markdown edit actions stay in the card dropdown.

`ProjectsPage.vue` owns project navigation and CRUD orchestration. Project Instructions and Project Documents loading/mutations live in `useProjectKnowledge`, which guards active-project changes so stale async responses cannot overwrite the newly selected project. Project Knowledge styles live in their own SCSS partial rather than the generic workspace partial.

Signed-in Account Memory is stored in `Memory` with `scope: USER`, `source: USER_PROVIDED`, and the current `userId`. Project Instructions are stored separately in the one-to-one `ProjectInstruction` model keyed by `projectId`. The migration combines any existing project-scoped memory notes into that singleton record, then removes the old project-scoped rows. Manual Project Documents are stored in `ProjectDocument` with `source: USER_PROVIDED`; imported text/data files use `source: IMPORTED` plus file metadata after the shared project access check. Imported records are read-only and must be deleted and re-imported to replace their source content.

Server-side stored context retrieval runs only for signed-in users. Prompt serialization follows the typed context contract: system behavior, Project Instructions, Account/Project Memory, Project Document chunks, conversation context, current attachments, then the current message. Empty or inapplicable sections are omitted. Structured Project Instructions and Project Document content preserve meaningful line breaks so Markdown, CSV, JSON, and rule lists are not flattened.

Project Document chunks are deterministic and stored in PostgreSQL. The chunker normalizes line endings, prefers paragraph/line/word boundaries, applies light overlap, and produces stable document/chunk metadata. `ProjectDocument` stores the source hash, chunking version, and index lifecycle. `ProjectDocumentChunk` stores chunk hashes plus provider-neutral embedding fields and per-chunk embedding status.

Create, import, and update operations synchronize the deterministic chunk index. Index persistence verifies the source document update timestamp, so a late index cannot replace chunks for a newer edit or start stale embedding work. Existing documents created before the chunk-index migration start as pending and are indexed when their project document library is loaded. Failed index writes do not make the source document unusable; the original document remains authoritative.

Embedding generation is isolated under `ai/embeddings`. `EmbeddingProviderAdapter` exposes model, dimensions, and one embed operation for document/query purposes. Gemini is the first adapter and defaults to `gemini-embedding-2` with 768 dimensions. It formats document and query text for asymmetric question-answering retrieval. Project Document embedding writes include the current chunk hash, model, and dimensions so stale async results cannot overwrite a newer index.

Embedding generation is disabled by default. When enabled, new/re-indexed chunks are embedded after deterministic persistence, and existing pending chunks are processed when the project document library is loaded. Provider failures mark only the affected chunk embedding; document CRUD and lexical retrieval remain available. A failed chunk is retried automatically only after the embedding model or dimensions change. Explicit retry/background processing remains later work.

`ProjectDocumentRetriever` owns candidate ranking and budgeted selection. Its lexical baseline derives current chunks from source documents, tokenizes the latest user message, scores document titles/content, then scores chunks from the best matching documents. It can retrieve an older relevant document ahead of newer unrelated documents. Retrieval uses up to six chunks from four documents within a 7,200-character budget. When no query term matches, it falls back to latest-document round-robin selection so project context does not disappear.

The hybrid implementation reads only chunks from the already-authorized project and document set with `READY` embeddings that match the configured model and dimensions. It recomputes the current document/chunk hashes before accepting a vector and calculates cosine similarity in the API process. Fusion combines query-term coverage with cosine similarity normalized above a `0.60` floor calibrated by the controlled `gemini-embedding-2` evaluation. Strong exact lexical evidence remains authoritative when a matching chunk has no vector, while generic question terms are ignored and weak lexical coverage cannot overpower a strong semantic result.

Memory/context preparation has two phases. Before usage reservation, the backend verifies project access and prepares deterministic lexical context for the credit estimate. Only after credits are reserved may the resolver read semantic candidates and call the embedding provider for the latest query. Usage rejection therefore cannot trigger query embedding work.

Semantic scoring is capped at 1,000 compatible chunks per request. Empty, stale, invalid, oversized, disabled, or failed semantic candidate sets return the lexical result. This in-process approach is appropriate for the current project scale; larger collections should replace candidate scanning with PostgreSQL vector search while preserving the `ProjectDocumentRetriever` contract.

Hybrid retrieval and document embedding generation use the same feature flag and remain disabled by default. The controlled real-provider evaluation passed on 2026-06-13 and supports opt-in enablement; the shared default remains an explicit quota and operational decision. Authorization, prompt ordering, budget enforcement, and lexical fallback remain stable. The acceptance contract and measurements are documented in `docs/RAG_RETRIEVAL_EVALS.md`. Guest chats do not load memory.

### Memory Intelligence Boundary

The accepted design is documented in
`docs/MEMORY_INTELLIGENCE_ARCHITECTURE.md`.

Account Memory remains a list of user-owned notes. Project Memory will be a
dedicated project singleton for distilled facts and decisions. Conversation
Summary will be a dedicated chat singleton for derived continuity. Recent Turns
will be derived from persisted messages and will not get their own table.
Project Instructions remain behavior, and Project Documents remain retrieved
evidence.

Do not store Project Memory or Conversation Summary in generic `Memory` rows.
Do not mix Account Memory, Project Memory, and Project Document vectors in one
index. AI extraction must create reviewable proposals instead of silently
writing canonical memory. Do not introduce a broad Memory Orchestrator until
the independent lifecycles require real coordination.

## AI Workflow Layer

The chat service talks to AI providers through the provider registry, not directly through a specific vendor SDK. Gemini is the active provider today. Future providers should implement the shared provider adapter contract and register their model catalog without changing chat orchestration, usage limits, auth, or workflow analysis.

Model catalogs must declare capabilities such as text prompts, image attachments, and text/data file attachments. The chat service checks those capabilities before reserving usage or calling a provider, so adding a text-only or file-capable model later does not require rewriting chat orchestration.

The model router can select a configured general, visual, or fallback model based on workflow and attachment needs. Model fallback is allowed only for provider quota/unavailability style failures and must still respect the required model capabilities.

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

The behavior contract is covered by `docs/AI_BEHAVIOR_EVALS.md`, `apps/api/tests/ai-behavior.test.ts`, `apps/api/tests/qa-workflow.test.ts`, and `apps/api/tests/workflow-router.test.ts`.

The chat API accepts a generic `attachments` array with up to 4 files per message. The web composer supports file picker, drag/drop, and clipboard paste for attachments. The active provider boundary converts supported image attachments into the Gemini image payload and injects supported text/data file content into the provider prompt. Current inline support is intentionally capped to images under 4MB and text/data files under 1MB. PDF, video, and large-file workflows remain future integrations through a provider file API. This keeps the UI, API contract, and chat storage ready for later file types without changing the chat controller contract again.

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

ProjectDocument
  id
  projectId
  title
  content
  source
  mimeType
  metadata
  contentHash
  chunkingVersion
  indexStatus
  indexError
  indexedAt
  createdAt
  updatedAt

ProjectDocumentChunk
  id
  documentId
  chunkIndex
  chunkCount
  content
  contentHash
  embedding
  embeddingModel
  embeddingDimensions
  embeddingStatus
  embeddingError
  embeddedAt

ProjectInstruction
  projectId
  content
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
  status
  provider
  model
  mode
  workflowIntent
  workflowSource
  modelRoutingSource
  creditsReserved
  creditsUsed
  estimatedPromptTokens
  estimatedOutputTokens
  estimatedTotalTokens
  promptTokens
  outputTokens
  totalTokens
  attachmentCount
  imageCount
  fileCount
  createdAt
```

Billing and integrations will add their own tables only when those phases begin. The active schema should stay focused on users, sessions, settings, projects, chats, messages, Account Memory, Project Instructions, Project Documents, AI usage, and demo usage limits.

## Migration Plan

1. Create the new TypeScript API in `apps/api`.
2. Port the existing `/api/chat` behavior into modular API files.
3. Add Prisma and PostgreSQL.
4. Add the Vue app shell in `apps/web`.
5. Move the existing chat screen and local chat behavior into the new web app.
6. Delete legacy code only after parity testing. Done.
7. Continue with projects, i18n, and memory after the auth/settings foundation is stable.
8. Add billing and integrations after the core product data model is stable.

## Prisma Setup Notes

The API uses Prisma ORM 7. Prisma 7 generates the client into an explicit source folder instead of relying on hidden `node_modules` output.

```text
apps/api/prisma/schema.prisma
apps/api/prisma.config.ts
apps/api/src/generated/prisma/
```

The generated client is ignored by Git and recreated by `npm run db:generate`, `npm run check`, or `npm run build` inside `apps/api`.
