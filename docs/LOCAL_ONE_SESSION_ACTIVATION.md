# Local one-session timeline activation — 2026-10-04

The owner explicitly approved a backup and activation of
`20261003090000_unified_session_timeline` on the working local database.
This does not authorize deployment, commit/push, a provider request, another QA
run or changes to the previously approved QA record.

## Preflight and private backup

- Exact target: `ai-qa-assistant-postgres`, PostgreSQL **16.14**, local port
  **5432**, database **ai_qa_assistant**. Exactly 22 completed migrations existed;
  the only pending migration was the approved timeline migration.
- Stopped the verified API/watch process pair temporarily. Vite was left running.
  PostgreSQL reported zero other clients before snapshots/activation.
- There were no pending/processing turns, generation/execution/email jobs or
  active runs/preparations. Existing failed generation attempts stayed failed;
  they were not retried. This matters because old PROCESSING turns would receive
  a null provider-start marker and cannot safely be auto-resumed by inference.
- Retained archive: `work/local-db-backups/pre-one-session-20261004.dump`,
  **237,951 bytes**, PostgreSQL custom format. SHA-256:

  `9f90a8e8acc8619028bcf62fb7f6bc5669fe60b5e5b4cd639d9431eea21a6fb9`

The backup directory remains excluded from Git and protected by a non-inherited
Windows ACL granting the owner account, SYSTEM and Administrators access. The
archive inherits these restricted permissions. It is **not encrypted**; never
publish or commit it. This is a local database backup, not an off-device backup,
cluster-role backup, external object-storage copy or production PITR validation.
No credentials or application `.env` files were changed.

## Restore rehearsal and preservation proof

Restored the archive with `pg_restore --exit-on-error --single-transaction` into
`oddpath-timeline-restore-20261004`, a disposable PostgreSQL container on
**127.0.0.1:55441**, with a random private password and tmpfs data directory.
The original database was never a restore destination.

Fingerprints include **all 47 application tables**, including existing
TestSession/Turn/Preparation records, Chat kind and QA session links. Only
`_prisma_migrations` bookkeeping and the five newly introduced columns are
excluded from original-row comparisons:

- Chat: `nextTimelinePosition`.
- Message / QaWorkflowEvent: `timelinePosition`.
- TestSessionTurn: `providerStartedAt`, `lastRetryKey`.

The restored pre-migration data matched the original baseline exactly. Applied
only the approved migration to that copy, checked zero schema drift, original
row fingerprints/statuses and original migration names/checksums/states, and
ran a worker-disabled read-only API smoke. A second comparison after that smoke
still matched. Old activation helpers were not reused unchanged because they
excluded data which must now be preserved.

## Working database activation and checks

Recompared the working database immediately before applying. All original data
still matched the protected baseline. Prisma `migrate deploy` applied only
`20261003090000_unified_session_timeline`.

Results:

- **23 migrations applied**, schema up to date, **zero drift**.
- **All 47 original-table row counts/fingerprints identical**, before/after
  migration and after the read-only API probes. Existing IDs, text, timestamps,
  QA outcomes, evidence and human approvals were not rewritten.
- Timeline positions match the migration's deterministic original-date/source/
  sequence/ID ordering; counters match max+1 (empty session = 1). Linked events
  have their expected position; unlinked events remain null. Both new turn
  markers initialize null. All five mismatch checks returned **0**.
- The six liveness/security/readiness/registration/auth-boundary/CSRF smoke
  checks passed. The shared `/api/sessions` route correctly returned anonymous
  **401**. Generated-client reads of all newly introduced columns succeeded.
  No auth session was fabricated and no provider or Runner request was sent.

Original `PROCESSING` turns would require separate explicit recovery handling;
none existed here. The old completed turns, READY preparation, submitted runs,
successful execution jobs and failed generation attempts retained their states.

Private reports are beside the backup: `timeline-before-20261004.json`,
`timeline-restore-before-20261004.json`, `timeline-restore-after-20261004.json`,
`timeline-restore-after-probe-20261004.json`,
`timeline-working-pre-apply-20261004.json`, `timeline-working-after-20261004.json`
and `timeline-working-after-probe-20261004.json`. They contain counts/hashes,
not transcript bodies. Operator helper: `work/local-db-activation/timeline-activation.mjs`.

## Cleanup and handoff

The restore container and temporary dump copies were removed after confirming
their exact identities and rechecking the retained archive checksum. Disposable
restore data can be recreated from the retained archive; the working database
and retained backup were not removed.

Restarted the built development API on **127.0.0.1:5000** using
`work/local-db-activation/serve-local.mjs`. QA/session workers retain configured
behavior; no pending work existed to resume. Vite remains at
**127.0.0.1:5173**. These are development processes, not persistent services.
The launcher uses built code; rebuild/restart after future backend source edits.
After restart, `/api/health` and `/api/health/ready` returned **200**, readiness
reported database `ok`, and the existing web server returned **200**. Session
worker polls no longer reported the missing-column error.

Activation resolves the missing `TestSessionTurn.providerStartedAt` column.
A fresh authenticated conversation → QA → later-report journey and unassisted
first-user UX validation are still separate acceptance checks. Do not rerun or
rewrite the real approved historical QA request to perform them.

No commit, push or public deployment.
