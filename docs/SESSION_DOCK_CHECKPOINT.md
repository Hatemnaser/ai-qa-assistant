# Continuous session / one-decision dock checkpoint

Updated: 2026-09-29. Local, uncommitted work on the existing `main` checkout.
This extends `UNIFIED_SESSION_CHECKPOINT.md`; the previous large local changes
are preserved. This slice changes presentation only, not APIs, migrations,
stored QA history, Runner permissions, or execution authorization.

## Implemented

- Home, ordinary Chat, project details and Test sessions use one
  `SessionComposerDock`. `ChatComposer` still owns text, native task/model
  controls, sending, six modes, image suggestions, starter actions, attachment
  picking/pasting/dropping/preview/removal, and the AI disclosure.
- The rectangular footer/divider is gone. The 740px writer has a small shadow
  and pointer-transparent fade; ResizeObserver reserves its measured height in
  the transcript. Selected attachments use one horizontal row. The textarea
  retains its own bounded scroll area.
- Large decisions move as **the same mounted subtree** into the transcript
  when writer + decision exceeds 45% of available height or leaves under 160px
  for reading. A persistent title/target summary opens it; Escape returns focus.
  Very short surfaces use flow scrolling instead of an inaccessible fixed dock.
  The existing 991/992px boundary and safe-area padding remain. VisualViewport
  resizing is observed for keyboards; physical-device keyboard behavior still
  warrants a manual check.
- Following latest is independent of reading older messages. Polling, draft
  growth and layout measurement preserve a reader's position. Explicit decision
  inspection stops following. Back to latest is measured inside the dock, never
  floating over a confirmation or message action.
- `decisionPresentation.ts` defines **presentation precedence**, not a second QA
  state machine. Loading/read errors take priority; saving retains action
  identity; project/archive prerequisites and current work precede proposals.
  Without a new proposal, recovery/checklist ownership/exact approval/evidence/
  record review remain available through existing controller gates.
- Completed approval/results are shown in the transcript and Results panel,
  not as a second live bottom card. Real review timestamps/comments are used
  when present; no messages/events are written just to move the display.
  Earlier unresolved reviews have a named request entry. Opening one explicitly
  selects that request; a new proposal cannot silently supersede its review.
- The single existing `QaRunApprovalPanel` and `useQaRunApproval` retain selected
  Runner/Recipe across display changes, but still invalidate consent on identity,
  version, profile, review, or read-error changes. Production confirmation is
  separate. Runner refresh/recovery, failed Recipe review, revision generation,
  exact steps/hashes and connected-agent execution are preserved.
- The project panel is open by default on desktop, with a named header toggle
  and an owner-scoped boolean preference (`oddpath:panel-collapsed:<owner>`).
  Context contains instructions/memory; Files contains the document library;
  Results contains actual QA checks/evidence/history. Integrations stays at the
  bottom of the open panel. One mounted project-context state holder survives
  tab/collapse changes; project/account changes reset its visible tab.
- Mobile has named panel/tabs and instruction/memory shortcuts, Escape/focus
  restoration, and closes the panel when explicitly focusing the writer or
  decision controls. A desktop Results selection does not force it open when
  the viewport later becomes mobile.
- Start a test is a compact action; a project picker appears only after asking
  to start without a project. Existing same-ID Chat-to-Test conversion and drafts
  are unchanged. No automatic prepare/run is added to navigation or resizing.

## Verification

### Scrollbar follow-up — 2026-09-29

The owner's native-scrollbar screenshot exposed a gap in the original visual
checks: the full-width absolute dock/fade painted over the transcript rail.
The dock now measures the browser's actual left/right gutter (excluding
borders), stops its background and fade at that boundary, and observes the
transcript content box for gutter-width changes. Zero-layout-width overlay
rails get 16px edge clearance; short-height flow mode resets the fixed insets.
The native scrollbar is neither hidden nor replaced. Approval logic and stored
records are unchanged.

Five unit cases cover physical RTL/LTR gutters, borders, wide/bilateral stable
gutters, and overlay/absent rails. The browser harness no longer uses
Playwright's default `--hide-scrollbars`. Four new fixture cases check real
native thumb dragging alongside the dock, hit testing at the fade/body/bottom,
gutter width changes and preserved reading position, in en/ar and both themes.
They also verify that reintroducing the old full-width style fails the overlap
assertion. Zero-width overlay geometry is simulated, not a claim of testing
every OS-specific overlay scrollbar implementation.

Follow-up checks: `check:web` and all **454 web tests** passed; the production
web build passed using the same process-only fixture settings below (the
existing bundle-size warning remains). Prior full-stack `verify` below is the
previous slice's result, not a new API/Runner test run for this CSS/layout fix.

Both isolated browser suites passed again: **73 Test session scenarios** and
**21 navigation scenarios**, with no real data mutations. Logs:
`work/session-scrollbar-browser.log`, `work/session-scrollbar-navigation.log`,
`work/session-scrollbar-build.log`. `git diff --check` passed.
Follow-up captures are in
`work/test-session-validation/2026-09-29T20-29-27-772Z/` (including
`native-scrollbar-en-dark.png`, `native-scrollbar-ar-dark.png`, and the full
viewport matrix); native rail and short-phone en/ar/de captures were visually
inspected. The dedicated 18px/28px native rails are test-only CSS, not a new
product scrollbar style. The earlier 69-scenario screenshots below are retained
as historical evidence. No commit, push, migration or deployment was performed.

### Initial dock implementation verification

Verification passed on Node 24.19.0 before the scrollbar follow-up:

- `npm run verify`: **1,422 tests** (4 contract + 951 API + 18 Runner +
  449 web), including all type checks; zero failures. Log:
  `work/session-dock-final-verify.log`.
- `npm run test:i18n`: 7/7; `npm run build:web`: passed with the build-only
  fixture origin described below. Log: `work/session-dock-build.log`.
- `test-session-smoke.mjs`: **69** isolated browser scenarios passed.
- `ux-navigation-smoke.mjs`: **21** scenarios passed; no browser page errors.
- `git diff --check`: passed. No evidence of interruption-corrupted source was
  found. Previous local work remains on `main`; no reset/staging/commit/push.

Representative actual screenshots were inspected in both themes, including
Arabic RTL, German short-phone layouts, approved-record + new-proposal,
expanded production consent and the collapsed panel. Visual inspection also
caught and fixed the short-project ordering, mobile panel flex sizing, an
inspection/autoscroll race and a Back-to-latest button overlapping approval.

Browser harnesses intercept every API call and block external traffic. They
exercise en/ar/de, RTL, light/dark, 1440/1024/992/991/390/320px, including
390×667 and 320×568. Added cases cover approved + proposal, pending review +
proposal, old preparation failure + proposal, historical results during active
current work, production consent across resize/Escape, read failure/version
invalidation, memory draft retention, and polling while reading older messages.
Existing navigation, exact approval, upload/paste/drop, menus and portability
coverage remains in the two smoke scripts.

Latest Test screenshots: `work/test-session-validation/2026-09-29T14-14-39-134Z/`.
Ordinary Home/Chat/project screenshots: `work/ux-validation/`.
Representative captures include `approved-record-and-new-proposal.png`,
`approved-proposal-panel-collapsed.png`, `production-exact-approval-details.png`,
`production-short-phone-expanded.png`, the localized viewport matrix, and
`home-light.png`, `project-short-320-568.png`, `chat-short-320-568.png`.
Earlier capture directories are historical, not the final presentation.

## Limits and handoff

- Browser tests use in-memory fixtures, not the real approved record. No real
  provider, Runner, database, or storage service was mutated in this slice.
- The default production build correctly refuses the local non-HTTPS API
  configuration. Build validation uses process-only
  `VITE_API_BASE_URL=https://api.example.test` and an empty optional R2 endpoint.
  This does not edit `.env`, select a deployment API, or deploy anything.
  The existing >500kB bundle warning remains a performance follow-up.
- No new database integration run is necessary for this presentation-only
  change; it is not a new end-to-end certification of the earlier backend work.
- Manual validation with a real phone/keyboard and an unfamiliar user remains
  valuable. A passing mocked journey is not a promise of release readiness.
- Live browser tabs, streaming/take-over, Android, provider changes, publishing,
  commit and push are outside this slice. Do not infer permission for them.

Next: owner inspection of their existing session and a short unassisted
first-test UX check. Fix concrete findings before expanding product scope.
