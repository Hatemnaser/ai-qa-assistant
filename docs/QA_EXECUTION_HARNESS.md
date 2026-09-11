# Oddpath Execution Harness

This document describes the first Playwright execution path built on top of
the QA Control Plane. The harness is deliberately agent-neutral: Codex,
Claude, another MCP client, or Oddpath's provider-neutral AI layer may propose
an immutable Execution Recipe; only the project owner can approve a particular
Recipe and Runner profile for execution.

## Why This Is Not A Chatbot

An agent can execute work, but Oddpath owns the durable control-plane record:

```text
QA Request + locked project context
  -> owner-selected immutable checklist
  -> immutable RecipeV1 + assessment
  -> exact owner approval (request version + recipe hash + Runner profile-manifest hash)
  -> local Runner lease
  -> results + required evidence
  -> append-only history
  -> Human Review
```

The model can become stronger without replacing this product boundary. Better
models can produce better checklist and Recipe candidates, while Oddpath keeps
the approval, execution, proof, and audit contract stable.

## Components And Trust Boundaries

- `packages/qa-execution-contract` is the shared, versioned Zod contract for
  public Runner profiles, RecipeV1, claims, tasks, results, and receipts.
- The API stores immutable Recipes, assessments, exact approvals, execution
  jobs, lease hashes, progress, evidence-upload reservations, and history.
- `apps/runner` is a local CLI. It is the only component that receives profile
  `baseUrl` values and local test values or secrets.
- The web UI discovers public Runner profiles, shows Recipe steps and hashes,
  requires explicit approval, and polls operation/job progress.
- Connected agents can submit checklist and Recipe candidates over REST or MCP,
  but cannot select a checklist, approve a Playwright execution, or record the
  final Human Review.

Oddpath never receives a profile's `baseUrl` or resolved values. Registration
contains only a profile key, label, environment classification, evidence
capabilities, value-reference names with `secret` flags, supported schema
versions, and a canonical manifest hash.

## RecipeV1 Safety Contract

RecipeV1 supports `playwright` only. It is data, not arbitrary code.

- Locators: role/name, label, placeholder, visible text, and test id.
- Actions: relative same-origin navigation, click, fill, select, check/uncheck,
  bounded key press, hover, and observable expectations.
- Values: bounded literals or named profile references resolved locally.
- Every checklist item appears exactly once.
- Every item starts with a relative navigation step and contains at least one
  expectation.
- CSS, XPath, JavaScript evaluation, shell commands, absolute navigation, and
  arbitrary Playwright APIs are not part of the schema.
- Step timeouts are bounded. The Runner also blocks top-level cross-origin
  navigation and checks the current origin after every step.

The API validates checklist evidence against the chosen public profile before
accepting or generating a Recipe. Each execution item exposes one or two
supported `TEXT`/`SCREENSHOT` requirements; required unsupported evidence is a
hard error rather than silently weakened proof.

## Approval And Execution Lifecycle

Checklist generation/review and Recipe generation/review are asynchronous.
They are queued through `QaGenerationExecution`; web, REST, and MCP callers
receive durable operation receipts and poll them instead of holding a provider
request open. The worker uses leases, bounded retries, and terminal failure
states; this is not a claim that every provider-side effect is atomic.

```text
Recipe generation or submission
  -> PENDING assessment
  -> PASSED | SUGGESTIONS | FAILED

Owner approval
  -> QUEUED
  -> CLAIMED (opaque, hashed lease token)
  -> RUNNING (heartbeat renewals)
  -> SUCCEEDED | FAILED | CANCELLED
```

Starting a Playwright run validates all of the following in one transaction:

- the current optimistic QA Request version;
- the owner-selected locked checklist;
- the exact Recipe id and SHA-256 hash;
- a completed, non-failed Recipe assessment;
- an online compatible Runner registration;
- the exact unchanged public profile-manifest hash; and
- an additional owner confirmation for a `PRODUCTION` profile.

Production has a second independent local gate: the Runner must also be
started with `--allow-production`. A web confirmation alone cannot make a
default Runner execute against production.

Claim, reclaim, and acceptance revalidate the immutable Recipe profile against
the exact authorization and job hashes, including production confirmation.
The current registration is a compatibility check, never the source of the
approved task profile. Changing or removing that profile after approval fails
the job, cancels its run, and returns the request to `READY_TO_RUN`; it cannot
silently redirect a TEST approval to a PRODUCTION profile.

Recipe deduplication includes both the canonical step-bundle hash and public
profile-manifest hash within the checklist artifact. Identical steps for a
different profile create a new immutable revision with its own review. The
`20260911000100_bind_recipe_identity_to_profile` migration updates this unique
index without rewriting existing Recipe ids, hashes, assessments, or approvals.

The Runner claims only jobs assigned to its registration, accepts the lease,
heartbeats while active, records one versioned result per checklist item,
uploads screenshot evidence through the private-asset pipeline, and finishes
the run. Lease tokens are returned once at claim time; the database stores only
their SHA-256 hashes. The API caps every lease at the job deadline, and a stale
or deadline-expired lease cannot record results or finish a run. Runner polling
atomically terminalizes deadline-expired jobs and jobs whose final reclaim
attempt expired, returning the request to `READY_TO_RUN` instead of leaving it
permanently stuck in `RUNNING`.

Failure and cancellation preserve the partial results and workflow history,
cancel the run, and return the request to `READY_TO_RUN`. Human Review remains
owner-only and approves the QA record, not a release.

Generic web/REST/MCP result and finish operations cannot mutate Recipe-bound
runs (`QA_EXECUTION_PROTOCOL_REQUIRED`). While such a run is CREATED or ACTIVE,
evidence also requires the assigned Runner protocol and lease. Evidence may
still be supplemented after RESULTS_SUBMITTED under the normal current-run,
evidence, and Human Review guards. Connected-agent runs without a Recipe retain
their existing generic lifecycle.

## Local Runner Setup

1. For first-time setup, in the QA Workspace open **Connect an agent**, select
   **Playwright Runner**, create a token, and copy it immediately. Reuse an
   existing valid Runner token when restarting; an offline status alone does
   not require a new connection.
2. If no local config exists, copy `apps/runner/oddpath.runner.example.json`
   to `apps/runner/oddpath.runner.json`. Do not overwrite an existing profile
   merely to restart its Runner.
3. Set the profile `baseUrl`, environment kind, evidence capabilities, and
   local values. Prefer `source: "env"` for credentials.
4. Set the copied token and every referenced value in the same terminal that
   starts the Runner. PowerShell `$env:` values belong to that process and its
   children; setting them in the API terminal does not configure another one.
5. Install only the browser engine configured by the profile, then start the
   Runner:

```powershell
$env:ODDPATH_RUNNER_TOKEN = "odp_live_replace_me"
$env:ODDPATH_TEST_CUSTOMER_EMAIL = "qa-user@example.test"
npx playwright install chromium
npm run dev:runner
```

The local config and resolved environment values are never returned by Runner
registration. `oddpath.runner.json` is ignored by Git because literal values
may still contain test credentials.

Keep API, web, and Runner running in separate terminals. Wait for
`Oddpath runner <instanceId> is connected.`, then refresh the profile in
**Run with Playwright**. A saved connection/profile is not a running process:
the profile must be online before an execution can be approved. Review the
Recipe and check its exact-run approval box before **Approve & queue run**.
Do not regenerate or re-review an already PASSED Recipe merely because the
Runner was offline. Never paste a token into chat or diagnostic screenshots.

## HTTP Surfaces

Owner routes are under `/api/projects/:projectId/qa`:

- `GET /runner-profiles`
- `GET /requests/:requestId/execution-recipes`
- `POST /requests/:requestId/execution-recipes/generate`
- `GET /requests/:requestId/execution-recipes/:recipeId`
- `POST /requests/:requestId/execution-recipes/:recipeId/review/retry`
  with `{ "assessmentId": "<latest-failed-assessment-id>" }` returns `202`
  and `{ operation }`. This is an owner-session/CSRF-protected route, not an
  agent or Runner capability.
- `POST /requests/:requestId/runs` with `executionMode: "PLAYWRIGHT"`
- `POST /requests/:requestId/runs/:runId/cancel`

Runner routes are under `/api/integrations/v1/runner/v1` and require a
project-bound Runner connection:

- `PUT /registration`
- `POST /executions/claim`
- `POST /executions/:executionId/accept`
- `POST /executions/:executionId/heartbeat`
- `PUT /executions/:executionId/items/:checklistItemId`
- `POST /executions/:executionId/evidence/uploads`
- `POST /executions/:executionId/evidence/uploads/:assetId/complete`
- `POST /executions/:executionId/finish`
- `POST /executions/:executionId/fail`

Result, finish, failure, and evidence-upload mutations require an
`Idempotency-Key`. Known responses and domain failures replay exactly. An
unknown outcome stays fenced as `IDEMPOTENCY_IN_PROGRESS` instead of risking a
duplicate protocol mutation. This receipt boundary does not make browser-side
effects in the target application atomic.

## Connection Presets

- `AGENT`: `qa:read`, `qa:write`, `evidence:write`
- `RUNNER`: `qa:read`, `execution:claim`, `execution:write`, `evidence:write`

The API also accepts explicit scopes, but a request cannot combine a preset
with an explicit scope list. Route middleware keeps the two roles separate.

The stateless MCP surface exposes 12 tools: the original request, checklist,
run, result, and evidence operations plus asynchronous-operation lookup and
immutable Execution Recipe list/get/submit operations. The exact table stays
in `docs/QA_CONTROL_PLANE.md`; MCP intentionally has no Playwright approval or
Human Review tool.

## Provider Neutrality

Checklist generation/review and Recipe generation/review call the injected
`AiProviderAdapter.generateText` boundary and use separate usage actions.
Gemini is the only configured runtime text provider today, but neither the QA
domain nor Recipe/Runner contracts depend on a Gemini request or response
type. A future provider is added through the existing registry and usage
boundary rather than by rewriting the harness.

### Recipe Output Validation And Diagnostics

The generation prompt includes a complete output envelope and typed examples
for every RecipeV1 action, locator, value source, and expectation variant.
Tests validate those examples against the shared API/Runner schemas. Checklist
item IDs, unique step references, nested expectations, and declared profile
keys are explicit requirements; examples are syntax guidance, not extra tests.
The API still validates output strictly before storing a Recipe, and owner
approval is still required before any Runner execution.

Recipe review also requests provider-native structured output through the
optional, provider-neutral `responseJsonSchema` field. The Gemini adapter
passes that JSON Schema together with JSON MIME output. Concrete review
examples require `suggestions` to be an array: `[]` for `PASSED`, or at least
one finding for `SUGGESTIONS`. Local Zod validation remains authoritative;
missing, null, string, or object suggestions are never converted to a pass.
The provider schema deliberately omits `suggestions.maxItems`; the local
Zod schema still enforces at most 80 findings and all string-length limits.
On 2026-09-09, a user-authorized synthetic Gemini 3.1 Flash-Lite comparison
reproduced HTTP 400 with the native `maxItems: 80` and succeeded when only
that keyword was removed (35 reported input tokens, 18 output tokens).
All other request settings and structural schema constraints were identical.
This confirms the compatibility issue for this schema/model combination,
not a general claim that Gemini never supports `maxItems`.

Invalid JSON or schema-invalid provider output is classified as
`QA_RECIPE_OUTPUT_INVALID` for generation or `QA_RECIPE_REVIEW_INVALID` for
assessment. The worker retains its existing bounded retry policy and logs a
`qa_processing_output_invalid` event containing the operation ID, kind,
attempt, error code, and sanitized issue codes/field paths. Diagnostics are
limited to 16 issues and 12 path segments with allowlisted field names. Raw
provider output, issue messages, unexpected property names, nested union
errors, profile values, and exception stacks are not logged or retained by
this diagnostic path. Provider/usage failures keep their original codes.

On 2026-09-07 the local login-page smoke reached an online Runner and a
selected generated checklist, but Recipe generation failed after three
provider responses with the previous generic `QA_PROCESSING_FAILED` code.
No Recipe or Run was created. The incomplete prompt and unclassified output
validation were corrected on 2026-09-08; the original rejected responses were
not retained, so their exact invalid fields cannot be reconstructed.

For an existing failed generation with no Recipe, keep the same QA Request,
checklist, and Runner connection. After loading the fixed API, open
`Run with Playwright`, choose the online profile, and use `Generate with
Oddpath` once. This creates a new generation operation; it does not rewrite
the historical failure or start a browser Run. Inspect and approve the new
Recipe before queueing execution.

The user's subsequent live generation succeeded and stored Revision 1 (five
checklist items, twelve actions), but its review failed with
`QA_RECIPE_REVIEW_INVALID`: the bounded diagnostic was `invalid_type` at
`$.suggestions` on all three attempts. The exact returned value was not
retained. Generating the same Recipe again deduplicates by hash; it does not
retry a failed assessment.

### Recovering A Failed Recipe Review

Keep the existing QA Request, checklist, Recipe, and Runner connection. Open
`Run with Playwright`, select the failed Recipe revision, and choose
`Retry review` once. A Runner need not be online to review its stored public
profile. Execution still requires an online compatible Runner and separate
explicit owner approval after review completes.

The retry targets the exact latest failed assessment and selected checklist
in a runnable request. A request-row lock serializes retries. Duplicate or
concurrent clicks for that failed assessment replay one operation, including
after it completes. A subsequent failed assessment can be retried explicitly
as a new intent. The transaction appends a new PENDING assessment, operation,
and history event; it never changes the immutable Recipe/hash/profile or the
previous failure. Old worker leases cannot complete or fail the new review.
Approval remains blocked while a review is FAILED/PENDING/processing.

The user retried the real review after the initial repair and received
`AI_PROVIDER_REQUEST_REJECTED`. Across the following diagnosis, three
explicitly authorized, one-request synthetic probes were made; the first
SDK retry configuration hid the HTTP error body, the second exposed a
generic HTTP 400, and the third isolated `maxItems: 80` as above. Each used
a 256-output-token cap and no project content. These probes did not requeue
the real review or execute the browser smoke. The owner subsequently retried
the same Recipe and completed the live path described below; no further
retry is needed for that approved record. Do not infer end-to-end success
from a schema probe alone.

## Local TEXT Smoke Checkpoint — 2026-09-09

Evidence source: the user's screenshots and manual validation in the task,
not an independent agent rerun or a fresh database audit.

- `Login page — browser smoke test` retained Recipe Revision 1 (five checklist
  items, twelve actions), and the same-Recipe review reached PASSED.
- After starting the existing local Runner, the owner approved the exact
  execution. Playwright reported execution complete, recorded the results and
  TEXT evidence, and handed the request to Human Review.
- Welcome heading, Email/Password visibility, Email value persistence, and the
  disabled Google sign-in button each passed. Visibility of the deliberately
  absent `Oddpath smoke marker` heading failed as intended: four PASS, one
  FAIL, with the evidence gate COMPLETE.
- The owner selected **Approve QA record**. The final screenshot shows
  APPROVED with 1 approved, 0 running, 0 evidence needed, and 0 ready. This
  approves the accuracy of the QA record, not the product release, and does
  not turn the intentional FAIL into PASS.

This closes the local TEXT-evidence happy-path/intentional-assertion-failure
smoke. Preserve its immutable records and failed-review history. Do not
recreate tokens, run migrations, spend more provider calls, or repeat this
approved request just to close out the phase.

The closeout UI work and its automated verification are recorded separately
below; they do not replace this manual smoke evidence.

This run did **not** validate real SCREENSHOT/private uploads, manual Runner
interruption/recovery, a manual Request changes/re-run cycle, other clients
or providers, or staging/production operation. Existing automated coverage
(including the 2026-09-08 PostgreSQL 16/16 checkpoint) remains separate proof.
The historical 2026-09-09 full `verify` passed 1090 tests (824 API, 247 web,
4 shared contract, 15 Runner); release checks still need Node >=24.19.0 <25
instead of the installed 24.15.0 used for that checkpoint.

## Closeout Verification — 2026-09-10

- The Run dialog explains saved connections versus live Runner heartbeats,
  reuses the existing local configuration/token, and makes clear that Refresh
  reads status rather than starting a process. An offline reviewed Recipe is
  not automatically regenerated or executed.
- One ordered set of approval gates drives the disabled queue button and its
  accessible explanation. Failed/pending reviews, incompatible/offline profiles,
  missing confirmation, and the separate production confirmation remain fenced.
- The workspace shows current processing separately from collapsible earlier
  attempts. Active receipts stay visible, review targets stay separate, and
  historical failures retain their status and error code without being labeled
  as a new failure or an unproven recovery. New UI copy is in en/ar/de catalogs.
- Full `npm run verify` returned exit 0, including 261 web tests, API/shared
  contract checks, and Runner checks. Focused web/i18n tests passed 46/46.
  Three new injected-fake Runner cases passed (execution tests 6/6): later
  screenshot capture failure after one acknowledged TEXT submission, lease
  expiry before the next item, and heartbeat lease loss during a TEXT item.
  They assert no finish or further result submission and session cleanup.
- `npm run build:web` passed with an ephemeral
  `VITE_API_BASE_URL=https://api.oddpath.invalid` verification origin;
  `git diff --check` passed. Installed Node remained 24.15.0; the declared
  release-runtime requirement is still outstanding.

No live provider calls, application-database writes, migrations, new tokens,
or repeated approved runs were used. The disposable PostgreSQL suite was not
rerun for this frontend/test-only closeout. No new authenticated browser
visual pass was performed. Persisted partial evidence after cancellation,
actual process-kill recovery, screenshot-upload interruption/cancellation,
and a Playwright-specific Request changes/re-run drill remain separate tests;
the fake-client cases do not establish those claims.

## Verification

```powershell
npm run check:execution-contract
npm run test:execution-contract
npm run check:runner
npm run test:runner
npm run check:api
npm run check:web
```

Database verification must use a disposable database. Apply every committed
migration, run `db:drift:check`, then run `test:integration:db` with the
existing explicit disposable-database guard. The PostgreSQL suite includes a
real `claim -> accept -> result -> finish -> project deletion` lifecycle.

## Current Limits

- The first Runner processes one claimed job at a time.
- Automatic expired-job reconciliation is claim-time and bounded; it requires
  an assigned Runner to poll. Owner cancellation remains the immediate escape
  hatch when no Runner is online.
- A reclaimed job may repeat already-recorded browser steps; version checks,
  leases, and required idempotency fence protocol writes, but cannot make
  repeated browser-side effects atomic. Target environments should use
  disposable or independently idempotent test data.
- Browser screenshots can contain application data. Treat them as private QA
  evidence and configure retention accordingly.
- Ambiguous idempotency records are conservatively fenced; automatic
  reconciliation is not implemented yet.
- QA records are not yet included in Project or Account portable ZIPs.
- The Runner is local CLI infrastructure; packaging/signing it as a separately
  distributed executable is future work.
- The harness has not completed the staging, production smoke, backup/restore,
  rate-limit, and operational gates in `docs/PRODUCTION_READINESS.md`; its
  existence is not a production-readiness claim.
