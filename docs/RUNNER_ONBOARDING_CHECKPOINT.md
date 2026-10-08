# Runner onboarding and recovery checkpoint

Updated: 2026-09-27. This is a bounded local UX improvement after the owner
completed one real conversational Test. It does not add an embedded browser,
persist Runner secrets, start a Runner process from the web app, or alter the
exact-run approval contract.

## What changed

- An offline Runner now has a visible recovery action in the persistent run
  card above the Test composer. The owner can inspect short startup steps and
  refresh profile status without opening the technical Recipe details. A
  missing profile has a direct **Connect Runner** action; profile-read failure
  has a direct **Refresh status** action.
- The Runner connection dialog distinguishes an existing saved Runner from a
  first connection. Existing users see **restart the Runner** before the
  create-token form. A previously discovered profile is enough to show this
  guidance even if the connection list is temporarily empty.
- The copyable PowerShell startup command uses `Read-Host -AsSecureString`.
  It never interpolates a revealed token into the command or shell history.
  The one-time token reveal remains confined to the connection dialog; Oddpath
  cannot recover it after closure. The owner must save it privately. If lost,
  replacing a connection is an explicit action and still does not start a run.
- The older execution modal retains its instructions. README and execution-
  harness setup documentation use the same masked-prompt guidance.
- All new UI copy is in the existing en/ar/de catalogs. The short-phone
  recovery steps are intentionally compact; technical details remain
  expandable.

## Safety invariants

Opening setup, refreshing status, or restarting the local process does not
generate a Recipe or authorize execution. The exact Recipe/profile/version
acknowledgement and production confirmation are still required. An offline
reviewed Recipe is preserved. The command only obtains a token in the local
PowerShell process and starts the existing Runner, which can claim work only
after the owner has already approved it. Do not start a Runner against a
project with unknown queued work without checking that queue first.

## Verification

With Node 24.19.0 on 2026-09-27, `npm run verify` passed **1,401/1,401**:
API 948, web 431, Runner 18 and execution contract 4. Translation catalogs
passed 7/7, and the web production build passed using only the process-local
placeholder `VITE_API_BASE_URL=https://api.example.test`. The existing main
chunk warning (>500 kB) remains non-blocking. `git diff --check` passed.

The isolated Chromium Test-session smoke passed **61/61** with no unintended
API writes, including no-profile, offline, profile-read-error and Arabic
short-phone recovery. It verified that opening the connection dialog and
refreshing status do not create a token or start a run. The en/ar/de,
light/dark and 1440/1024/992/991/390/320px matrix still passed. Actual
rendered screenshots are in
`work/test-session-validation/2026-09-26T22-18-12-053Z/`, including
`runner-recovery-ar-short.png`, which was visually inspected. One earlier
browser rerun was interrupted by Vite HMR while UI copy was being edited;
the final clean run above was performed after edits stopped.

All browser APIs were intercepted and fixtures were disposable; no real
provider, account, database or Runner was contacted by that suite. The
owner's approved smoke was not reused as a mutable fixture. The local
working database migration and real test completion remain documented in
`TEST_SESSIONS_LIVE_CHECKPOINT.md`.

This remains development-repository onboarding, not a packaged end-user
installer or automatic local service. A new user still needs the repo,
separate API/web/Runner processes and local Runner configuration. Those
steps and the human usability gate below remain launch concerns.

## Unassisted first-test acceptance — still needs a person

Ask someone unfamiliar with the product to use a disposable local project and
test target, without coaching through the UI. Give only this goal: “Describe a
public login-page smoke test, prepare it, get the local Runner connected, run
it after reviewing the exact plan, and find the results.” Do not provide a
terminal recipe unless they discover the setup guidance and ask for help.

Observe and record, without storing passwords or tokens:

1. Can they find Tests, create/choose a project, and understand that describing
   a goal does not execute anything?
2. Can they tell a saved connection from an online Runner, restart an existing
   Runner without minting a needless token, and find the masked-token prompt?
3. Can they distinguish preparing a plan from approving an exact run, and find
   the required Recipe/profile and production acknowledgements?
4. Can they find the results, evidence and final QA-record review, and explain
   that record approval is not release approval?
5. Note every hesitation, wrong turn, help request, error, elapsed time and
   whether a token was ever pasted into chat or a screenshot. Stop immediately
   before a production-target run or any unsafe use of credentials.

Pass this human gate only if the participant completes the bounded journey
without coaching, no unintended run/connection is created, no secret leaks,
and the recorded QA result/evidence matches what happened. Otherwise fix the
observed friction and repeat with another participant. Automated and coached
tests are not a substitute for this gate. Do not use either already-approved
smoke record as the test fixture.
