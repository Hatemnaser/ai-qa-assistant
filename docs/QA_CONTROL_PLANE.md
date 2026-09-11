# Oddpath QA Control Plane

This document is the source of truth for Oddpath's project-scoped QA Request
workflow, external-agent connections, REST and MCP contracts, evidence, and
Human Review boundary.

The bounded Playwright Recipe/Runner extension is documented in
`docs/QA_EXECUTION_HARNESS.md`.

Oddpath is not the agent that drives the browser or writes the application.
Agents execute. Oddpath keeps the reviewable record: the request, locked
context, checklist revision, results, evidence, status, history, and owner
decision.

## Product And Trust Boundary

```text
Project owner
  -> Oddpath web UI
  -> cookie session + CSRF
  -> create/select/review QA records

Codex, Claude, or another agent
  -> project connection bearer token
  -> Remote Streamable HTTP MCP or REST
  -> submit plans, execute checks, record results, and attach evidence

Both transports
  -> shared QA services and repository
  -> PostgreSQL transactions, immutable artifacts, versions, and audit events
```

The web, REST, and MCP surfaces do not implement separate QA workflows. They
adapt different actors and transports onto the same domain service and
repository. Transport and actor metadata are retained on evidence and workflow
events.

Project access is owner-only today. A project connection is tied to exactly one
project and its owner; it is not an account-wide API key.

## Domain Record

A QA Request owns the following records:

- `QaContextSnapshot`: the immutable project context captured when the request
  is created.
- `QaArtifact`: a versioned, immutable checklist candidate tied to one context
  snapshot.
- `QaChecklistItem` and `QaEvidenceRequirement`: executable checks and the
  concrete proof required for each one.
- `QaChecklistAssessment`: Oddpath's structured assessment of an
  agent-provided checklist.
- `QaRun` and `QaCheckResult`: one execution of the selected artifact and one
  result per checklist item.
- `QaEvidence`: inline proof, external references, or project-scoped stored
  assets linked to the run and optionally to an exact requirement.
- `QaHumanReview`: the owner's final `APPROVED` or `CHANGES_REQUESTED`
  decision.
- `QaWorkflowEvent`: an ordered audit history with actor and transport.
- `QaGenerationExecution`: a durable, leased asynchronous checklist/Recipe
  generation or review operation.
- `QaExecutionRecipe`, `QaExecutionAuthorization`, and `QaExecutionJob`:
  immutable RecipeV1 candidates, exact owner approvals, and Runner work.

`ProjectConnectionToken` stores the external credential boundary.
`ExternalIdempotencyRecord` stores mutation intent and replay state per
connection and operation.

## Locked Project Context

Request creation captures:

- title, objective, target, environment, and acceptance notes;
- Project Instructions;
- manual Project Memory; and
- Project Document chunks selected by the shared `ProjectDocumentRetriever`.

The QA builder deliberately reuses the same bounded project-document retrieval
contract as project chat. That means the deterministic lexical baseline and
the existing optional semantic augmentation/fallback policy evolve in one
place. The snapshot stores the chunks that were actually selected, a payload
hash, a source manifest, the retrieval mode, and whether retrieval degraded.

Account Memory, chats, Recent Turns, and Conversation Summary are not included.
This keeps the QA record project-scoped and prevents unrelated conversational
or account context from silently affecting an executable checklist.

The snapshot does not change when Project Instructions, Project Memory, or
documents change later. A new QA Request is required to capture a new context.

## Lifecycle

### Oddpath-generated checklist

```text
GENERATING
  -> generated artifact is persisted and selected
  -> READY_TO_RUN

provider, usage, or output failure
  -> PROCESSING_FAILED
```

Generation is asynchronous. Request creation persists a
`QaGenerationExecution`, returns an operation receipt, and lets the worker
claim it with a lease. Callers poll the operation; retryable failures receive
bounded backoff retries before terminal failure.

### Agent-provided checklist

```text
DRAFT
  -> agent submits immutable candidate
  -> CHECKLIST_REVIEW
  -> owner selects candidate
  -> READY_TO_RUN
```

Oddpath reviews an agent-provided candidate against the locked snapshot. The
assessment can pass, return suggestions, or fail to complete. It is advisory:
selection is blocked while assessment is pending, but the owner may inspect and
select a candidate after a failed assessment.

Checklist review is also asynchronous and returns a durable operation receipt.
Execution Recipe generation and review use the same queue/lease pattern. See
`docs/QA_EXECUTION_HARNESS.md` for RecipeV1 and Runner lifecycle details.

### Run, evidence, and Human Review

```text
READY_TO_RUN or CHANGES_REQUESTED
  -> RUNNING
  -> all checklist items receive a result
  -> EVIDENCE_NEEDED or READY_FOR_REVIEW
  -> APPROVED or CHANGES_REQUESTED
```

Only one run may be active for a request. Starting the first run locks the
selected artifact. Finishing requires a result for every checklist item and
computes the run outcome from `PASS`, `FAIL`, `BLOCKED`, and `SKIPPED` results.

Every required evidence requirement must be satisfied before the request moves
to `READY_FOR_REVIEW`. Evidence satisfies a requirement only when it carries
that exact `requirementId`; merely attaching evidence to the same item does not
fulfill the requirement.

Only a user actor can record Human Review. `CHANGES_REQUESTED` allows another
run against the same selected artifact. Revising the checklist after execution
has started is not implemented.

## Owner And Agent Capabilities

| Capability | Project owner in Oddpath | Connected agent |
| --- | --- | --- |
| List and read QA Requests | Yes | `qa:read` |
| Create an Oddpath-generated request | Yes | No |
| Create an agent-provided request | Yes | `qa:read` + `qa:write` |
| Submit a checklist candidate | Yes | `qa:read` + `qa:write` |
| List/read Execution Recipes | Yes | `qa:read` |
| Generate an Execution Recipe | Yes | No |
| Submit an Execution Recipe candidate | No | `qa:read` + `qa:write` |
| Select the checklist revision | Yes | No |
| Start a connected-agent run and record results | Yes | `qa:read` + `qa:write` |
| Approve a Playwright Recipe/Runner execution | Yes | No |
| Add evidence | Yes | `qa:read` + `evidence:write` |
| Finish a run | Yes | `qa:read` + `qa:write` |
| Approve or request changes | Yes | No |

Write operations also require `qa:read` because their responses include the
updated QA record. A write-only token therefore cannot use a mutation response
to bypass the read boundary.

The generic result and finish capabilities apply to connected-agent runs,
not Recipe-bound Playwright executions. Those executions require the assigned
Runner protocol and valid lease. Generic evidence writes are likewise blocked
while a Recipe-bound run is CREATED or ACTIVE, but normal guarded evidence
supplementation remains available after RESULTS_SUBMITTED. Repository-level
guards enforce this boundary for owner web, REST, and MCP callers alike.

## Project Connections

The owner manages connections through cookie-authenticated project routes:

- `GET /api/projects/:projectId/connections`
- `POST /api/projects/:projectId/connections`
- `DELETE /api/projects/:projectId/connections/:connectionId`

The create body accepts a name, an optional future expiry, and either an
`AGENT`/`RUNNER` preset or explicit scopes. `AGENT` grants `qa:read`,
`qa:write`, and `evidence:write`; `RUNNER` grants `qa:read`,
`execution:claim`, `execution:write`, and `evidence:write`. A request cannot
combine a preset with explicit scopes.

The returned credential starts with `odp_live_` and is shown once. Oddpath
stores only its SHA-256 hash and a short display prefix. A connection can be
expired or revoked; rotation is revoke-and-create rather than reveal or edit.
Never put a live token in source control, logs, screenshots, or documentation.
One project can have at most 20 active, non-revoked, non-expired connections.

## Remote MCP

The MCP endpoint is:

```text
POST https://<oddpath-api>/api/mcp
Authorization: Bearer <project-connection-token>
```

It implements stateless Streamable HTTP with JSON responses. `GET` and
`DELETE` return `405`; there is no server session to resume. A generic client
configuration looks like this, although the filename and outer shape vary by
client:

```json
{
  "mcpServers": {
    "oddpath": {
      "type": "http",
      "url": "http://127.0.0.1:5000/api/mcp",
      "headers": {
        "Authorization": "Bearer odp_live_replace_me"
      }
    }
  }
}
```

Available tools:

| Tool | Required scopes | Purpose |
| --- | --- | --- |
| `oddpath_list_requests` | `qa:read` | Cursor-page the project's requests. |
| `oddpath_get_request` | `qa:read` | Read one request, artifacts, runs, evidence, reviews, and history. |
| `oddpath_get_operation` | `qa:read` | Read an asynchronous generation/review operation. |
| `oddpath_list_execution_recipes` | `qa:read` | List immutable RecipeV1 candidates for a request. |
| `oddpath_get_execution_recipe` | `qa:read` | Read one RecipeV1 candidate and assessment. |
| `oddpath_create_request` | `qa:read`, `qa:write` | Create an agent-provided QA Request. |
| `oddpath_submit_checklist` | `qa:read`, `qa:write` | Submit an immutable checklist candidate. |
| `oddpath_submit_execution_recipe` | `qa:read`, `qa:write` | Submit an immutable RecipeV1 candidate for asynchronous review. |
| `oddpath_start_run` | `qa:read`, `qa:write` | Start execution of the owner-selected artifact. |
| `oddpath_record_result` | `qa:read`, `qa:write` | Upsert one item result with the current run version. |
| `oddpath_add_evidence` | `qa:read`, `evidence:write` | Add evidence to a run and optional requirement. |
| `oddpath_finish_run` | `qa:read`, `qa:write` | Submit the complete run for evidence/Human Review gating. |

There are 12 tools. There are intentionally no MCP tools for checklist
selection, Playwright approval, or Human Review.

A normal agent sequence is:

1. Create a request and retain its id.
2. Submit a checklist candidate with at least one evidence requirement per
   item.
3. Poll its returned operation with `oddpath_get_operation`, then wait for the
   owner to select the candidate; poll `oddpath_get_request` until the phase is
   `READY_TO_RUN`.
4. Start a run and retain its id and version.
5. Record each result using the latest run version returned by Oddpath.
6. Add evidence with the exact `checklistItemId` and `requirementId` where
   required.
7. Finish the run, then leave approval to the owner.

## REST Integration

The REST base is:

```text
/api/integrations/v1/projects/:projectId/qa
```

Every request uses the same project bearer token. A token for a different
project receives the same not-found boundary as a missing project.

| Method and path below the base | Required scopes |
| --- | --- |
| `GET /requests?limit=30&cursor=...` | `qa:read` |
| `POST /requests` | `qa:read`, `qa:write` |
| `GET /operations/:operationId` | `qa:read` |
| `GET /requests/:requestId` | `qa:read` |
| `POST /requests/:requestId/checklists` | `qa:read`, `qa:write` |
| `GET /requests/:requestId/execution-recipes` | `qa:read` |
| `POST /requests/:requestId/execution-recipes` | `qa:read`, `qa:write` |
| `GET /requests/:requestId/execution-recipes/:recipeId` | `qa:read` |
| `POST /requests/:requestId/runs` | `qa:read`, `qa:write` |
| `PUT /requests/:requestId/runs/:runId/results/:checklistItemId` | `qa:read`, `qa:write` |
| `POST /requests/:requestId/runs/:runId/evidence` | `qa:read`, `evidence:write` |
| `POST /requests/:requestId/runs/:runId/finish` | `qa:read`, `qa:write` |

For example:

```bash
curl -X POST \
  "http://127.0.0.1:5000/api/integrations/v1/projects/PROJECT_ID/qa/requests" \
  -H "Authorization: Bearer odp_live_replace_me" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: checkout-request-001" \
  -d '{
    "title": "Checkout regression",
    "objective": "Verify the critical checkout path",
    "target": "web checkout",
    "environment": "staging"
  }'
```

The exact payload contracts and bounds live in
`apps/api/src/modules/qa-requests/qa-requests.schema.ts`. In particular:

- checklist candidates contain 1-80 items; each item has steps, one expected
  result, and at least one evidence requirement;
- check results require `status` and the current positive `expectedVersion`;
- finishing requires the current positive `expectedVersion`; and
- Human Review, available only to the owner API, requires
  `expectedRunVersion`.

## Idempotency And Concurrency

External mutation idempotency is required by the protocol.

- REST uses `Idempotency-Key`.
- MCP mutation tools require the `idempotencyKey` input.
- Keys must contain 8-200 characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, `:`,
  or `-`.
- The persisted key scope is connection + operation + key. The canonical
  request hash must also match.
- A successful retry replays the stored status and body. REST adds
  `Idempotent-Replayed: true`.
- Reusing a key with a different request returns `IDEMPOTENCY_KEY_REUSED`.
- A known domain rejection is stored and replayed without running the action
  again.
- An unknown or ambiguous failure remains fenced as in-progress. A retry
  returns `IDEMPOTENCY_IN_PROGRESS` rather than risk duplicating a mutation
  whose acknowledgement may have been lost.

That last behavior is deliberately conservative. There is not yet an automatic
reconciliation or expiry job for ambiguous idempotency records.

The idempotency reservation/receipt is not committed atomically with the domain
transaction. If the domain mutation commits but receipt completion is unknown,
the key remains fenced rather than being replayed automatically.

Domain writes also use PostgreSQL transactions, request-level locks, and
optimistic versions. `expectedRequestVersion`, run `expectedVersion`, and
`expectedRunVersion` reject stale writers with `STALE_VERSION`; reload the
request rather than blindly retrying an old body. `externalRunRef` provides an
additional request-local intent key for run creation.

## Evidence And Stored Assets

Evidence kinds are `TEXT`, `SCREENSHOT`, `LOG`, `TRACE`, `FILE`, and
`REFERENCE`.

- Any evidence needs inline content, an external reference, or at least one
  stored asset.
- `SCREENSHOT` and `FILE` specifically require a stored asset or an
  `externalReference`.
- A screenshot/file external reference must be a credential-free HTTPS URL.
  Oddpath labels it as external and does not claim that the bytes are stored,
  immutable, reachable later, or independently verified.
- Stored assets must be `READY`, have purpose `QA_EVIDENCE`, belong to the same
  owner and project, and not already be attached to other evidence.
- One evidence record accepts at most four distinct asset ids.
- The run remains in `EVIDENCE_NEEDED` until every required requirement id is
  linked to evidence.

The standard bearer `AGENT` integration has no token-authenticated asset-upload
endpoint. It can submit an external reference or use a `QA_EVIDENCE` asset
that the owner uploaded through the authenticated asset flow. The separate
`RUNNER` protocol can reserve and complete private screenshot uploads for its
assigned execution.

QA evidence assets participate in project/account deletion and the durable
object-deletion lifecycle. QA records are not yet included in Project or
Account portable ZIPs.

The active aggregate guards allow at most 20 checklist artifacts and 100 runs
per QA Request. Evidence metadata is additionally capped at 20,000 serialized
JSON characters. These limits reduce response/database amplification but do
not replace pagination for growing detail views.

## AI Provider And Usage Boundary

QA checklist/Recipe generation and review call `generateTextWithAi`, not
Gemini directly. `AiProviderAdapter` exposes a generic `generateText` operation
beside chat, provider metadata, a default model, and a model catalog. Adding a
text provider requires an adapter, catalog entries, registry registration, and
matching environment validation.

Gemini is the only registered runtime provider today, and production
configuration still validates `AI_PROVIDER=gemini`. Chat workflow routing,
conversation summaries, and document embeddings have their own provider
boundaries and are not automatically migrated by adding a QA text provider.

Before a QA provider call, Oddpath resolves the provider/model and reserves AI
usage for the project owner. Checklist and Recipe generation/review use
distinct usage actions. The shared usage service enforces owner and global
credit/in-flight guards, records the provider attempt, and reconciles actual
token metadata when available. A reservation failure prevents the provider
call. Usage-finalization failure does not discard an otherwise valid immutable
artifact.

Agent-submitted checklist review is charged to the project owner represented by
the connection token.

## Integration Request Safety

REST and MCP are mounted before JSON body parsing with:

- bearer authentication;
- a 1 MB JSON body limit; and
- process-local fixed-window limits keyed independently by request IP and a
  SHA-256 hash of the bearer token.

Defaults are 120 requests per IP and 60 requests per token per 60 seconds.
They are configured by `QA_INTEGRATION_IP_RATE_LIMIT_MAX`,
`QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX`, and
`QA_INTEGRATION_RATE_LIMIT_WINDOW_MS`. A rejection returns `429`,
`Retry-After`, and closes the connection without reading the remaining body.

These limiters reset on process restart and are not shared across replicas.
Production still needs trusted proxy/edge limits and, before horizontal scale,
a shared limiter.

## Current Limitations

- Generation/review runs asynchronously with leases and bounded retries.
  Failed Execution Recipe assessments have an owner-only `Retry review`
  flow on the same immutable Recipe (see `QA_EXECUTION_HARNESS.md`). General
  generation/checklist-review retry and processing cancellation remain absent.
- Gemini is the only registered text provider and environment validation does
  not yet accept a second provider.
- Project membership and organization roles are not active authorization
  paths; access is owner-only.
- Project/Account portability does not export or import QA records or
  connection metadata.
- Standard `AGENT` connections cannot initiate private asset uploads; Runner
  screenshot uploads use a separate, execution-bound protocol.
- Connected-agent runs and failed generation operations have no cancellation
  or manual retry endpoint. Playwright execution has an owner cancellation
  route.
- Playwright deadline/attempt exhaustion is reconciled during bounded Runner
  claim polling. With no assigned Runner online, owner cancellation is the
  immediate recovery path; there is no independent execution reaper yet.
- MCP is stateless and tools-only; it exposes no resources or prompts.
- `CHANGES_REQUESTED` starts a new run against the selected locked artifact;
  post-run checklist revision is not supported.
- Ambiguous idempotency reservations have no automated reconciliation job.
- Integration rate limiting is process-local.
- Request detail currently loads the complete bounded artifact/run/evidence/
  history graph, and the web request list has no load-more flow yet.
- The first QA Workspace UI slice uses English product-contract copy; full QA
  catalog localization remains follow-up work.

## Source And Verification Map

- Domain contracts and phases:
  `apps/api/src/modules/qa-requests/qa-requests.types.ts`
- Input validation: `apps/api/src/modules/qa-requests/qa-requests.schema.ts`
- Transactional lifecycle:
  `apps/api/src/modules/qa-requests/qa-requests.repository.ts`
- Owner and REST adapters: `qa-requests.routes.ts` and `qa-agent.routes.ts`
- MCP tools: `apps/api/src/modules/qa-requests/qa-mcp.routes.ts`
- Execution harness and local CLI: `docs/QA_EXECUTION_HARNESS.md` and
  `apps/runner/`
- Async queue/worker: `qa-processing.repository.ts`,
  `qa-processing.worker.ts`, and `qa-processing.handlers.ts`
- Project context snapshot:
  `apps/api/src/modules/qa-requests/project-qa-context.builder.ts`
- Provider/usage orchestration:
  `apps/api/src/modules/qa-requests/qa-checklist.intelligence.ts`
- Token, scope, rate-limit, and idempotency boundary:
  `apps/api/src/modules/project-connections/`
- Database models: `apps/api/prisma/schema.prisma`
- Unit coverage: `apps/api/tests/qa-*.test.ts`,
  `project-connections.service.test.ts`, and
  `external-idempotency.service.test.ts`
- Real PostgreSQL lifecycle: `apps/api/tests/postgres.integration.ts`

Run the normal gates after changing this boundary:

```bash
npm run check:api
npm run test:api
npm run build:api
```

Run the guarded disposable-PostgreSQL integration suite for lifecycle,
locking, migration, and ownership changes. The exact safe setup is documented
in the root `README.md` and `docs/DEVELOPMENT_GUIDE.md`.
