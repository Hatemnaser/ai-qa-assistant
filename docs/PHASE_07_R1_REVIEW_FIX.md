# Phase 07 R1 — committed QA state before deployment verification

2026-10-18. Status: implemented and locally validated, awaiting independent
acceptance. Phase 07 and public release are not approved by this repair.

The independent review proved False GO with real v2 result/finish writers,
PostgreSQL row-lock contention and HTTP. A writer computed submittedAt before
its UPDATE could complete; Readiness probed the version while that write waited,
then read the committed terminal run and incorrectly trusted its older timestamp.

Evaluation now has two short database transactions around one external probe:

1. Acquire the existing project/session/request/target locks. Read committed QA,
   candidate, target, ownership, artifact, results and evidence. Lock referenced
   assets in sorted order and refresh them, sharing the existing cleanup locks.
   Reject missing scope/mandatory risk overrides/limits. Only complete, eligible
   QA admits a probe. Return an internal preparation after transaction commit.
2. Perform the bounded, pinned HTTPS version probe with no database transaction
   or QA/asset lock held.
3. Reacquire the same locks, reread the same sources, compare exact fingerprints,
   and reevaluate policy with a fresh database clock. Changed content/revisions,
   a probe older than its preparation, or expired dependencies cannot yield GO.
   Save the snapshot in this transaction. Recheck expiry after INSERT, since the
   INSERT itself can wait; if a dependency expired, persist NO_GO before return.

The fingerprint includes scope, accepted risk policy, full frozen candidate,
target/environment/revision, ownership proof, selected artifact and criteria,
request/run revisions, results, provenance, evidence and asset availability.
Dates are normalized and nested collections have deterministic order. It is a
consistency check on trusted database state, not a signature or deployment
attestation. `sourceHash` and `preparedSourceHash` are optional snapshot fields
so older historical records remain readable; HTTP clients cannot supply them.

`EVALUATION_STATE_CHANGED` explains a changed source. No automatic retry of the
probe or QA execution occurs. A new explicit evaluation obtains a new committed
preparation and new observation. A matching observation from before preparation
is rejected even if the source content has not changed. No schema migration,
dependency, QA controller, run lifecycle or accounting change is introduced.
Known mismatches still invalidate durably before snapshot persistence. GO stays
separate from `historicalOnly=true` and `releaseAuthorized=false`.

The root regression was RED before the repair and GREEN afterward. Both runs
use the same NO_GO assertion and coordinate on a real database waiter, without
requiring the unsafe probe to occur to release the fixture's blocker. The new
maintained suite is part of `npm run test:integration:readiness`, sequentially
with the prior suite to isolate database failure triggers.

The previous completion-during-probe regression keeps its NO_GO and
DEPLOYMENT_BEFORE_RESULTS assertions. Its fixture now starts from completed QA,
then reopens/finishes during HTTP; an already incomplete run no longer enters the
probe. A separate test explicitly verifies zero external calls for that case.
No old security expectation was weakened.

Evidence directory: `work/phase-07-r1-fix-20261018/`. Preserve the independent
review directory and report unchanged. Final results and SHA inventory are in
`outputs/Oddpath_Phase_07_R1_Fix.md` and its evidence JSON under the task outputs
directory; the local ledger will point there after validation.

Local validation: 31 readiness PostgreSQL/HTTP cases (16 preserved and 15 new),
183 prior QA/evidence/accounting/financial HTTP regressions, populated migration
upgrade, real Chromium/Vue/HTTP, GO-history pg_dump/pg_restore and schema drift
all pass. Full verify passes 1,957 cases with one inherited Windows skip. Final
API/web builds pass. The original red regression and all failed/intermediate
attempts remain separate from final evidence. See `evidence/phase-07/r1-fix.json`.

Limits remain: a version document is operator-controlled, the decision is a
point-in-time observation, and a deployment may change after its response. This
repair does not claim continuous monitoring, cryptographic build attestation,
mixed-version rollout safety or a validated public hosting/TLS environment.
