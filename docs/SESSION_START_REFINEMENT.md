# New session presentation — 2026-10-05

Owner-authorized follow-up to the screenshots of duplicate history in the new
session and raw `sessionTools.*` labels. Local work on the existing dirty `main`;
previous changes are retained. No API/schema/migration, provider/Runner call,
real QA-record mutation, commit, push or deployment.

## Changes and preserved boundaries

- Remove the inherited central recent-session list and its obsolete prop/event
  wiring. History remains in the shared sidebar/project partition; nothing is
  renamed, moved or deleted. Project selection and its breadcrumb remain.
- Start with a localized session heading and writer. Saved session/request
  titles, six tasks, models, attachments and the existing QA controller remain.
- Use the existing distinct Sources/Activity/Results SVGs with quiet transparent
  tool buttons, 44px hit targets, localized accessible names and visible focus.
  Tools stay closed until explicitly opened; Results still needs a real request.
- Latest-navigation measures actual visible message/decision entries, excluding
  welcome content and trailing writer padding. The overlay writer's height is
  accounted for; flow mode does not count it as an overlay. Status updates and
  tool focus do not reset the reader's position.
- A reader scope key resets cached scroll position only when account, project
  or session identity changes. Short-phone validation also found that the dock
  budget included the wrapped header. Subtract its height so the existing flow
  fallback can make both content and writer reachable without an overlap.

## Verification method and limitations

The normal servers on 5173/5184 were unreachable during diagnosis. Therefore the
precise cause of the owner's older folder glyphs/raw labels is not established;
it must not be reported as a proven browser-cache defect. Current source already
registered the correct icons and catalogs. New unit/browser regressions verify
the served current development UI, not just JSON key presence.

All browser APIs/assets are in-memory fixtures, with writes and external hosts
blocked in the read-only script. Critical QA journeys use a separate in-memory
mutation fixture, never the owner's account or database. Browser contexts run
sequentially and are closed/recycled. The production build is checked separately
with a process-only dummy HTTPS API origin. Initial production-preview attempts
correctly blocked that origin and failed startup; these attempts are not passes.

At 320×568 a wrapped header and writer cannot both remain fixed with enough
reading space. The shared flow scroller is intentional: the initial heading is
visible, and writer/send controls are reachable by scrolling. Tests check both
positions; screenshot names distinguish the initial start from writer reachability.
Real mobile keyboards, live providers/storage and the original stale runtime are
not certified by these mocked desktop-Chromium viewport tests.

## Browser evidence

- 60 read-only scenarios: 48 viewport/locale/theme combinations and 12 behavioral
  journeys, zero runtime errors. Each layout now includes a populated session,
  project Add chats, a fresh start, distinct translated tools, and empty Activity.
- Eight critical in-memory QA journeys passed: exact/production approval,
  discussion during work, retained earlier review, scope/draft/file recovery and
  guarded project moves. No real user/QA/provider/Runner mutations.
- Final screenshot folders under `work/session-tools-validation/`:
  `2026-10-05T19-24-09-617Z` (three representative layouts),
  `2026-10-05T19-24-34-443Z` (remaining 45),
  `2026-10-05T19-33-26-896Z` (behavior and clean start delivery image).
- QA screenshots: `work/test-session-validation/2026-10-05T19-28-31-216Z`.
- Browser logs: `browser-empty-start-layout-targeted.log`,
  `browser-empty-start-layout-matrix.log`, `browser-empty-start-behavior.log`,
  `browser-empty-start-qa.log`, all under `work/session-tools-validation/`.

Representative current UI:

![New session, desktop dark](../work/session-tools-validation/2026-10-05T19-33-26-896Z/new-session-en-dark-behavior.png)
![New session, Arabic short phone](../work/session-tools-validation/2026-10-05T19-24-09-617Z/new-session-ar-dark-390x667.png)
![Initial new session, shortest German phone](../work/session-tools-validation/2026-10-05T19-24-09-617Z/new-session-de-light-320x568.png)
![Same shortest phone, writer reachable by scrolling](../work/session-tools-validation/2026-10-05T19-24-09-617Z/new-session-writer-reachable-de-light-320x568.png)

## Final repository checks

- Full `verify`: 1,601/1,601 passed (contract 4, API 979, Runner 18, web 600),
  zero failures/skips. All included TypeScript and architecture checks passed.
- Dedicated i18n: 8/8 passed, with live catalog registration checks for all
  start/tool/activity labels in en/ar/de.
- Production web build passed. The existing main-chunk warning remains
  (578.14kB, above the 500kB advisory); no bundle-performance work is claimed.
- Git diff check passed; no conflict markers or git publication.
- Logs: `verify-empty-start.log`, `i18n-empty-start.log`, `build-empty-start.log`
  in `work/session-tools-validation/`.

To see the current development files after an interrupted/stale web process,
restart only the terminal running `npm run dev:web`, then refresh its browser tab
with Ctrl+Shift+R. Do not clear account storage or reset the database.
