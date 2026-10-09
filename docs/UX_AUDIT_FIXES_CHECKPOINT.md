# Independent UX audit — first bounded fixes

Date: 2026-10-04. Local, uncommitted changes on dirty `main`.

The owner authorized the next step after the independent browser report. This
slice implements **UX-01 canonical session restoration** and **UX-04 honest
evidence promises/presentation**. It does not automatically implement every audit
finding. The earlier local changes, APIs, database schema and QA approvals remain
in place. No migration, working-data write, commit, push or deployment occurred.

Original audit: [REPORT.md](../work/ux-review-20261004/REPORT.md). That report
records the pre-fix observations; this checkpoint records the subsequent changes.

## Session restoration

- Explicit `#/chat?sessionId=…` links are authorized by the owner-scoped session
  detail read, not the legacy Tests requirement for an explicit project or absence
  from the capped sidebar index. Legacy `#/tests` validation is unchanged.
- An omitted project is inferred only from the permitted session response. An
  explicit mismatching project, unexpected session ID or request not linked to
  that session is rejected before adopting the response. Failed reads remain
  blocked and retryable; no preparation, send or run is triggered by navigation.
- The inferred project loads its Runner profiles with the existing owner/scope
  late-response guards. Restoration selects the canonical persisted draft rather
  than transferring an empty temporary draft over it.
- Echoing the resolved scope does not reset the current request. Explicit
  historical request selection is retained. A linked-request read failure keeps
  the inferred scope pending until an explicit successful retry.
- Saved last-work restoration without an explicit link still uses its existing
  index validation. Removing that capped-index limitation is **not** implemented
  by this slice.

Regression coverage includes projectless and inferred-project links, sidebar
absence/failure, persisted text/file/model drafts, wrong project/request, missing
or failed owned detail reads, retry, history, account changes and late responses.
Existing exact Recipe/production approval and no-navigation-write tests remain.

## Evidence promises and presentation

- Checklist generation/review and Recipe generation/review share the bundled
  Playwright Runner's actual evidence contract. Default browser TEXT requirements
  describe assertion status, completed-step count and first incomplete step ref,
  not DOM/attribute dumps or detailed browser error logs.
- Evidence is collected outside Recipe steps; reviewers must not suggest a
  nonexistent capture/evaluate/logging step. Explicit richer requirements and
  immutable artifacts are preserved, with capability gaps flagged for an owner
  decision. External agents are not limited to the bundled Runner's summaries.
- Results keep every requested evidence description inspectable after attachment,
  with required/optional labels and exact IDs. Neutral attachment wording and a
  visible caution distinguish the structural gate from requested-content
  verification and passing checks. The summary-only explanation applies to
  Playwright TEXT, not arbitrary connected-agent evidence. en/ar/de are updated.
- No stored requirement, evidence, result or approval was rewritten. No raw DOM,
  secret-bearing attributes, console or network capture was added to Runner.

**Limit:** this improves prompt guidance and honesty of the UI. It is not a new
deterministic semantic evidence validator. Future model adherence was tested with
mocked provider responses, not a new real generation. Old summary evidence has
not become DOM/error proof, and richer immutable requirements still need actual
content review or a suitable capture source. UX-04 is mitigated, not certified as
impossible to recur.

## Verification

- Full `npm run verify`: **1,471/1,471 passed**, zero failed/skipped: execution
  contract 4, API 970, Runner 18, web 479. All four type checks passed.
  [Log](../work/ux-review-20261004/verify-fixes.log).
- Separate translation check: **7/7 passed**. API architecture-boundary check also
  passed in the focused prompt review. Independent read-only reviews found no
  blocking defect in the scoped restoration/prompt changes.
- API and Runner builds passed. The initial web production build correctly
  rejected the local HTTP/missing production API origin; the validation build
  passed with process-only `VITE_API_BASE_URL=https://api.oddpath.example` and no
  R2 origin. No `.env`/CSP/security policy was changed. This artifact uses a dummy
  origin and is **not for deployment**. The existing >500 kB bundle warning remains.
  [API](../work/ux-review-20261004/build-api-fixes.log),
  [Runner](../work/ux-review-20261004/build-runner-fixes.log),
  [web validation](../work/ux-review-20261004/build-web-fixes-https.log).
- Normal `git diff --check` passed after the interruption; prior dirty work remains.
- Actual browser: projectless canonical reload retained its session, table, code,
  credits and an unsent test draft. Only that test draft was cleared afterward;
  no message was sent. An owned QA link without `projectId` recovered its project,
  original approved record and 2 PASS / 1 intentional FAIL unchanged. Results
  showed the new evidence caution and original richer requirement descriptions.
- Arabic/dark Results were sampled at desktop, 390×667 and 320×568. No document
  horizontal overflow at either mobile width. Escape closed the mobile panel and
  restored focus to its trigger. Temporary viewport override was reset.
- Audit health remains `oddpath_ux_review:55442`, **8/10 real provider calls**,
  0 blocked, `runnerActive:false`. These fixes consumed **zero additional real
  provider calls**, created no credential and ran no new test. The audit API's
  already-running process was not restarted for a fresh live-model evaluation.
- On the latest limit interruption, browser bindings and the previous tabs were
  no longer available. Inventory showed no tabs; a fresh tab **3** in the same
  audit browser **2** reopened the permitted saved QA session for reading only.
  Authentication, 88 credits, approved record, failure and evidence caution were
  present. The new tab is marked for handoff; no send/run/review was performed.

## Screenshots and remaining work

- [Projectless reload and unsent draft](../work/ux-review-20261004/fix-01-projectless-reload.jpg).
- [Results caution beside the unchanged report](../work/ux-review-20261004/fix-02-evidence-caution-ar.jpg).
- [390px Results](../work/ux-review-20261004/fix-03-evidence-mobile-390.jpg).
- [320px short-phone limitation](../work/ux-review-20261004/fix-04-evidence-mobile-320.jpg).

**Additional layout limitation, not a visual pass:** at 320×568 the open Results
panel's body is too short to read comfortably between its tabs and Integrations
footer. The existing short-height panel styles were not changed here. Lack of
horizontal overflow and working Escape do not certify content readability. This
needs a focused panel-height/scroll follow-up before a launch-readiness claim.

Next bounded work: UX-02 TXT attachment preview/feedback; UX-03 false reader-follow
state; UX-05 localized meaningful QA event summaries; the short-phone Results
layout above. Broader audit gaps remain: actual discussion overlapping execution,
production/cancel/recovery browser paths, private storage/embeddings/email and
import/export round-trip. Live-browser streaming/tabs and Android remain separate.
