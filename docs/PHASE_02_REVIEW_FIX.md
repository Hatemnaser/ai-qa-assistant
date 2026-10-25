# Oddpath stage 2 review repairs

Date: 2026-10-11. Status: **REPAIRS IMPLEMENTED, PENDING INDEPENDENT RE-REVIEW**.
Scope: the four owner-selected stage-2 findings. Existing session, QA controller,
approved recipe, no-replay fences and production activation gates remain intact.
Changes remain local in the stage-1/2 worktree; public beta remains **NO-GO**.
The original `evidence/phase-02/validation.json` is historical. Fresh results and
source fingerprints are in `evidence/phase-02/review-fix.json`.

## R1 — project-bound v2 registration receipt

The shared contract now defines a strict `runnerRegistrationReceiptV2Schema`
with v2 profiles and the authenticated `projectId`. The API validates its reply
against that contract; the managed client parses it as v2. V1 retains its exact
reply shape. The supervisor's registration/claim sequence uses
`claimManagedExecution`, which refuses a project mismatch before claiming work.
The HTTP parser distinguishes validated output types from raw JSON inputs,
including target fields normalized by schema defaults.

Maintained verification uses the current API service, injected repository,
real current-source HTTP client and the actual supervisor registration/claim
helper. It reaches a v2 claim with the returned registration identity and
blocks a mismatched project before claim. HTTP tests reject v1, missing-project
and extra-field receipts. API tests preserve legacy compatibility.

## R2 — fresh journal lookup before orphan Stop

The reaper no longer retains an allocation snapshot across Docker enumeration.
For every listed runtime it queries the current SQLite association immediately
before treating it as orphaned. Workers reserve the runtime identity before
creating Docker resources, and runtime identities are never reused.

Deterministic tests use two connections to the same real SQLite file. A worker
reserves/creates a STARTING or LIVE allocation while enumeration waits; both
remain active, while a genuinely unknown runtime is stopped. Existing orphan
container/network cleanup and no-replay tests still pass.

## R3 — expired authority cannot be renewed

The runtime lease handler checks closing state, its existing lease and immutable
deadline using a fresh decision time before accepting any proposal. Requests at
the exact expiry are rejected. An expired runtime starts closing immediately;
health reports STOPPING and new CDP/viewer requests or upgrades are refused.

The supervisor checks the durable lease before renewal and after each awaited
endpoint/HTTP operation. SQLite renewal is one conditional update requiring a
live state, unexpired previous lease/deadline and bounded future proposal. A
late successful HTTP reply cannot revive durable authority. Renewal failure
requests physical Stop; unavailable Docker retains STOPPING without inventing
termination proof.

Controlled-clock tests execute the actual runtime module with inert OS adapters
before its watchdog tick. They cover early renewal, late/exact expiry, closing,
hard deadline and invalid proposals. Supervisor tests cover expiry during
endpoint/HTTP waits and concurrent Stop. Real Docker checks independently
verify physical lease-watchdog and immutable-deadline termination.

## R4 — renderer failure is execution failure

Managed Playwright sessions track page crash/close, context close and browser
disconnect. Their health assertion runs around recipe steps, before result
submission and before finish. A damaged session throws the sanitized
`BrowserSessionUnavailableError`, reported as `BROWSER_SESSION_UNAVAILABLE`.
Healthy assertion mismatches retain ordinary FAIL behavior. Legacy browser
factory behavior is preserved.

The real Chrome regression executes and acknowledges the first PASS with TEXT
evidence. During the second expectation, the assertion succeeds, then CDP
`Page.crash` kills its renderer while Chrome's version endpoint still responds.
Only the first PASS remains submitted, the execution reports infrastructure
failure, finish is never called and termination is requested. The injected
client verifies acknowledged submissions; it is not itself proof of database
persistence for a crashed renderer. The separate PostgreSQL suite validates
durable lifecycle behavior.

## Additional validation repair

The disposable schema drift check exposed existing stage-2 foreign-key metadata
drift. Prisma now explicitly maps `QaBrowserRuntime_execution_fkey` and its
`onUpdate: NoAction`, matching the existing migration and preserving execution
identity. No migration was rewritten or added, and no working database was
migrated. A fresh database with all 25 migrations reports zero drift.

## Fresh verification

- Required `npm run verify`: **1766/1766 PASS** — contract 33, API 1036,
  Runner 31, web 636, runtime 30; types, architecture and runtime syntax pass.
- After the metadata repair, API types/architecture and its production build
  were rerun successfully; Runner production build also passes.
- Guarded disposable PostgreSQL: **81/81 PASS** after all 25 migrations and
  zero drift, including prior approval/lease lock-wait regressions.
- Rebuilt Chrome/supervisor images; Docker/real Chrome: **11/11 PASS**,
  including renderer crash, namespace/seccomp sandbox, egress/tenant isolation,
  noVNC framebuffer, Stop, watchdog, deadline, process crash and orphan cleanup.
- Docker test timeout increased from 180 to 240 seconds to accommodate the
  additional renderer regression; assertions and runtime limits remain intact.
- `git diff --check` passes. Disposable fixtures are removed after verifying
  their identities; the existing application PostgreSQL remains healthy.

An initial local viewer test encountered sandbox loopback EACCES and passed
when rerun with appropriate local-network permission. Verification also caught
and repaired the HTTP schema input/output typing and the foreign-key metadata
drift. These are superseded by the passing checks above.

## Re-review and next boundary

Independently re-review all four repaired findings against this source snapshot,
especially the real registration-to-claim path, fresh journal association,
expiry after awaits and renderer-versus-assertion distinction. No independent
closure is claimed by these implementation tests. Stages 3-8 remain pending;
login/manual control, product tabs/resources, evidence/export, public routing,
quotas, host/budget proof and launch gates remain required before beta.
