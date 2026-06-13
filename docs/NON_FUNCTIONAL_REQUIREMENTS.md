# Non-Functional Requirements

This project should stay easy to extend while it grows from a portfolio demo into a real product. These rules are the baseline for future work.

## Maintainability

- Keep `App.vue` as composition glue only. Feature state and side effects should live in composables or feature modules.
- Prefer small feature modules: API client, storage, controller, sync, and UI components should stay separate.
- Add new SCSS only when Bootstrap utilities or existing design tokens cannot express the UI cleanly.
- Shared UI behavior should become reusable components before being duplicated across pages.
- Provider integrations must stay behind the provider registry/adapter contract. Chat orchestration should not import vendor SDKs directly.
- Keep model catalogs capability-driven so text-only, image-capable, file-capable, and future providers can be added without rewriting chat flow.

## Data Ownership

- Guest chats belong to the browser only until the user signs in or registers.
- Signed-in chats belong to the authenticated `userId` and are persisted in the database.
- LocalStorage is a cache for signed-in users, not the source of truth.
- Guest chats may be adopted into a user account only during an explicit sign-in/register flow.

## Reliability

- Chat persistence must not block the main chat interaction.
- Failed chat sync should warn in the console and keep the local copy available.
- The app should merge local and database chats by `updatedAt`, keeping the newest copy per chat id.
- Delete operations should remove the local chat immediately and then attempt the account delete.

## AI Behavior

- The latest user message must take priority over the selected mode and older chat context.
- Conversational follow-ups, thanks, language changes, and clarification questions must not be forced into QA artifact templates.
- Attachments should provide context, not permanently lock the conversation into an attachment-review mode.
- Composer state should use generic attachment naming; provider-specific payloads such as image data should be built at the API boundary.
- When a user uploads an image without a clear task, the assistant should briefly describe it and offer next-step QA options.
- QA artifact responses should include assumptions when details are missing instead of pretending requirements are complete.
- Underspecified artifact requests should ask a few focused questions before generating a large answer.

## Privacy

- Chats from different users must never share the same localStorage scope.
- Authenticated account data must be scoped by `user:<userId>`.
- System errors such as quota or backend failures must not be sent back to the AI as conversation history.
- Personal usage pages must show only the current identity usage. Global usage requires explicit admin roles and authorization first.
- Guest usage may use a guest cookie and IP hash fallback, but raw IP addresses should not be exposed in frontend responses.

## Usage Protection

- Guest usage is limited by guest cookie and IP hash fallback.
- Signed-in usage is limited by `userId`.
- When guest usage is exhausted, the composer is blocked and the user can sign in, register, export the chat, or close the modal.
- Usage credits should be reserved before provider calls and updated with actual provider token metadata after successful responses.
- Credit policy should remain provider/model aware but user-facing credit messaging should stay simple.
- Plan/entitlement rules should be introduced before paid billing or higher limits.

## Performance

- Chat DB persistence should be debounced instead of saving on every reactive micro-change.
- Chat history sent to the AI should remain capped by backend validation.
- Large attachments should keep using backend request body limits and client-side validation.
- Inline chat attachments are capped to 4 files per message until a provider file API is introduced.
- Backend schemas must enforce the same attachment count, image type, and inline image/text size limits as the UI.
- Text/data file attachment content should stay capped and should not be stored in chat export metadata unless explicit file persistence is added.
- Project Document retrieval must keep deterministic chunk and total-context limits so imported files cannot grow prompts without bounds.
- Project Document retrieval strategies must remain replaceable behind one contract and must provide a provider-independent fallback when embeddings or external retrieval are unavailable.
- Project Document embeddings must be versioned by source hash, chunk hash, chunking version, and embedding model so stale vectors are never treated as current.
- Deterministic index writes must verify the source document version so a late index cannot replace chunks for a newer edit.
- A failed chunk-index or embedding write must not make the authoritative source document unavailable to lexical retrieval.
- Embedding provider calls must stay behind a provider-independent adapter and be disabled by default until cost, backfill, and retrieval quality are explicitly enabled.
- Query embedding calls must run only after usage credits are reserved.
- Application-process vector scoring must have a hard candidate limit and fall back safely; larger collections require database vector search.
- Late embedding responses must update a chunk only when its persisted content hash still matches the request.

## Testing Expectations

- Critical logic needs unit tests: storage scoping, import/export, prompt mode behavior, usage limits, and API error parsing.
- API route/controller changes need validation tests or service-level tests before feature work continues.
- Builds and type checks must pass before merging.
- Model routing, workflow routing, and usage accounting need tests before adding more providers or paid plans.
- Project Document chunking needs direct tests for deterministic boundaries, progress through unstructured content, prompt budgets, and multi-document selection fairness before semantic retrieval is added.
- Project Document indexing needs direct tests for stable hashes, version invalidation, persistence boundaries, and safe failure behavior.
- Semantic retrieval must be compared against the lexical baseline in `docs/RAG_RETRIEVAL_EVALS.md` before it becomes the default strategy.
