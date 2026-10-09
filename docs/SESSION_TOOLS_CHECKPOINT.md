# Session tools and project organization — local checkpoint

Updated: 2026-10-05, following interruption/restart recovery.

The later screenshot-driven empty-start/reader refinement is documented in
`SESSION_START_REFINEMENT.md`, including current UI images and check results.
The totals in this checkpoint are historical.

Subsequent owner-authorized review fixes and current verification are recorded in
`SESSION_REVIEW_FIXES.md`. They address review selection, signed-in project moves
and independent backend preparation scheduling; totals below remain the preceding
presentation checkpoint.

## Delivery and scope

This is the presentation successor to `ONE_SESSION_CHECKPOINT.md` and the
preceding independent UX audit. The authenticated managed session remains the
single conversation and QA controller. Work is local on the existing dirty
`main`; earlier changes are preserved. This slice adds no REST/MCP endpoint,
schema change, migration, provider, Runner execution, billing rule or QA
approval authority. No real approved QA record was used as a fixture or
modified. No commit, push or deployment was performed.

- A 48px global rail contains only Home, Projects and Account beside the 224px
  project/session list. Mobile retains the existing 991/992px navigation drawer.
- One identity-based partition drives sidebar and project detail discovery.
  Project sessions and archives stay inside their project even when it is
  collapsed. Recent and its archive contain only projectless sessions. Dedup
  does not rewrite titles, membership or saved data. Missing-project references
  remain a recovery group; a list read never silently moves them to Recent.
- Existing rename, allowed move/delete, archive, import/export and account menus
  remain. Failed reads retain the current owner's last successful data; changing
  accounts clears private lists and tool state.
- Instructions, memory, project documents/editing/preview/upload and Integrations
  are accessed through the actual project page. The project link in the session
  header opens that page. Existing project scope, memory, document retrieval and
  immutable QA snapshots are unchanged.
- Project detail composition uses the same managed SessionPage/controller and
  ChatComposer via Teleport. It does not introduce a parallel authenticated
  writer, submit path or draft. Visiting a project does not create a session or
  start work; explicit submission retains that project's scope.
- Credits appear in Account, with the existing detailed Usage destination. The
  authoritative value is retained on failed/incomplete refresh, not replaced
  with zero or an estimated debit. No invented reset times or weekly percentages.

## On-demand session tools

The fixed session header exposes Sources, Activity and, when QA exists, Results.
Tools start closed. Clicking the active tool closes it; another tool changes its
content. State refreshes do not open tools or steal focus. Tools close on session,
account or inactive-controller changes; resizing the same session retains the
selected tool/source.

The tool panel is 320px wide only when the workspace can leave at least 480px for
the conversation. Otherwise it becomes a drawer; mobile uses the full available
viewport with one scrollable body. Escape closes the drawer and restores opener
focus. Teleported content, modal inert state and scroll locks are released on
KeepAlive deactivation. The reading/composer maximum remains 740px, with the
existing decision dock and one exact-approval component.

### Sources and safe preview

- Sources list actual saved message attachments and unsent draft attachments,
  with explicit origin/message links. Project library files are not duplicated
  here. No source is represented as a RAG retrieval citation or execution proof.
- The same preview serves message, composer and Sources attachment activation,
  including the retained guest flow. Supported TXT/Markdown/log/CSV/JSON text
  renders escaped in a `pre`; supported PNG/JPEG/WebP images stay within the
  existing attachment policy. No HTML/JavaScript execution, iframe, SVG preview
  or new PDF/video support.
- Saved private content uses the existing authorized download endpoint. Reads
  are bounded by existing attachment limits, scope/revision guarded and aborted
  on scope changes. Only preview-owned blob URLs are revoked, not composer-owned
  draft URLs. Metadata-only legacy entries explain that content is unavailable;
  fallback download/external links require an actual available URL/content.
- The resume review found an existing private-download cache race: an old
  account's delayed response could repopulate a cleared cache. A monotonic cache
  revision now rejects that response before returning or caching its signed URL,
  including late response-body completion and force refresh. Three regressions
  cover the fix; no access/storage API contract changed.

### Activity, results and reading

- Activity derives actual assistant turns, preparation, operations, runs and
  stored events into active/completed/needs-attention groups. Current work and a
  historical viewed request are explicitly distinguished; another request is
  selected deliberately, without detail reads for every sidebar row.
- Execution completion is distinct from PASS/FAIL and from record approval.
  Progress is real or indeterminate; missing dates/counts are not invented.
  This is not a list of fabricated agents or OS processes.
- QA event labels are localized in en/ar/de. Per-check/per-evidence technical
  events are retained in Activity/Results; primary events and errors remain in
  the chronological conversation with their original identities/order.
- Results reuse the existing checks, expected/observed values, evidence and
  history renderer. Failed reads show scoped retry and block stale actions;
  independent read-only tools do not grant approval or execution.
- Late result selection, next-tick connection opening, focus-to-record and
  source-message navigation are guarded against newer tool intent, session/
  project/account changes, deactivation, loading and failed reads.
- Back to latest follows actual unseen transcript content. Header/tool focus is
  not interpreted as reading older messages. A reader's older scroll position
  is preserved across updates and draft resizing.

## Verification record

The checks below are run sequentially to limit laptop load. API/Runner tests use
their existing isolated test infrastructure; browser fixtures intercept all
API/asset responses and block external hosts. They do not call the user's real
account/database, providers, Runner, or production target.

Post-resume checks (after the private-download cache fix):

| Check | Result | Log |
| --- | --- | --- |
| Full `verify`: architecture and TypeScript, execution contract/API/Runner/web tests | 1,568/1,568 passed: 4 + 970 + 18 + 576; zero failed/skipped | `work/session-tools-validation/verify-resume.log` |
| Separate translation checks | 7/7 passed | `work/session-tools-validation/i18n-resume.log` |
| Web production build with a process-only dummy HTTPS API origin | Passed; existing chunk-size warning, main chunk 574.60kB | `work/session-tools-validation/build-web-resume.log` |
| Standard Git whitespace/conflict check | `git diff --check` passed; no source conflict markers | `work/session-tools-validation/git-diff-resume.log` |

The full web count includes 25 SessionPage late-response/tool-intent tests and
6 private-assets tests (3 new cache-boundary regressions).

The final review also added four App-shell recovery tests: valid project/session/
usage reads followed by failures and successful retry; incomplete/non-finite usage
retaining the authoritative balance; synchronous logout reset; and old project/
usage replies unable to overwrite a newly signed-in owner. The focused shell
suite passed 23/23 (`work/session-tools-validation/read-recovery-resume.log`),
then the full `verify` was rerun successfully with those additions included.
These new cache-recovery cases are App-shell behavior tests, not a claim of new
live account/storage certification.

Fresh post-resume browser verification:

- `work/session-tools-validation/2026-10-05T10-50-07-115Z/report.json`: 59/59
  passed, no browser runtime errors, outbound providers or real API writes.
  Eleven behavior checks include strict folder/Recent/archive partition, safe
  saved/draft/guest TXT previews, missing-content/retry/image behavior, project-only
  editing, current versus historical work, reader position, canonical reload,
  KeepAlive cleanup and same selected preview/draft across split/drawer/mobile
  resizing without extra private-download reads. Forty-eight layout cases cover
  all requested locales, themes, widths and short-phone heights.
- `work/session-tools-validation/qa-critical-resume.log`: 6/6 critical journeys
  passed. Screenshots: `work/test-session-validation/2026-10-05T10-52-47-238Z`.
  The fixture journey reaches record review, preserves discussion/drafts/credits
  and menu focus, and checks exact production acknowledgments, stale versions and
  failed reads. All QA mutations are in-memory fixture responses, not live runs.
- Browser console log: `work/session-tools-validation/browser-resume.log`.

Retained pre-resume artifacts (historical verification, not extra unique cases):

- `work/session-tools-validation/2026-10-04T18-38-11-936Z/report.json`: 57 passing
  checks, comprising 9 behavior journeys and 48 layout cases across en/ar/de,
  light/dark, 1440/1024/992/991/390/320px, including 390×667 and 320×568.
- `work/session-tools-validation/2026-10-04T18-46-38-403Z/report.json`: 2 fresh
  RTL/long-text phone checks after adding missing body-teleported result badge
  styles (Arabic dark 390×667, German light 320×568).
- `work/session-tools-validation/2026-10-04T18-50-16-182Z/report.json`: 10 final
  behavior journeys, including safe guest TXT preview and unsent draft retention.
- `work/test-session-validation/2026-10-04T18-41-54-806Z`: 6 isolated critical
  journeys through scope preparation, exact execution approval, production
  acknowledgments, changed-version/read-failure invalidation, discussion during
  a run, record review, drafts and menu keyboard/Escape focus.

These overlapping reruns are not added into a fabricated unique-case total.
Selected actual screenshots were visually inspected, alongside automated
geometry/overflow/accessibility assertions; not every image was manually read.

Representative inspected images (generated locally, not screenshots of real QA):

- [Quiet session and strict sidebar partition](../work/session-tools-validation/2026-10-05T10-50-07-115Z/closed-en-dark-1440x900.png)
- [Safe draft Sources preview](../work/session-tools-validation/2026-10-05T10-50-07-115Z/sources-draft-en-dark-1440.png)
- [Project-only editing context](../work/session-tools-validation/2026-10-05T10-50-07-115Z/project-context-en-dark-1440.png)
- [Arabic short-phone Results](../work/session-tools-validation/2026-10-05T10-50-07-115Z/results-ar-dark-390x667.png)
- [German short-phone account/usage menu](../work/session-tools-validation/2026-10-05T10-50-07-115Z/account-de-light-320x568.png)
- [Exact production approval in a fixture, not a live execution](../work/test-session-validation/2026-10-05T10-52-47-238Z/production-exact-approval.png)

Reproduction:

```powershell
npm run verify
npm run test:i18n
# Build validation terminal only: these are not development/server settings.
$env:VITE_API_BASE_URL = 'https://api.oddpath.example'
$env:VITE_R2_ENDPOINT = ''
npm run build:web
# In another clean terminal, start the local preview:
# npm --prefix apps/web run dev -- --port 5182 --strictPort
# Then run these browser scripts; all their API/asset calls are mocked.
node apps/web/scripts/session-tools-smoke.mjs
$env:TEST_SESSION_SMOKE_BEHAVIOR_ONLY = '1'
node apps/web/scripts/test-session-smoke.mjs
git diff --check
```

The dummy HTTPS build origin is not a deployable configuration or a changed
`.env`. The existing main-chunk warning above 500kB remains a performance follow-up,
not a failed build or a new browser capability.
The validation-owned 5182 preview was stopped after browser checks to release
resources; the user's normal development services were not stopped or replaced.

## Limits and next steps

- UX-04 remains: structural attachment/evidence completeness does not prove
  semantic evidence content, passing checks, or release readiness. An approved
  QA record is not permission to release.
- Mocked private URLs/storage, provider recovery, Runner and production
  acknowledgments are regression evidence, not live-provider/private-storage or
  real production certification. No new live end-to-end run or database migration
  was performed for this presentation slice.
- Physical assistive technology, mobile software keyboards and first-user
  usability still need hands-on validation. Opening a tool or project page is
  covered against accidental writes, but does not certify every future adapter.
- The next safe step is owner review of this local UI and a separately scoped
  real-provider/storage smoke test against disposable data if desired. Live
  browser viewing/general tabs, takeover, Android, multi-agent management and new
  integrations remain separately approved future work, with no placeholder
  controls shipped here.
