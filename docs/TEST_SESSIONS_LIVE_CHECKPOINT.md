# Local conversational Test — live checkpoint

Updated: 2026-09-26. The real local journey through owner-approved execution,
stored evidence and final QA-record approval is verified. No commit, push or
deployment. Read `TEST_SESSIONS_CHECKPOINT.md` for implementation verification and
`LOCAL_TEST_SESSIONS_ACTIVATION.md` for the completed backup/migration evidence.

## Completed local acceptance session

- Project: `Runner smoke test` (`cmtrkqtom0000h0tyzphvgr09`).
- Session: `82e8c675-0fff-499a-a908-a0176561c174`.
- New request: `cmuh89f5n000hv0ty3d1xffmc`.
- Title: **Local Login Smoke Test: Conversational-Session Activation (2026-09-25)**.
- Route: `http://127.0.0.1:5173/#/tests?projectId=cmtrkqtom0000h0tyzphvgr09&sessionId=82e8c675-0fff-499a-a908-a0176561c174&requestId=cmuh89f5n000hv0ty3d1xffmc`.

The owner signed in privately. One real provider discussion turn succeeded on
attempt 1 and returned a structured proposal. Reload restored the sent discussion
and proposal without another turn. Explicit **Prepare this test** confirmed the
scope and the persisted checklist/Recipe/review pipeline completed successfully.
There is one request, one READY preparation and one Recipe revision, not duplicate
work from the interrupted turns.

## Preparation checkpoint — 2026-09-25

- Request `READY_TO_RUN`; preparation `READY`; Recipe revision 1 review `PASSED`.
- Immutable Recipe hash:
  `263e947c5d93f260004b45fdd518af58b2fdc12d8a65c842d03a6382a77713dc`.
- Five checks, twelve actions, exactly one TEXT evidence requirement per check.
- Every check first opens `/#/login` on the local web app. Checks cover the
  Welcome back heading, Email/Password visibility, retention of a non-secret
  example email, disabled Google sign-in, and the deliberately missing Oddpath
  smoke marker. The final check retains its intentional failing visible assertion.
- No submit/sign-in/account creation action, credentials, or file evidence.
- Zero runs for the new request. Recipe acknowledgement remains unchecked and
  **Approve & run** remains disabled while the selected Runner is offline.
- A fresh browser **Refresh status** after the interruption still shows Offline;
  the prepared Recipe and new request remain intact. No new generation was started.

## Runner setup blocker — resolved 2026-09-26

At preparation, the saved `Oddpath local` profile existed but its Runner was not
sending heartbeats. The existing `apps/runner/oddpath.runner.json` was unchanged.
Its token variable is `ODDPATH_RUNNER_TOKEN`; presence-only checks found no value in the agent process,
User or Machine environment. No token value was printed or recovered from history.

After explicit owner permission to start the Runner, `npm run dev:runner` was
attempted with Node 24.19. It exited with code 1:
`Runner token environment variable ODDPATH_RUNNER_TOKEN is not set.`
Token resolution happens before the Runner loop starts, so this attempt did not
register a Runner, claim work or launch a browser. No configuration was changed.

The owner then entered the existing token privately through a masked PowerShell
prompt and ran `npm run dev:runner` successfully. The terminal reported the existing
`local-smoke` Runner connected; a fresh UI **Refresh status** confirmed **Online**.
No connection replacement or token recovery was needed. The token was not placed
in source or chat. It remains a terminal/process configuration, not a newly added
persistent credential store. Closing that terminal requires private setup again.

Runner startup registers and polls for already-approved work. Before this live run,
only the old completed execution job existed; no new run was yet authorized.
Check for queued work again before any later agent-managed Runner start. Review the
exact current Recipe/profile before explicit run approval. Preparation, reconnecting
the Runner, and saying “continue” do not replace the run-approval card. Do not
regenerate the already reviewed Recipe merely because its Runner is offline.

The built API launcher is `work/local-db-activation/serve-local.mjs`, listening on
127.0.0.1:5000; Vite uses 127.0.0.1:5173. The API is not watch-mode: backend edits
require rebuilding/restarting. These processes do not survive every host restart.

## Live execution and final approval — 2026-09-26

The owner used the exact-run approval card and then approved the completed QA
record. The assistant did not click either approval or resubmit the run. Direct UI
inspection confirmed **QA record approved**, with the fifth check still failed.
A full page reload restored the same request, result statuses and approved card;
the empty composer and visible project context remained usable. The rendered
desktop result was visually inspected; no new responsive matrix was run here.

A repeatable-read, read-only DB audit at **2026-09-26T10:38:29.709Z** confirmed:

- One request in the new session, now **APPROVED**, version 5.
- One successful conversation turn (attempt 1), one READY preparation, one Recipe
  revision with the original immutable hash. No duplicate request or run.
- Checklist generation succeeded after **2 attempts**; Recipe generation and
  Recipe review each succeeded after 1. This was observed completion, not a
  deliberate live server/provider failure-injection exercise.
- One exact-run authorization by the project owner, matching the Recipe hash and
  `local` profile manifest; approval at **08:33:07.904Z**.
- Run `cmui94abg001nv0tyw0lbb50h`: **RESULTS_SUBMITTED**, outcome **FAIL**.
- Execution job `cmui94abr001pv0tyh587u23i`: **SUCCEEDED**, one attempt, completed
  **08:33:22.408Z**. Successful execution delivery does not mean all checks passed.
- Results in checklist order: **PASS, PASS, PASS, PASS, FAIL**, all with stored
  observed results. The final expected failure was not inverted or hidden.
- Exactly five nonempty, stored TEXT evidence entries: one per distinct check and
  matching requirement, submitted through REST by the integration, not chat files
  or external-reference substitutes.
- Exactly one final human review, **APPROVED** by the project owner at
  **08:35:08.477Z**. Record approval did not change the failing run outcome.

Audit helper: `work/local-db-activation/check-live-completion.mjs`; it only SELECTs
the named local session/request in a read-only transaction and prints selected
non-secret metadata. Its initial diagnostic query used an incorrect Project field
name; this was corrected to `ownerId` and the audit passed. No application defect
or DB mutation resulted. Do not use the completed owner record as a mutable test
fixture. Keep all of its results, approvals and evidence.

After another conversation interruption, the same read-only audit was rerun at
**2026-09-26T18:04:09.004Z** and passed unchanged: same request version, Recipe,
single run/authorization/review, five proofs and four PASS/one intentional FAIL.
No new execution, approval or application-source edit was made during closure.

The 2026-09-26 final-resume check used supported Node **24.19.0** and passed
`npm run verify` (the same 1,399-test suite), `npm run test:i18n` (7/7), and
API/Runner/web builds. The web build retains its non-blocking >500 kB main-chunk
warning. Full and production-only `npm audit` both reported zero advisories at
this checkpoint. `git diff --check` passed; no application source was edited in this
resume. A further read-only audit at **2026-09-26T21:55:58.744Z** again confirmed
the same approved request, one run/authorization/review, five stored TEXT proofs
and four PASS/one intentional FAIL. This is repeat verification, not another
browser run, isolated-DB integration suite, or production acceptance.

The resume check also found the local API/web ports refusing connections. After a
read-only queue preflight confirmed no pending/processing QA generations, turns,
preparations, execution jobs or auth emails, the existing development launchers
were restarted with Node 24.19. API health, DB readiness and Vite returned HTTP 200
on loopback ports 5000/5173. No Runner process was started and no approval was
submitted. This is local service recovery, not a deployment or automatic test rerun.
Source-integrity checks found no conflict markers or empty files among the 97
pending application source/test/config files; their timestamps predate the final
2026-09-24 build logs. This bounded check is not a full new code review/test-suite run.

## Historical-record preservation: precise result

The migration checkpoint's 44 original-table fingerprints matched at activation.
At the pre-execution live checkpoint, the seven original execution/result tables
`QaRun`, `QaHumanReview`, `QaCheckResult`, `QaEvidence`, `QaEvidenceAsset`,
`QaExecutionAuthorization` and `QaExecutionJob` still matched the private baseline.

A separate comparison detected a metadata change in the old approved request
`cmtrl1wg90003h0tyokxh0uhd`: it is now linked to another session,
`a4b47d29-6273-43aa-b224-a54aeaffe913`, and its original `updatedAt` changed. Reading
the archive's QaRequest COPY data in memory confirmed that **updatedAt is the only
changed original field** among all three old requests. The old request remains
APPROVED at version 5; its objective, artifact references, results and approvals
were not rewritten. This is consistent with the explicit legacy-session linking
path, which also updates Prisma's timestamp. The available evidence does not
establish who initiated that link. Do not undo it or claim every original row is
byte-identical throughout the later live journey.

The initial aggregate preservation assertion intentionally failed on that metadata
difference; it is not reported as a fully passing comparison. The narrower archive
inspection resolved which fields changed, without executing restore/write SQL.
Private diagnostic reports remain in ignored, ACL-protected
`work/local-db-backups/live-session-before-approval-20260925.json` and
`work/local-db-backups/request-metadata-difference-20260925.json`. Do not commit or
share the backup or its contents. Local diagnostic helpers are in
`work/local-db-activation/`; they are not application runtime code.

## Not yet verified by this live journey

The bounded local happy path is complete, not a production-readiness declaration.
This run does not establish independent new-user usability, general provider
quality, real crash-injection recovery, production targets, file evidence, mobile
virtual-keyboard behavior, or public deployment safety. These retain their existing
isolated-test evidence and/or separate acceptance gates. Full automated suites were
not rerun for this read-only closure and documentation update; the 2026-09-24
verification counts retain their original date and scope. `git diff --check` is
rerun for the documentation changes.

Recommended next bounded planning task: simplify **Runner onboarding and recovery**,
based on the real token/setup friction observed in this journey, then validate
first-test usability with an unfamiliar user. Do not start a new integration,
redesign, credential-storage scheme, commit/push or deployment by inference.
