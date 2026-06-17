# Memory Intelligence Architecture

> Status: Accepted architecture checkpoint.
>
> Accepted: 2026-06-13.
>
> This document is the source of truth for the current manual Project Memory,
> Conversation Summary, future reviewed AI extraction, and memory retrieval
> design.
> It consolidates the accepted decisions and the durable requirements from the
> original review brief.

## Decision Summary

Keep the current architecture and evolve it through a light-to-medium refactor.
Do not rewrite chat, Project Knowledge, or the existing Account Memory feature.

The system will keep these concepts separate:

| Context source | Scope | Cardinality | Ownership | Role |
| --- | --- | --- | --- | --- |
| Account Memory | User | Many notes | `userId` | Stable user preferences and facts |
| Project Instructions | Project | One record | `projectId` | Assistant behavior inside a project |
| Project Memory | Project | One record | `projectId` | Distilled project facts and decisions |
| Project Documents | Project | Many documents/chunks | `projectId` | Retrieved source evidence |
| Conversation Summary | Chat | One record | `chatId` | Derived continuity for one conversation |
| Recent Turns | Chat | Derived, not stored separately | `chatId` | Immediate conversational continuity |
| Current Attachments | Request | Transient | Current request | User-provided evidence |
| Current Message | Request | One | Current request | Current explicit request; strongest over stored context |

Project Memory and Conversation Summary must not reuse the generic `Memory`
rows. They have different ownership, cardinality, update rules, and provenance.

## Baseline Architecture Review

This section records the pre-Slice 1 baseline. The delivery plan below records
which gaps were resolved.

### What Already Matched

- Account Memory is owner-scoped and manually controlled.
- Project Instructions are a dedicated singleton and are not mixed with facts.
- Project Documents are a dedicated evidence layer with isolated retrieval.
- Project access checks are centralized.
- Project Document retrieval is bounded, evaluated, and provider-independent.
- Query embeddings run only after usage reservation.
- Prompt context construction is centralized in `ai/prompt-context.ts`.
- Guest chats do not load server-side account or project memory.

### Baseline Gaps

- `MemoryScope.PROJECT`, `MemoryScope.CHAT`, and `MemorySource.CHAT_SUMMARY`
  exist in the schema, but active repositories use only user-scoped memory.
- The database does not enforce legal scope/foreign-key combinations for
  generic `Memory` rows.
- `/api/chat` does not receive a `chatId`, so the backend cannot safely load a
  chat-owned summary.
- Signed-in chat generation and chat persistence are separate requests.
- Chat autosave currently replaces all persisted messages in one transaction.
- Recent context is the last eight messages, not complete user/assistant turns.
- Frontend and backend both apply history slicing.
- The current `AiMemoryContext` type mixes behavior, evidence, and durable
  memory instead of expressing their different authority.
- There is no idempotent summary update cursor, retry state, or usage accounting.

These were incremental design gaps, not reasons for a broad rewrite.

## Context Contract

Prompt assembly accepts one typed context envelope:

```ts
interface AiContextEnvelope {
  behavior: {
    projectInstructions?: string;
  };
  durableMemory: {
    account: ContextItem[];
    project?: ContextItem;
  };
  evidence: {
    attachments: TextAttachmentContext[];
    projectDocuments: ProjectDocumentChunkContext[];
  };
  conversation: {
    summary?: ConversationSummaryContext;
    recentTurns: ConversationTurn[];
  };
  currentMessage: string;
}
```

The names are illustrative. The implementation may reuse existing types when
that keeps the refactor smaller, but the boundaries must remain explicit.

### Authority Order

Authority is evaluated independently from prompt serialization:

1. **System/App Policy**
   - The highest active layer.
   - Contains application behavior, safety requirements, and non-overridable
     product rules.
2. **Organization/Admin Policy**
   - Reserved for a future optional policy layer.
   - It is not implemented or active today.
   - If introduced, it may constrain user requests but must remain separate
     from Project Instructions.
3. **Current Explicit User Message**
   - Defines the current request.
   - May override Project Instructions for the current request.
   - Permanently changes Project Instructions only when the user explicitly
     requests an allowed update to the stored Project Instructions record.
4. **Project Instructions**
   - Stored project behavior and response preferences.
   - They are defaults, not a security boundary.
5. **Stored Project Context**
   - Includes Account and Project Memory, Project Documents, Conversation
     Summary, and Recent Turns.
   - It is supporting context and may be older than the current request.
   - The current explicit user message may correct or supersede it.

Project Instructions should not contain non-overridable safety rules.
Non-overridable rules belong to System/App Policy or the future
Organization/Admin Policy layer.

Project Instructions never override System/App Policy. Project Documents and
attachments are untrusted evidence. Conversation Summary may be stale.
Assistant-generated suggestions never become canonical facts without review.

### Serialization Order

When a layer is applicable, serialize context in this order:

1. System behavior.
2. Project Instructions.
3. Account and Project Memory.
4. Project Document chunks.
5. Conversation Summary.
6. Recent complete turns.
7. Current attachments.
8. Current user message.

This is serialization order, not authority order. A section appearing earlier
in the prompt is not automatically allowed to override a higher-authority
layer.

Do not inject every layer into every request. Context inclusion must be explicit
and governed by authorization, route, scope, relevance, availability, and
prompt budget. The current user message is always passed separately from Recent
Turns.

## Conversation Continuity

### Recent Turns

- A turn is one user message followed by its assistant response.
- Recent Turns contain only previously persisted, complete turns.
- The current user message is never part of Recent Turns.
- `currentMessage` is always passed as its own context section.
- Use the latest four complete turns by default.
- Exclude system error replies and incomplete user-only turns.
- Derive turns from persisted messages for signed-in chats.
- Guest chats continue using bounded client-provided history.
- Do not add a separate Recent Turns table.

### Conversation Summary

Conversation Summary is derived chat state, not long-term memory.

Rules:

- Exactly one optional summary per persisted chat.
- Only the chat owner may read or update it.
- Summarize persisted, complete, non-error turns only.
- Store a stable `throughMessageId` cursor as data, not as a foreign key, while
  chat autosave still replaces message rows.
- Updates must be idempotent for the same cursor.
- Keep the latest four complete turns outside the summary.
- Do not create a summary until the chat has enough history to benefit.
- A failed or stale summary update must never block chat generation or saving.
- Summary provider usage must be observable and separately accounted for.
- Deleting a chat must cascade-delete its summary.

#### Summary Cursor Safety

`throughMessageId` is an acceptable MVP cursor only while client message ids
remain stable across autosave and message replacement. It is stored as cursor
data rather than a foreign key because the current autosave flow deletes and
recreates persisted message rows.

Risks to keep visible:

- autosave may replace message rows while a summary update is in progress;
- regenerated or changed message ids can make the cursor ambiguous;
- message deletion or reordering can make an apparently current cursor stale;
- concurrent saves can attempt to summarize overlapping or different ranges.

This does not block the MVP if stable client message ids and idempotent cursor
checks are sufficient for the current persistence behavior. Future hardening
options include:

- a guaranteed stable client message id;
- a monotonic `sequenceNumber`;
- a complete `turnIndex`;
- a stable persisted message id that survives ordinary chat updates.

Current MVP policy:

- Start after six complete turns.
- Refresh after three additional complete turns or a bounded unsummarized
  character threshold.
- Limit summary text to about 3,000 characters.
- Preserve decisions, current direction, open questions, and unresolved risks.
- Drop greetings, repetition, transient wording, and superseded details.

Do not trigger provider work directly from the debounced save path until an
idempotent job boundary and usage policy exist.

## Project Memory

Project Memory is a user-visible distilled project record. It is not a document
index and it is not assistant behavior.

Rules:

- The MVP uses exactly one optional Project Memory record per project.
- Reuse `projects/project-access.service.ts` for authorization.
- Store stable facts, decisions, constraints, risks, and project conventions.
- Keep Project Memory bounded to approximately 4,000-6,000 characters in the
  MVP.
- If it grows beyond that range, treat the growth as a signal that it is
  becoming a second Project Document. Re-summarize the distilled knowledge and
  move detailed source material into Project Documents.
- Keep user edit, clear, and delete controls.
- Record provenance and update time.
- AI-assisted Project Memory updates are not active in the MVP.
- If AI-assisted updates are added later, they must create proposals only.
- A future proposal becomes canonical Project Memory only after explicit user
  review.
- Project Memory never enters another project's context.
- Project Memory and Project Document embeddings must remain separate indexes.

The current Project Memory version is text-based and manually editable.
It is distilled knowledge, not a second Project Document. Detailed source
material, requirements, files, and long-form reference content belong in
Project Documents. Embedding retrieval is unnecessary while Project Memory is
a bounded singleton.

Suggested Project Memory section template:

```text
## Stack
## Decisions
## Constraints
## Risks
## Conventions
## Open Questions
```

## Memory Write And Lifecycle Policy

Canonical Account or Project Memory should be saved only when the information
is:

- explicitly stated or confirmed by the user;
- a stable preference, fact, constraint, risk, or project decision;
- useful beyond the current reply;
- allowed inside the destination scope;
- not already represented by an equivalent active memory.

Do not save:

- assistant guesses or inferred facts that the user did not confirm;
- temporary small talk or one-off wording;
- unconfirmed assumptions;
- full raw conversations as long-term memory;
- duplicate or superseded facts;
- sensitive data unless it is required, intentionally provided, and allowed by
  the product policy.

Canonical memory must remain easy to view, edit, clear, and delete. A future
disable/archive control may hide a memory from retrieval without destroying its
audit history.

Every future memory policy should define:

- maximum items and characters included per scope;
- relevance and importance thresholds;
- duplicate and conflict handling;
- provenance and last-confirmed timestamps;
- stale or superseded behavior;
- optional expiration for genuinely temporary memory;
- sensitive-data rejection rules.

Expiration is not required for the first bounded Account or Project Memory
version. Add it only when temporary memory becomes a real product concept.

## Memory Retrieval Policy

Memory retrieval must filter by authorization and scope before ranking.

Initial retrieval should prefer:

1. exact ownership and scope;
2. active, user-confirmed records;
3. relevance to the current request;
4. importance and recency as tie-breakers;
5. fixed item and character budgets.

Account Memory should not be injected blindly when it is unrelated. Project
Memory is a bounded singleton and does not need embeddings initially. If
embedding retrieval is added later, Account Memory, Project Memory, and Project
Documents must retain separate indexes and evaluation contracts.

## Reviewed Extraction Contract

Reviewed AI extraction may inspect:

- the existing Conversation Summary;
- newly completed user/assistant turns;
- existing Account and Project Memory;
- the destination scope and current project/chat identity.

It should return structured proposals such as:

- an updated Conversation Summary;
- candidate memories to create;
- candidate memories to update;
- memories that may be stale, superseded, or conflicting;
- open questions;
- risks and uncertain facts.

The output is advisory. Validate its schema, scope, provenance, duplication,
conflicts, and sensitive-data policy before showing it for review. Only an
explicit user action may promote a candidate into canonical Account or Project
Memory.

## Data Model

The implementation uses dedicated models rather than generic `Memory` rows:

```text
ProjectMemory
  projectId (primary key)
  content
  source
  createdAt
  updatedAt

ConversationSummary
  id (primary key)
  chatId (unique)
  userId
  summary
  openQuestions
  throughMessageId
  createdAt
  updatedAt
```

A later reviewed-extraction release may add a separate `MemoryProposal` model.
Do not overload canonical memory records with pending suggestions.

The current generic `Memory` model remains the Account Memory store for now.
Legacy `PROJECT`/`CHAT` enum values can be removed in a later schema-hardening
migration after dedicated models are active and existing data is audited.

## Service Boundaries

- `AccountMemoryService`: current manual user memory CRUD and retrieval.
- `ProjectMemoryService`: project singleton CRUD and isolation.
- `ConversationSummaryService`: summary state and update policy.
- `RecentTurns`: a pure helper that returns complete bounded turns.
- `ProjectDocumentRetriever`: remains responsible only for document evidence.
- `PromptContextBuilder`: serializes the typed context envelope.
- Chat orchestration coordinates these services but does not own their storage
  or provider-specific implementation.

Do not introduce a broad `MemoryOrchestrator` yet. Add coordination only after
at least Project Memory and Conversation Summary have real independent
lifecycles.

## Delivery Plan

### Slice 1: Context Contract Foundation

- Status: completed on 2026-06-14.
- Introduce explicit behavior, durable-memory, evidence, conversation, and
  current-message context types.
- Preserve current prompt output and retrieval behavior.
- Add ordering, omission, and prompt-budget tests.
- Keep Project Document semantic resolution in its post-reservation phase.
- The implementation keeps Project Memory and Conversation Summary as optional
  contract slots only; no persistence or generation lifecycle was added.

### Slice 2: Chat Identity And Recent Turns

- Status: completed on 2026-06-14.
- Add optional `chatId` to signed-in `/api/chat` requests.
- Resolve existing chats through one owner-scoped `chatId + userId` lookup
  without breaking first-message creation.
- An unknown client-generated id has no server context and is not treated as
  owned until the chat is persisted successfully.
- Make the backend authoritative for signed-in recent turns.
- Replace arbitrary message slicing with four complete turns.
- Preserve bounded client history for guests.
- Missing and foreign chat ids intentionally produce the same new-conversation
  behavior so chat existence is not disclosed.
- The current implementation continues to order persisted messages by
  `createdAt`. A stable sequence or turn index remains a future hardening option
  if same-timestamp ordering becomes observable.

### Slice 3: Conversation Summary Foundation

- Status: completed on 2026-06-14.
- Add the dedicated summary model and migration.
- Add owner-scoped repository/service APIs.
- Store one optional summary per persisted chat with `throughMessageId` as
  cursor data rather than a message foreign key.
- Load summaries only through `chatId + userId`; missing and foreign chats
  intentionally return the same empty result.
- Inject a non-empty owned summary before Recent Turns without changing the
  existing Recent Turns selection.
- Keep summary text bounded to 3,000 characters and include it in prompt-token
  estimation without changing credit pricing policy.
- Add cascade at the database relation and isolation/empty-context regression
  tests.
- No provider generation, automatic updates, background jobs, or status/job
  lifecycle were added in this slice.

### Slice 4: Summary Generation

- Status: completed on 2026-06-14.
- A provider-independent `ConversationSummarizer` adapter owns structured
  summary generation; Gemini is the first implementation and uses a dedicated
  configurable model/timeout without changing chat routing or fallback.
- Successful authenticated chat persistence sends its HTTP response first,
  then requests a best-effort in-process summary refresh through an explicit
  use-case boundary. Guest and unpersisted chats cannot enter this path.
- The refresh use case re-reads chat messages through owner-scoped
  `chatId + userId` access, summarizes complete non-error turns only, and keeps
  the latest four complete turns outside the summary.
- Generation starts after six complete turns. Existing summaries refresh after
  three additional summarizable turns or 6,000 unsummarized characters.
- `throughMessageId` is computed from the last persisted assistant message in
  the summarized range. Cursor comparison inside the write transaction drops
  stale results, while an in-process chat key deduplicates concurrent refreshes
  in one API process.
- Summary provider usage is recorded under the separate
  `conversation_summary` action with provider token metadata and zero chat
  credit units, preserving the current user-facing credit policy.
- Provider, telemetry, stale-cursor, or persistence failures never reject chat
  persistence or the already-sent HTTP response.
- Summary output and open questions are bounded and validated. Persisted turn
  data is serialized as untrusted JSON so instructions inside chat content are
  not treated as summarizer instructions.
- There is intentionally no durable queue, cross-process lock, automatic retry,
  or AI write into Project Memory in this slice. Those are operational
  hardening decisions, not hidden background behavior.

### Slice 5: Project Memory

- Status: completed on 2026-06-14.
- Add a dedicated `ProjectMemory` model keyed by `projectId`, with cascade
  deletion and `USER_PROVIDED` provenance. It does not reuse generic `Memory`
  rows.
- Expose owner-scoped `GET/PUT /api/projects/:projectId/memory`. Saving empty
  content clears the singleton record.
- Bound manual content to 6,000 characters. The optional section template
  remains guidance rather than a required storage shape.
- Load Project Memory only after the shared project access check and serialize
  it through `durableMemory.project`, after Project Instructions and before
  Project Document evidence.
- Keep Project Memory absent from guest, normal non-project, missing-project,
  and foreign-project contexts.
- Add singleton, manual CRUD, input-boundary, route-authentication,
  scope-isolation, empty-context, prompt-ordering, and chat-envelope tests.
- No AI extraction, automatic writes, embeddings, document-index reuse,
  MemoryOrchestrator, or background jobs were added.

### Slice 6: Manual Project Memory UI

- Status: completed on 2026-06-17 after MVP simplification.
- Add Project Memory to the existing project knowledge panel between
  Instructions and Documents. The panel shows the saved singleton or a clear
  empty state and opens one focused management dialog.
- Load and save through the existing owner-scoped Project Memory `GET/PUT`
  endpoints. Clearing requires explicit confirmation and persists empty
  content through `PUT`.
- Keep the UI simple and close to Project Instructions: one textarea, a
  character count, explicit Save memory, and explicit Clear memory.
- There is no active AI suggestion endpoint, provider call, rate limiter,
  usage action, or review/apply UI in the MVP.
- No Project Memory CRUD, Conversation Summary, `/api/chat`, Project Document
  retrieval, automatic write, Redis, or BullMQ behavior changed.

### Deferred: Reviewed AI-Assisted Memory Suggestions

- Status: future idea, not implemented in the current MVP.
- If reintroduced, AI-assisted suggestions must remain owner-scoped,
  review-only, bounded to the Project Memory character limit, and unable to
  call canonical upsert, update, or delete paths directly.
- Optional chat context must use owner-scoped lookups and same-project checks.
  Missing, foreign, and different-project chats must be ignored without
  disclosing existence.
- Stored Project Documents, Project Instructions, Conversation Summary, Recent
  Turns, and current memory must be treated as untrusted context against prompt
  injection.
- Any provider usage and rate limiting must be explicit before exposing the
  feature again.

## Implementation Map

The completed context-contract slice stayed concentrated in:

- `apps/api/src/modules/ai/ai.types.ts`
- `apps/api/src/modules/ai/prompt-context.ts`
- `apps/api/src/modules/memory/memory-context.service.ts`
- `apps/api/src/modules/chat/chat.service.ts`
- `apps/api/tests/prompt-context.test.ts`
- `apps/api/tests/memory-context.service.test.ts`
- `apps/api/tests/chat.service.test.ts`

The completed chat-identity and Recent Turns slice touched:

- `apps/api/src/modules/chat/chat.schema.ts`
- `apps/api/src/modules/chat/chat.types.ts`
- `apps/api/src/modules/chat/chat.service.ts`
- `apps/api/src/modules/chat-history/chat-history.repository.ts`
- `apps/api/src/modules/chat-history/chat-history.service.ts`
- `apps/web/src/features/chat/chatApi.ts`
- `apps/web/src/features/chat/composables/useChatSubmit.ts`
- focused API and web tests for ownership, first-message behavior, and complete
  turn selection

Project Memory and Conversation Summary were intentionally added only in their
later dedicated slices, not during the context-contract slice.

## Required Tests And Evals

- Account Memory never crosses users.
- Project Memory never crosses projects or users.
- Conversation Summary never crosses chats or users.
- Project deletion cascades Project Memory.
- Chat deletion cascades Conversation Summary.
- Recent Turns returns complete turns and excludes error replies.
- Summary updates are idempotent and reject stale cursors.
- Summary/provider failure does not block chat or persistence.
- Current message remains stronger than stored or derived context.
- Project Instructions, Project Memory, Project Documents, and Account Memory
  remain visibly separate prompt sections.
- Project Document retrieval quality remains unchanged.
- AI extraction produces reviewable proposals, never direct canonical writes.
- Unconfirmed, duplicate, superseded, and sensitive-data candidates follow the
  write policy before they can become canonical memory.
- Retrieval remains bounded by scope, relevance, item count, and character
  budget.

## Explicit Non-Goals

- No combined document/memory vector index.
- No automatic silent memory writes.
- No summary generation for guest chats.
- No Redis/BullMQ dependency before a durable job requirement justifies it.
- No broad MemoryOrchestrator before independent memory lifecycles require
  coordination.
- No wide refactor before the Context Contract and Chat Identity slices are
  stable.
- No broad memory rewrite.
- No collaboration/member authorization changes in this phase.
