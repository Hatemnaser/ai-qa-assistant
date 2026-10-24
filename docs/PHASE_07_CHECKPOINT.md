# Phase 07 — release readiness

2026-10-18 closeout: Phase 07 received targeted independent acceptance GO after
the R1 repair. See [PHASE_07_CLOSEOUT.md](PHASE_07_CLOSEOUT.md) and
[Phase 08A inventory](PHASE_08A_READINESS_INVENTORY.md). Public release remains
NO_GO. The implementation/pending-review notes below retain their dated history.

2026-10-18 R1: the independent acceptance review returned NO_GO for a probe
starting before QA completion committed. The bounded repair now prepares a
committed source fingerprint before HTTP and checks it again before snapshot
persistence. See `PHASE_07_R1_REVIEW_FIX.md`. Independent acceptance remains
pending; the implementation validation below is historical.

Authorized locally on 2026-10-17 after Phase 06C GO. Status:
IMPLEMENTED_AWAITING_INDEPENDENT_ACCEPTANCE; independent acceptance is required. Public release
and Phase 08 are separate decisions and remain gated.

Implement frozen per-request candidate revisions binding the selected immutable
checklist and every criterion, exact target revision/environment/hash, declared
build reference and evidence freshness (default 24h, configurable 1–24h).
Replacement invalidates old candidates. Runs must start after the freeze.
Optional-risk decisions cannot waive mandatory criteria or global blockers.
One existing session and one existing QA controller remain authoritative.

The operator may configure deployment checking through the frozen candidate.
The target must expose `https://<target-origin>/.well-known/oddpath-version` as
`{"schemaVersion":1,"reference":"build-id"}`. The existing public-DNS-pinned,
TLS-validating, no-redirect HTTPS probe reads this bounded document without
cookies or application secrets. Initial proof before the run and fresh proof
after it must match. The post-test request must begin after the run and all
included results/evidence finish; a finish or correction during a probe/lock wait
requires re-evaluation. Missing/unavailable proof still permits QA reports,
but cannot yield verified-release GO. This trusts the target's version document,
not a signature or reproducible-build attestation. A mismatch permanently
invalidates the candidate; changing back requires a new freeze and new tests.

Snapshots distinguish global blockers and per-criterion missing/failed/blocked/
stale/unavailable provenance/evidence, with fingerprints and validity bounded by
every dependency. Deployment observations expire after five minutes, earlier
than the default evidence window. GET returns explicitly historical assessments;
only explicit evaluation probes deployment and recomputes source state. All
snapshots have `historicalOnly=true` and `releaseAuthorized=false`. There is no
automatic deployment, release approval or background promise of continuous
build monitoring. Re-evaluate before deciding to release.

Owner-only Web/HTTP routes:
`/api/projects/:projectId/qa/requests/:requestId/readiness` (GET/POST), and
`/:candidateId/evaluations` (POST). Auth/CSRF, bounded request limits, a maximum
20 candidates/request and 100 evaluations/candidate apply. Historical request
readers do not switch the QA controller's current request. No REST/MCP agent
can freeze criteria or accept human risks. Readiness JSON and QA/account/project
exports retain historical snapshots; imports never create executable candidates.
Request/project/account deletion cascades readiness rows.

Additive migration: `20261017000100_readiness_candidates`. Apply only to isolated
test databases during this slice. Required validation: strict contracts/policy,
owner/CSRF HTTP, real PostgreSQL lock waits/concurrent replacements/failures,
fresh and populated upgrade/restore, old auth/accounting/export regressions,
actual Vue/browser resource interaction and scope guards, full verify and builds.
Record final results and independent-review handoff before stopping the slice.

## Local implementation verification — 2026-10-17

18 policy/contract tests and seven Vue state/scope tests pass. A timing regression
first proved GO when deployment checking preceded run completion; the repaired
policy rejects it, and real PostgreSQL verifies a finish during the probe needs
a new check. The exact CI command `npm run test:integration:readiness` passes 16
cases. A populated upgrade preserves 58 old-table fingerprints; fresh migration
and schema-drift checks pass. Prior 06B/06C core/accounting/quota/auth/SMTP tests
pass 232 cases; with readiness and its upgrade the guarded total is 249, zero
FAIL/SKIP. Full verify: 1,956 PASS, zero FAIL and one inherited Windows journal
replacement SKIP. API/web builds pass. The new PostgreSQL suite is a sequential
CI gate; the GitHub-hosted run itself was not dispatched by this work.

Actual Vue/Chromium/HTTP/PostgreSQL verifies freeze -> GO -> JSON download,
historical-only reload -> changed-build NO_GO, plus Arabic/mobile rendering.
Version-document responses and executor records in that UI fixture are synthetic;
it does not certify a deployed application's endpoint/TLS/build truth. A real
pg_dump/pg_restore preserves frozen candidates and snapshot hashes without
release authority. Evidence and exact inventory: `evidence/phase-07/validation.json`.

No paid AI call, new dependency, working-database migration, deployment, external
SMTP send, subagent or additional model was used. Old Auth/usage/browser product
modules and their authority are preserved. Public activation remains NO_GO.
Next required step is independent adversarial acceptance of Phase 07, especially
freeze/probe timing, lock order/fresh clocks, stale sources, immutable history,
optional-risk boundaries, export/import inertness and rollout/migration.
