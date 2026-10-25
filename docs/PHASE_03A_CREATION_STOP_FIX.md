# Phase 03A — pending Docker creation and confirmed Stop

Date: 2026-10-12. **Implemented and locally verified; independent re-review pending.** Public beta remains NO-GO. Saved login 3B is not started.

## Problem and behavior

API registration precedes physical creation. Previously, an independent reaper could observe no containers during an in-flight Docker create, store STOPPED and post STOP_CONFIRMED, then the worker could create Chrome afterwards. allocate returned a STOPPED row and repeated Stop reused an obsolete proof. The independent PostgreSQL/SQLite/Docker review reproduced this ordering.

The SQLite journal now reserves a unique allocationOwner before the API registration callback. This persistent fence covers both pending registration and the entire physical start operation. Only the creator releases it after its awaited operations settle, or atomically while establishing LIVE. Stop still requests STOPPING and performs best-effort physical cleanup, but refuses to confirm or produce a reportable proof when the observed allocation has an unsettled creator. A fresh physical observation after settlement is required. Lease expiry cannot release the fence or promote an allocation to LIVE.

The Docker driver checks current allocation authority before and after every startup command and endpoint/readiness await. A command already in flight may finish after Stop; subsequent startup operations are refused, its resources are cleaned, and allocation rejects. journal.live samples a fresh clock after acquiring the SQLite writer, checks exact creator/state/lease/deadline/preparation authority and clears the fence in the same transaction. allocate also checks the final live lease before returning.

SQLite adds one nullable allocationOwner column without discarding historical rows. PostgreSQL/API contracts, QA cancellation/history, current session and QA controller remain unchanged. The five changed source/test files are journal.mjs, supervisor.mjs, docker-driver.mjs, supervisor.test.mjs and docker.integration.mjs.

## Unsettled operations and recovery

The fence is not a lease and has no automatic expiry. A creator process crash, or a Docker mutation timeout/signal/transport failure whose outcome is unknown, remains STOPPING/unconfirmed even when current inspection finds no containers. Recovery cleans resources best-effort and refuses confirmation/new allocation while this fence remains. It must not reset the marker merely because the process restarted, time elapsed, or Docker currently reports absence.

This is an intentional availability tradeoff: ambiguous startup requires operator investigation and proof that the old creator and outstanding Docker operations have settled before releasing its fence. No automatic recovery or public operator reset endpoint is certified by this repair. The deployment runbook for that intervention remains a launch gate. Successful/known-settled startup failures and normal Stop automatically clean up and confirm through the current reaper. Deploy supervisor and reaper together after draining old allocations; mixed old/new startup code does not provide this fence.

## Validation

- Full verify: **1809/1809** (contract34, API1040, Runner33, web639, runtime63).
- Disposable PostgreSQL: **90/90**, 26 migrations, no schema drift.
- Complete real Docker suite: **21/21**, including network-create and already-running Chrome/service-readiness Stop races with two supervisors and a real shared SQLite journal. All previous noVNC/MFA, capture denial, handoff, crash, lease/deadline and isolation cases remain included.
- The independent combined PostgreSQL/SQLite/Docker reproduction now verifies: job CANCELLED, API STOP_REQUESTED and no local proof while creation is pending; late allocation rejects and resources are absent; API STOP_CONFIRMED only afterwards. Post-cancellation accept remains rejected.
- Six added unit cases exercise pending registration/creation Stop, expiry after start wait, retained ambiguous mutation authority, journal reopen/recovery and Docker mutation timeout handling.
- **59** source/compiled module comparisons match the pinned images; unchanged Chrome/egress images are retained, and the updated supervisor is tagged phase-03a-stop-fix (with local test phase-02/phase-03a aliases).
- Fixture containers/networks/controllers/databases are removed and the working PostgreSQL remains healthy. git diff --check passes.

See evidence/phase-03a/creation-stop-fix/validation.json for exact source/image/log hashes and sanitized fixed-case evidence. Prior implementation and independent review ledgers remain historical. No working database migration, deployment, commit/push, paid AI or feature activation occurred. This slice fixes one review finding; it does not close 3A or approve 3B, public beta, full authenticated UI/API/Runner journeys or provider-specific sign-in compatibility.
