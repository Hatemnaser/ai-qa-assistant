# Project Document Retrieval Evals

These evals define the retrieval contract that must stay stable while Project Knowledge evolves from deterministic lexical retrieval to embeddings and vector search.

The automated contract lives in:

```text
apps/api/tests/project-document-chunks.test.ts
apps/api/tests/project-document-index.test.ts
apps/api/tests/project-document-embedding.service.test.ts
apps/api/tests/gemini-embedding.provider.test.ts
apps/api/tests/project-document-hybrid-retrieval.test.ts
apps/api/tests/project-document-retrieval.test.ts
apps/api/tests/memory-context.service.test.ts
apps/api/tests/prompt-context.test.ts
```

Run it through the normal API test command:

```bash
npm run test:api
```

## Retrieval Contract

1. Only signed-in project chats may load Project Document context.
2. The latest user message is the retrieval query.
3. Project access is checked before documents are loaded or ranked.
4. Project Instructions remain before durable memory and Project Document chunks.
5. Account Memory remains a distinct durable-memory section before Project Document evidence.
6. Retrieval must stay within the configured chunk count and character budget.
7. A missing lexical match must use deterministic fallback retrieval rather than silently dropping all project context.
8. Retrieval ranking metadata is internal and must not leak into the public chat response.
9. Persisted chunks must match the current source hash and chunking version before semantic retrieval can use them.
10. Index or embedding failures must preserve lexical fallback.
11. Embedding writes must be tied to the chunk hash, model, and dimensions.
12. The same model/config failure must not create an automatic retry loop.

## Evaluation Matrix

| Scenario | Expected result |
| --- | --- |
| An older document matches the query while newer documents do not | The matching document is retrieved ahead of the newer documents. |
| One chunk covers more query terms than another | The higher-coverage chunk is ranked first. |
| Query terms appear in a document title | The title match improves that document and its chunks. |
| The query uses Arabic or other Unicode words | Matching remains case-normalized and Unicode-aware. |
| No document contains any query term | Use the latest-document round-robin fallback. |
| Many documents and chunks match | Return no more than six chunks from no more than four documents and stay within 7,200 characters. |
| A document has no natural text boundaries | Chunking still makes progress and never exceeds the chunk-size limit. |
| A project belongs to another user | Reject retrieval before usage reservation or provider calls. |
| The document is split into multiple chunks | Prompt labels include the chunk position for traceability. |
| Document line endings differ but normalized content is the same | Document and chunk hashes remain stable. |
| A document title or content changes | Its document/chunk hashes change and old embeddings become stale. |
| A deterministic index finishes after a newer source edit | Reject the stale index and do not start embedding its chunks. |
| Persisted indexing fails | The source document remains available through lexical retrieval. |
| An embedding response finishes after the source chunk changed | The stale result does not update the newer chunk. |
| The embedding model or dimensions change | Current chunks become eligible for regeneration. |
| The same embedding configuration previously failed | Keep lexical fallback without retrying on every project load. |

## Current Strategy

The default runtime strategy remains deterministic lexical ranking while
`PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false`:

- Query terms come from the latest user message.
- Common request filler words are ignored.
- Documents are scored by title and content matches.
- Chunks are scored independently after the best documents are selected.
- Distinct matched terms are stronger than repeated occurrences of one term.
- Stable document and chunk ordering resolves ties.

This strategy is intentionally local and provider-independent. It remains the
baseline and fallback for every semantic failure mode.

## Hybrid Implementation

The implemented hybrid retriever:

- runs query embedding only after usage reservation;
- reads candidates only from the authorized project and loaded document ids;
- requires matching source/chunk hashes, chunking version, model, and dimensions;
- blends cosine similarity above a conservative floor with lexical query-term coverage;
- gives exact lexical evidence a conservative advantage when its vector is missing;
- caps in-process semantic scoring at 1,000 compatible chunks;
- falls back lexically for disabled, missing, stale, invalid, oversized, or failed semantic retrieval.

It preserves:

- project authorization and user isolation;
- the prompt layer order;
- deterministic budget enforcement;
- fallback behavior when semantic retrieval is unavailable;
- the evaluation scenarios in this document.

Automated fixture coverage now compares lexical and hybrid behavior. Before
switching the shared-environment default, run representative real-provider
queries and record quality, latency, and cost rather than relying on visual
prompt inspection alone.

## Controlled Real-Provider Result

The controlled Gemini evaluation passed on 2026-06-13:

```bash
npm run eval:retrieval
```

- Model: `gemini-embedding-2`
- Dimensions: `768`
- Fixture queries: `6`
- Lexical Hit@1: `1/6` (`0.17`)
- Hybrid Hit@1: `6/6` (`1.00`)
- Semantic-case Hybrid Hit@1: `5/5` (`1.00`)
- Exact lexical case preserved: yes
- Provider calls: `12` (`6` document + `6` query embeddings)
- Provider input: `1,002` characters
- Mean provider latency: `304.23 ms`
- P95 provider latency: `519.01 ms`

The provider response used by this adapter does not expose billable token
metadata, so the harness records call count and input characters as the local
cost proxy. The run uses in-memory fixtures and does not mutate PostgreSQL,
project data, or `.env`.

The observed relevant similarities were at least `0.65`, while unrelated
results were at most `0.59`. The current semantic floor is therefore `0.60`.
The evaluation also exposed generic question words that produced weak lexical
matches; those terms are now ignored and covered by regression tests.

This result approves controlled opt-in use of Project Document embeddings. The
shared-environment default remains off until the target environment's quota and
operational policy are intentionally selected.
