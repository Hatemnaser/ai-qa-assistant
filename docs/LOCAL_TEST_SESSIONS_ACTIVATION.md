# Local Test-session database activation — 2026-09-25

The owner explicitly approved a local database backup, migration and subsequent
local verification. This is not production deployment, a commit/push request, or
permission to change an existing approved QA record.

## Target and preflight

- Verified Docker container: `ai-qa-assistant-postgres`, PostgreSQL 16.14,
  database `ai_qa_assistant` on local port 5432. Application configuration used
  the existing local default; operator commands explicitly confirmed this target.
- No API/Runner was listening and PostgreSQL reported no other database clients
  during preflight. No pending/processing QA generation, execution or email jobs.
- Exactly one pending migration: `20260922090000_add_test_sessions`; previous
  21 migration records were applied without failed/unresolved entries.
- Migration is additive: Chat kind defaults to `CONVERSATION`, existing QA session
  links default to null, and three new session tables/indexes are created. No
  existing request, result, Recipe, review or approval is rewritten.

## Retained private backup

Archive: `work/local-db-backups/pre-test-sessions-20260925.dump` (214,302 bytes),
PostgreSQL custom format, generated with `pg_dump` 16.14. SHA-256:

`b4a8e89ff03fe7d0f5be977bf78ba1f27bbc3459f64c72c1a8d3032ed5c83321`

The directory is excluded in the root `.gitignore` and contains an additional
ignore-all file. Its Windows ACL disables inherited access and grants access only
to the owner account, SYSTEM and Administrators. This is access-controlled, **not
an encrypted archive**. It contains private database data and must not be shared
or committed. Fingerprint reports alongside it contain counts/hashes, not row
contents. No credentials or `.env` files were changed.

This is a database-only local backup. It is not an off-device backup, PostgreSQL
cluster-role backup or external object-storage backup. No external assets were
copied. Do not mark production backup/PITR/restore requirements complete from it.

## Restore rehearsal before changing the original

1. Restored the archive with `pg_restore --exit-on-error --single-transaction` to
   a new PostgreSQL 16.14 container, bound only to `127.0.0.1:55440` with a random
   password. The original database was never used as a restore destination.
2. Read-only repeatable-read snapshots compared sorted row fingerprints for all
   44 existing data tables: original and restored copies matched exactly.
3. Applied the pending migration to that restored copy with Prisma `migrate
   deploy`; checked zero schema drift and unchanged original-row fingerprints.
4. Started the built API temporarily on an ephemeral loopback port with workers
   disabled and SMTP set to noop. Six HTTP checks and generated-client reads
   passed against the restored migrated database.

This verifies archive restorability, relational contents and API/schema
compatibility; an authenticated provider/Runner journey was not part of this
rehearsal and broader production restore acceptance remains separate.

## Original database migration and verification

- Recompared the original DB to the pre-backup fingerprint immediately before
  applying; all original data still matched.
- Applied only the pending Test-session migration via `migrate deploy`.
- Prisma migration status: **22 applied, up to date**. Schema diff: **zero drift**.
- Before/after comparison: **all 44 existing data tables identical**, including QA
  requests, artifacts, Recipes, execution jobs, results, evidence and human review.
  Only the newly added `Chat.kind` / `QaRequest.testSessionId` columns are excluded
  from original-row fingerprints; their expected defaults were checked separately.
  Migration bookkeeping is expected to change and is not treated as user data.
- All 11 existing Chats remain ordinary conversations; original QA links remain
  null; Test-session, turn and preparation tables are empty.
- Six real HTTP smoke checks passed: liveness, security headers, DB readiness,
  registration configuration, unauthenticated access boundary and CSRF issuance.
  The expected anonymous 401 is a successful authentication-boundary check.
- Generated Prisma reads for projects, chats/messages, documents/memory, QA
  requests/reviews and new session tables passed. Fingerprints still matched after
  these probes. No auth cookies, provider requests or Runner execution were used.

Local operator helpers are in `work/local-db-activation/`. They enforce exact
loopback database identities; they are not production migration scripts. Private
reports: `before-20260925.json`, `working-pre-apply-20260925.json`,
`working-after-migration-20260925.json`, `working-after-probe-20260925.json`, and
the two restored-copy comparisons in the protected backup directory.

## Cleanup and handoff

Removed only the verified temporary restore container and its anonymous volume,
plus the temporary dump copy inside the original container. The retained Windows
backup checksum was verified again. The original PostgreSQL container remains
running and healthy. Removing those temporary copies is recoverable by restoring
the retained archive into another disposable environment; never restore over the
active database by default.

Started the built local API on **127.0.0.1:5000** using the loopback-only development
launcher `work/local-db-activation/serve-local.mjs`, retaining configured worker
behavior. Started Vite on **127.0.0.1:5173**. Readiness returned HTTP 200 with database
OK. No pending work existed to resume at startup. The launcher uses the built API:
rebuild/restart it after backend edits rather than expecting watch-mode reload.
These development processes are not persistent services across app/host restarts.

Opened the real local sign-in page in the in-app browser and left it for the owner
to sign in privately. No password was requested or extracted and no auth session
was fabricated. At this activation handoff, authenticated validation awaited owner
sign-in. The later live follow-up is recorded in `TEST_SESSIONS_LIVE_CHECKPOINT.md`:
owner sign-in and a new real discussion/preparation succeeded; on 2026-09-26 the
owner also completed Runner execution and final-record approval. This later live
journey is separate from the migration-only evidence above. Preserve decisions; do not
repeat preparation or use the historical approved record as a fixture.

No commit, push, public deployment, real QA run or real AI request occurred during
this activation. Previously passed implementation verification is recorded in
`TEST_SESSIONS_CHECKPOINT.md`; it was not needlessly rerun for this schema-only
activation.
