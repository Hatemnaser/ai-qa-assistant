# Stage 2 — SQLite lock-wait renewal repair

Date: 2026-10-11. Status: **R3/P2 REPAIR IMPLEMENTED, PENDING INDEPENDENT RE-REVIEW**.
Scope: the owner-selected expiry race in `RuntimeJournal.renew`. The earlier
independent review passed R1, R2 and R4 within their selected findings and found
this remaining R3 variant. Public beta remains **NO-GO**.

## Change

`apps/browser-runtime/src/journal.mjs` now acquires SQLite's write lock with
`BEGIN IMMEDIATE` before sampling the decision time. The proposal bounds,
previous lease, immutable deadline and LIVE/EXECUTING state are validated by
the conditional update inside that transaction. Successful renewal commits;
failed validation rolls back before the existing supervisor requests Stop.
An expired lease cannot be renewed using a timestamp captured before a
`busy_timeout` wait. A concurrent Stop cannot be overwritten.

This is the only production file changed since the preceding review snapshot.
The session, QA controller, prior stage-1 expiry repair and stage-2 R1/R2/R4
repairs retain their prior source hashes. No migrations or contracts changed.

## Maintained regression

`apps/browser-runtime/tests/journal-lock.test.mjs` uses a temporary real SQLite
file and a Worker holding a competing write transaction. A shared controlled
clock advances while that lock is held. The test observes whether renewal
sampled time before the competing writer released its lock. The production
journal and supervisor run unchanged, with inert HTTP/Docker adapters.

Seven cases cover exact and later lease expiry, valid renewal after waiting,
Stop committed by the other writer, hard deadline expiry, invalid-proposal
rollback and unavailable Docker after authority is lost. The expired lease
remains unchanged; Stop is requested, and termination proof is recorded only
when the driver confirms it. Failed renewal also leaves the connection usable
for the Stop transaction.

All seven tests failed against the previous implementation and pass after the
repair. They also pass inside the rebuilt Linux supervisor image, using real
SQLite locking on that platform. Physical Docker behavior is a separate check;
the regression's injected driver is not itself proof of physical termination.

## Verification and remaining viewer limitation

- Required `npm run verify`: **1773/1773 PASS** — contract 33, API 1036,
  Runner 31, web 636, runtime 37; types, architecture and runtime syntax pass.
- SQLite lock regressions: **7/7 PASS** locally and **7/7 PASS** inside the
  rebuilt supervisor image. Chrome and egress images are unchanged.
- Guarded disposable PostgreSQL: **81/81 PASS**, all 25 migrations applied,
  zero schema drift. The tmpfs fixture was removed; the application's normal
  PostgreSQL remains healthy and was not migrated.
- Docker/real Chrome full suite: **10/11 PASS on both attempts**. The unchanged
  owner-scoped noVNC framebuffer test exceeded its 15-second canvas wait, first
  during parallel verification and again after that verification finished.
  The same maintained viewer test passes **1/1 when run alone**, including
  framebuffer rendering and disconnect after physical Stop. A diagnostic copy
  also passed without capturing the failure. Its cause remains unestablished;
  neither focused pass certifies the full suite. No viewer code, assertions or
  timeouts were changed. Viewer startup reliability needs separate follow-up.
- The other ten Docker cases passed: sandbox, approved navigation, egress,
  renderer failure, tenant isolation, Stop, watchdog, deadline, process crash
  and orphan cleanup. This does not erase the viewer suite failure above.
- `git diff --check` passes. Test containers, networks and database fixtures
  are removed after verification; the working PostgreSQL remains preserved.

Fresh source hashes, sanitized results and local-log fingerprints are in
`evidence/phase-02/sqlite-lock-fix.json`. The preceding checkpoint and review
ledgers remain historical and unchanged.

## Next boundary

Independently review the lock acquisition, fresh time and conditional update in
one transaction, rollback before Stop, and the real SQLite Worker regression.
R3 is not claimed independently closed by implementation tests. Keep the viewer
full-suite timeout visible for follow-up. Stages 3-8 and all public-beta launch
gates remain pending; no publication, deployment or paid AI calls occurred.
