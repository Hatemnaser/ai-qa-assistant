# Stage 1 review fix — expiration during lock waits

This follow-up addresses Astra's R1/P2 finding on V2 acceptance. The fix and
verification were complete at this dated repair checkpoint. Independent re-review
on 2026-10-11 closed R1/P2, with 30 focused regressions and 5 real PostgreSQL
lock-wait cases passing. Stage 2 subsequently started with owner authorization;
see `PHASE_02_CHECKPOINT.md`. V2 production activation remains blocked.

## Change

`qa-targets.execution.ts` now receives a clock function, so proof validity is
checked after the target lock and database reads complete. A returned proof is
checked again against the clock after its query returns.

`qa-execution.repository.ts` uses a shared V2 authorization recheck for claim
and accept. After target verification returns, one fresh decision time validates
the exact approval, proof, job deadline and lease. `acceptedAt` uses that same
time. Expired approval/proof/deadline failures are committed before returning no
claim or rejecting acceptance; they do not emit a new execution-start event.
Expired leases retain the existing lease-lost rejection behavior. Start also
rechecks proof validity at approval creation after its intermediate reads.

Application changes are limited to those two files. This patch adds no schema,
dependency, controller, UI or active browser runtime.

## Regression coverage

`qa-execution-expiry.test.ts` adds 11 deterministic tests: approval, proof and
job deadline expiration during both claim and accept target-lock waits; proof
expiration during its database read; valid claim/accept after waiting; and lease
expiration during acceptance. The suite was run against the unfixed code and
demonstrated the invalid grants, then passed after the repair.

`qa-targets.postgres.integration.ts` adds five real PostgreSQL concurrency
tests. A separate connection holds the target advisory lock. The test observes
the blocked application lock in `pg_locks` before advancing the injected clock
and releasing the holder. Four cases prove expired proof/approval cannot claim
or accept, and that terminal failure persists without a new claim/start event.
The control proves valid acceptance uses the fresh timestamp.

## Verification

- New deterministic suite: **11/11 PASS**.
- Guarded complete PostgreSQL suite: **71/71 PASS**, including all five new
  real lock-wait cases and the previous 66 cases.
- Source/test TypeScript checks: **PASS**.
- Full `npm run verify`: **1,718/1,718 PASS** — contract 33, API 1,031,
  Runner 18, web 636. Includes type checks and architecture boundaries
  (293 source files, 151 test files).
- `git diff --check`: **PASS**.

All database mutations use only `oddpath_expiry_test` in the disposable
`oddpath-expiry-test-20261010` container, bound to loopback port 55443 with
temporary memory-backed data. The temporary container was removed after checks;
the owner's normal database was not used. Sanitized results are recorded in
`docs/evidence/phase-01/review-fix.json`; raw logs remain under ignored `work/`.
No dependency/schema changes were made, so builds/audits/restore results from
the original checkpoint were not repeated or claimed as fresh checks here.

## Re-review

Read the original `Oddpath_Phase_01_Review.md` alongside this follow-up. Review
the two application files and both regression suites, focusing on clock reads
after waits, the consistent acceptance decision time, durable failure before
rejection, and preservation of V1 behavior. The original review remains a dated
record; this implementation report does not replace Astra's sign-off.

Worktree: `C:\Users\hatem\Documents\Codex\oddpath-foundation-phase-01`.
Branch: `codex/oddpath-foundation-phase-01`, base `08ae650`.
No commit, push, deployment or paid provider call is part of this fix.
