# Focused Tests implementation — 2026-09-21

Owner-approved UI slice implemented on `main`. This checkpoint supersedes the
earlier instruction to plan the Tests slice; the broader agent/session vision
remains a separate proposal. No commit, push, deployment, schema/API migration,
real QA execution, or user-data mutation is authorized by this slice.

## Implemented

- Compact Tests header with project, New test, and Connections. Saved connections
  are described as integration credentials, not currently running agents.
- 224px desktop test list plus flexible record; at <=991px the list is an
  explicitly labelled disclosure. Selection closes it and focuses the record;
  Escape returns focus to its trigger.
- One primary state-derived action. `workspacePresentation.ts` contains only
  presentation logic, not a replacement lifecycle. Existing owner selection,
  exact Recipe/profile approval, production confirmation, cancellation and
  final record-review gates remain authoritative.
- Prepare run opens the existing modal and reads Runner profiles; opening it
  never generates, reviews, queues or executes automatically. Connected-agent
  execution remains a separate, explicitly labelled secondary action.
- Read errors offer real retries, including the exact request whose selection
  failed. They are not treated as an empty Runner list. Profile discovery
  failure/loading blocks generation and execution using stale profiles while
  preserving Recipe-review recovery independent of Runner connectivity.
- Expected checks remain in the main area. Stored observed results and notes,
  preconditions, steps and linked evidence are expandable beside each check;
  failed/blocked checks and missing requirements start expanded. The primary
  missing-evidence action opens and focuses the first missing requirement.
- Exact requirement IDs still determine fulfillment. Unscoped/unmatched proof
  stays in Run evidence. All stored assets remain accessible through the existing
  signed-download API; external credential-free HTTPS links are explicitly not
  stored evidence. Late download responses/errors cannot cross run/owner scope.
- Before any run, the proof summary says collection has not started. Requirement
  completeness does not imply passing tests, and record approval does not imply
  release permission. Unknown progress is indeterminate, never a guessed percent.
- Current pending operations and unresolved errors stay visible. Successful and
  earlier operations, original receipt IDs/statuses, workflow events, review
  comments and technical Recipe hashes remain available in disclosures.
- Neutral workspace styling is scoped to Tests and directly to its Teleported
  dialog roots. Shared connection-dialog legacy/default appearance is preserved;
  auth/settings are not rethemed. New/rearranged page text uses en/ar/de catalogs.
  Unchanged legacy modal copy and provider/user-generated content are not claimed
  to be fully translated.

## Recovery review

Partial work after the interruption was completed and reviewed. Added regression
coverage for stale refresh/download results, selection A -> failed B -> retry B,
polling A without losing failed B's retry target, sample mobile focus, and creating
C after failed B without carrying B's error into C. Failed C creation preserves
B's recovery. Existing account/project isolation and exact approval tests remain.

## Verification

Final checks passed with Node 24.19.0:

- `npm run verify`: all type/architecture checks and 1,272 tests passed
  (869 API, 381 web, 18 Runner, 4 execution-contract).
- `npm run test:i18n`: 7/7 passed; locale keys and placeholders align.
- `npm run build:web`: passed with the placeholder API origin below.
- `git diff --check`: passed; only existing Windows LF/CRLF notices.
- Focused Tests Chromium smoke: 68 scenarios passed with zero page errors or
  API writes. Includes every en/ar/de + light/dark combination at 1440, 1024,
  992, 991, 390 and 320px; short phones are 390x667 and 320x568. Checks selection,
  missing-proof/review focus, sample creation entry, setup/revision gates, read
  failure recovery, indeterminate progress, phone modal access, Escape and focus.
- Existing shell Chromium smoke: 21 scenarios passed with zero page errors,
  preserving Home/chat/project drafts, uploads/paste/drop, import/export entry
  points, menus and short-phone composer access; auth/settings remain unchanged.

Actual generated screenshots were visually inspected in desktop light/dark,
Arabic RTL, German long-label and narrow-phone states, including setup failure
and modal controls. Representative final-pass artifacts:

- [Desktop light](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/en-light-1440x900.png)
- [Arabic dark](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/ar-dark-1440x900.png)
- [Arabic 320px](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/ar-light-320x568.png)
- [German 390px](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/de-dark-390x667.png)
- [Missing evidence](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/record-missing.png)
- [Profile discovery failure](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/profile-discovery-error.png)
- [Short-phone modal](../work/qa-focus-validation/2026-09-21T14-40-07-254Z/modal-ar-light-390x667.png)

All browser checks use intercepted fixture APIs, with external traffic blocked.
Focused Tests smoke rejects every API write; no real account, provider, database
or approved smoke record is exercised. The initial interrupted smoke run was
rerun after HMR settled; a transient Windows screenshot overwrite error was
resolved by using unique timestamped output directories. No application test
failure is waived in the final results above. Live DB integration, real private
storage/Runner/provider workflows and deployment smoke were not repeated.

Reproduce with Node 24.19.0 and installed Chromium:

```powershell
npm run verify
npm run test:i18n
$env:VITE_API_BASE_URL = 'https://api.example.test'
npm run build:web
npm --prefix apps/web run dev -- --port 5182 --strictPort
# In another terminal, from the repository root:
node apps/web/scripts/qa-focus-smoke.mjs
node apps/web/scripts/ux-navigation-smoke.mjs
git diff --check
```

`https://api.example.test` is a build-validation placeholder, not a release
configuration. Focused screenshots are generated in timestamped subdirectories
of `work/qa-focus-validation`; shell screenshots remain in `work/ux-validation`.
They are local generated evidence, not assets to bundle into an application commit.

## Next step and boundaries

Ask the owner to try the real local Tests screen: can they identify the next
action, understand disabled setup, find missing evidence and review the record
without being coached? Automated fixtures do not establish unfamiliar-user
usability, live Runner/network reliability or production readiness.

If that review is satisfactory, scope the next work against the existing
before-live checklist in `PRODUCTION_READINESS.md` and
`PRODUCT_VISION_AND_LAUNCH_PLAN.md`. No new provider, chat/QA persisted linkage,
Jira/Figma/MR adapter, agent scheduler, browser streaming/takeover, mobile executor
or MCP was introduced. Runner onboarding and unified-session work need separate
approval. Pre-existing prototypes, Eluthira, local Runner config, documentation
edits and normal user data remain untouched/preserved.
