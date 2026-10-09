# Conversational Tests implementation checkpoint

Updated: 2026-09-26. Implementation, isolated verification and owner-approved local
database activation complete. Work remains
local on `main` at base `08c4f35`; no commit, push or deployment.

Live follow-up complete: owner sign-in, real provider preparation, exact-run
approval, one Runner execution and final record approval succeeded. Four checks
passed and the intentional fifth failure remains failed; five TEXT proofs are
stored. Reload preserved the approved record. Read `TEST_SESSIONS_LIVE_CHECKPOINT.md`
for exact evidence and limits; do not regenerate or rerun this completed test.

## Scope and safety boundary

This is the implementation of the owner's **Conversational Test sessions** plan,
following the earlier `TESTS_FOCUS_CHECKPOINT.md` slice. It supersedes the older
statement that chat/Test integration is only a future proposal. Existing dirty
documentation, prototypes and prior Tests improvements are preserved.

- Conversations / Tests share projects, instructions, memory, files and connection
  configuration; they do not share mutable execution authority.
- A Test session saves discussion before creating a QA Request. Only the explicit
  **Prepare this test** action confirms a versioned proposal. Text such as “run it”
  cannot prepare or approve a run.
- A persisted worker coordinates checklist, immutable Recipe and review through
  the existing QA services. Interrupted work uses persisted receipts, bounded
  retries, session locks and attempt fences, rather than browser lifetime.
- Exact-run approval and production confirmation remain explicit, as does final
  QA-record review. Record approval is not release approval. Chat attachments are
  context, never execution evidence.
- Historical request review remains possible; looking at an old request does not
  silently retarget new discussion or allow old execution commands.

## Implemented surfaces

Backend: additive TEST conversation kind, session/turn/preparation persistence,
project-scoped session routes, structured planner output, immutable preparation
context, guarded sequential work and idempotency. Generic conversation save,
delete and summary paths cannot rewrite a Test transcript. Project deletion and
export include Test transcripts and their supported attachments; import is inert
ordinary conversation data, not restored QA authority.

Frontend: sidebar destination toggle, restorable project/session/request links,
server-owned discussion, request history, check-adjacent evidence and persistent
action cards above the shared composer. Project context remains visible on desktop
and has named mobile entry points. Approval details expand in the transcript;
native profile/revision controls retain exact approval invalidation. Renaming,
archiving/restoring, transcript export and confirmed unlinked-draft deletion are
available. Drafts, uploads and uncertain turn receipts are owner/scope guarded.

No live browser streaming, takeover, new provider/MCP, parallel multi-agent
execution, Jira/Figma/MR integration or public-site redesign was added.

## Final verification — 2026-09-24

- `npm run verify`: **1,399 passed**, zero failed/skipped: API 948, web 429,
  Runner 18, execution contract 4. Includes source/test TypeScript and API
  architecture checks. Log: `work/test-session-verify-final.log`.
- The web suite includes 26 session controller/API regressions covering delayed
  responses, hidden views, owner/project boundaries, uncertain turn retries,
  attachment receipts, historical-request targeting, draft collisions and empty
  HTTP 204 deletion responses. Existing approval tests retain exact Recipe,
  production confirmation, duplicate-click and stale-response assertions.
- Translation catalogs: **7/7** (`work/test-session-i18n-final.log`).
- Web/API/Runner builds: all passed (`work/test-session-build-*-final.log`). Web
  build used process-only `VITE_API_BASE_URL=https://api.example.test` because
  local HTTP development configuration is deliberately rejected by production
  header generation. `.env` was not edited; this is not a deployment config.
- Fresh disposable PostgreSQL 16.14: all **22 migrations**, **zero drift**, and
  **30/30 integration tests** including seven session concurrency/recovery cases.
  See `work/test-session-db-verification-20260924.md` and its referenced log.
  Only the disposable fixture container/databases/volume were removed afterward;
  the working PostgreSQL container remained healthy and untouched.
- Isolated Test-session Chromium checks: **60/60**, zero runtime errors. Covers
  goal → explicit preparation → exact approval → record review; six blocked
  Runner/review cases; missing-evidence focus; real progress; three short-phone
  attachment drafts; and 48 en/ar/de, light/dark, RTL/responsive cases.
  Log: `work/test-session-browser-final.log`.
- Existing chat/project shell browser checks: **21/21**, zero runtime errors,
  preserving six tasks, drafts, file input/paste/drop, project context, menus,
  imports/exports and auth/settings presentation. Log:
  `work/test-session-shell-final.log`; screenshots: `work/ux-validation/`.
- `git diff --check` passes. Windows line-ending notices are not failures.

Actual rendered screenshots:
`work/test-session-validation/2026-09-24T15-25-08-478Z/`. Reviewed desktop English
dark, Arabic light 390x667, and German dark 320x568 with a multiline attachment
draft. Approval details and optional review notes expand in the transcript;
header/history scroll with it. At extreme phone heights the footer can scroll
between approval and composition without discarding either. Checks validate
reachable text/send bounds, not merely absence of horizontal overflow. This is
viewport emulation, not a physical-device virtual-keyboard test.

Earlier 2026-09-23 screenshots are retained but superseded. Those visual checks
found short-phone clipping, corrected before the final matrix. Initial test
failures and the migration FK-name drift were corrected and rerun; do not report
them as current failures. Do not generate Prisma concurrently with API tests:
generation temporarily replaces runtime files, producing misleading import
failures. Final `verify` ran its generation and tests sequentially.

Non-blocking follow-ups: the web build reports a main-chunk warning slightly over
500 kB; the DB suite reports a `pg` concurrent-query deprecation. Neither failed
verification. Bundle splitting and driver cleanup are separate maintenance work.

## Migration and real-service limits

New migration: `20260922090000_add_test_sessions`. An isolated PostgreSQL run
identified a foreign-key naming drift, corrected before the fresh rerun.
The owner explicitly approved local backup/preflight/migration after the 2026-09-24
handoff. On **2026-09-25**, the backup was restored to a separate database, migrated
and checked there, then the single pending migration was applied to the original
local database. All 22 migrations are applied, schema drift is zero, and original
row fingerprints across all 44 existing data tables match before/after migration
and after a read-only API probe. At that activation checkpoint, ordinary Chats
retained `CONVERSATION`, original QA requests were unlinked and new session tables
were empty. Later live-session changes are documented separately. See
`LOCAL_TEST_SESSIONS_ACTIVATION.md` for backup location, verification and limits.
Other installations still require this migration before running the new API,
including ordinary Chat reads referencing `Chat.kind`.

The API process runs the persisted Test-session loop
under existing `QA_PROCESSING_WORKER_ENABLED` (default `true`), alongside existing
QA processing. Disabling it leaves discussion/preparation queued; there is no
new standalone worker command. Restart recovery cannot restore approval or
automatically execute a browser run.

Activation probes disabled workers and SMTP and used real local DB reads plus six
anonymous HTTP checks. Subsequent normal local development startup found no
pending QA/email jobs. The owner subsequently signed in privately. A new real
provider discussion and checklist/Recipe/review preparation succeeded. On 2026-09-26
the owner connected the Runner privately and approved both exact execution and the
completed record. A read-only audit confirmed one run, four passes, one intentional
failure and five stored TEXT proofs. See `TEST_SESSIONS_LIVE_CHECKPOINT.md` for the
closure and the earlier, separately identified legacy-request metadata difference.
The 2026-09-24 browser suites used intercepted in-memory APIs; they validate UI
behavior, not provider quality or real deployment readiness.
Unsent composition drafts remain owner/scoped **in-memory** state, like ordinary
chat: route switching preserves them, but full reload can discard them. Sent
discussion and preparation state are server-persisted. Transcript exports are
not a restorable QA backup; imports create ordinary chats without execution links.

## Next owner-approved step

The approved implementation and bounded local journey are complete. Recommended
next planning slice: Runner onboarding/recovery, followed by unfamiliar-user
first-test acceptance. Do not use either approved smoke record as a mutable fixture.
General usability, failure-injection validation and production deployment gates
are not closed by this one local happy path. No new feature or deployment is
authorized by this recommendation.

## Resume without repeating work

1. Inspect Git and this checkpoint. Preserve existing changes; do not reset.
2. Use Node 24.19+ in the supported `<25` range.
3. If code has changed since this checkpoint, run `npm run verify`,
   `npm run test:i18n`, builds for web/API/Runner, and the
   isolated scripts `apps/web/scripts/test-session-smoke.mjs` and
   `apps/web/scripts/ux-navigation-smoke.mjs` against local Vite.
4. Inspect actual screenshots, especially Arabic RTL and German short phones.
5. Use only a dedicated disposable DB target for migration rehearsals/integration
   tests. The approved local schema activation is complete; never repoint an
   integration test command at the owner's working database.
6. Record exact successes and any remaining limitations; no commit/push/deploy.
