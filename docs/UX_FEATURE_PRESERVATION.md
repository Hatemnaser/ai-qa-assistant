# Focused workspace — implementation acceptance map

## Current closeout — 2026-10-06

See `SESSION_CLOSEOUT.md` for the final status of this bounded closeout, fresh
checks and evidence. Earlier totals below belong only to their dated checkpoints.
The existing one-session implementation, six task preferences, context/RAG,
attachments and QA scope/run/record authority remain unchanged.
The 2026-10-07 follow-up passed 1,618 regression tests, 71 read-only browser checks
and eight critical QA fixture journeys after the auth-bootstrap correction.

| Capability | Current location / boundary | Regression reference |
| --- | --- | --- |
| Restore saved work outside a capped or failed index | Owned session/request detail reads in `resolveLastWork`; original historical request retained | `lastWork.test.ts` and `testSessionShell.test.ts`: missing index, projectless/legacy scope, historical request, mismatched scope, confirmed unavailable versus transient failure |
| Explicit links and account/navigation safety | Explicit canonical/legacy destination wins; late startup/restore replies cannot replace later work | Shell tests include navigation changes and account A→B→A while startup is pending |
| Pending authentication is not a guest identity | No actionable guest writer during identity loading/failure; owned links remain sign-in gated | `authSession.test.ts` and `testSessionShell.test.ts`: delayed identity, retry, confirmed guest, owned scope and stale failure |
| Discover project Integrations with the panel closed | Named project-header action plus existing context-footer action, one project-owned dialog | `projectsPageNavigation.test.ts`: project/account scope reset; `session-tools-smoke.mjs`: both entry points, single dialog, Escape/focus, draft retention and no mutations |
| Preserve files while preparing a later review | Local scratch remains on disk, intentional source/tests/docs remain eligible | `LOCAL_ARTIFACT_POLICY.md`; no stage, commit, push or deployment in this closeout |

No new REST/MCP contract, schema or migration is introduced. The separately
authorized live-provider results, startup finding and diagnostic corrections are
in `SESSION_LIVE_CLOSEOUT.md`, distinct from intercepted browser fixtures. Real
owner-approved QA records are not fixtures; unassisted onboarding and operational
release gates remain separate.

## Previous new-session follow-up — 2026-10-05

See `SESSION_START_REFINEMENT.md` for that checkpoint's evidence. History is exclusively in
navigation/project lists, not duplicated in an empty transcript. Project scope,
six task/model controls, text/file drafts, Markdown and QA consent are retained.
Tools use existing distinct glyphs and localized names. Actual content geometry
gates latest-navigation; scope changes reset cached reading, and wrapped header
height is excluded from the short-phone dock budget. Status refreshes and tool
focus still preserve older-message reading. Initial heading and writer
reachability are both checked; short-phone flow is intentional, not overlap.

## Review follow-up — 2026-10-05

See `SESSION_REVIEW_FIXES.md` for that checkpoint's verification and limits. The map below
still describes the delivered UI; these regressions now have additional coverage:

- Explicit earlier QA review stays selected through identical session refreshes
  while a new proposal remains saved. Real scope/proposal changes clear override;
  loading/read failure and exact review permissions still gate actions.
- Project Add chats consumes the unified index and uses existing owned/versioned
  session moves. QA-linked/archived/legacy request rows cannot be moved. Partial
  failure, stale-account replies, guest compatibility and modal retry are tested.
- Preparation reconciliation has an independent lane while conversations await
  providers. Bounded turn lanes retain database leases and a local session fence;
  shutdown waits in-flight work. This is not parallel QA execution or a new agent
  manager, and it does not alter scope/run/record consent.

## Current presentation — session tools and project-only context, 2026-10-05

Read `SESSION_TOOLS_CHECKPOINT.md` for final verification totals, screenshots and
limits. This successor keeps the one-session contracts and replaces the older
always-present context panel and cross-project Recent presentation below.

| Capability | Current location / boundary | Verification reference |
| --- | --- | --- |
| One session, Markdown, six tasks/models and attachments | Original session/controller, ChatMessages and ChatComposer | Existing suites retained; focused source regressions; checkpoint for final checks |
| Project/standalone discovery without duplicate rows | Shared identity-based partition used by sidebar and project detail | Sidebar/partition tests: collapse, archives, missing projects, stable-ID dedup and guest rows |
| Navigation and account access | 48px global rail plus 224px list; existing mobile drawer | Real destinations only; existing keyboard/Escape/action wiring; checkpoint visual review |
| Project instructions/memory/files/Integrations | Shared project detail controls, not session tools; Integrations is reachable from the header even with the panel closed | Existing context/document/portability contracts retained; no RAG or snapshot change; both Integrations entry points share one scoped dialog |
| Scoped composition from project details | Same managed composer teleported into the project page | Shared-controller/draft coverage; no parallel signed-in legacy composer |
| Session references and source previews | On-demand Sources panel, closed by default | Focused image/text source/access tests; stale private-download cache rejection across accounts; supported download/external fallback only |
| Work in progress, completed work and technical events | On-demand Activity panel from existing records | Focused activity presentation tests; no fabricated progress or agent state |
| Check results, evidence and history | On-demand Results panel, with existing record renderer | Existing evidence/approval checks retained; attached proof is not semantic verification |
| Pending decision and exact execution consent | Existing decision dock and one QaRunApprovalPanel | Scope/Recipe/Runner/production gates unchanged; explicit earlier review survives refresh; late tool-opening/focus guards; 8 critical fixture browser journeys after review fixes; no writes merely to open tools |
| Account usage and recovery | Account menu and existing Usage page | Last authoritative owner value retained on failure; loading/retry and owner reset coverage |
| Rename/move/archive/delete/import/export | Existing menus and sessions facade with QA-link guards | Existing ownership, portability and menu rules retained; project Add chats shares managed list/versioned moves and preserves failure selections |

No API/schema change, migration, new provider/Runner execution or alteration of
real approved records is part of this presentation slice. Tests and visual review
do not imply complete live-provider/private-storage or first-user certification.
All earlier section-level totals below describe their original checkpoints only.

## Independent audit follow-up — 2026-10-04 (preceding checkpoint)

See `UX_AUDIT_FIXES_CHECKPOINT.md` and the original real-browser `REPORT.md` in
`work/ux-review-20261004`. Explicit canonical links now use owned session detail,
including projectless reload and inferred-project draft/profile restoration.
Regression tests retain exact approvals, negative scope cases and late-owner
guards. Evidence joins/gates are unchanged; Results expose original requirements
and distinguish attached entries from content verification. Shared prompt guidance
does not rewrite richer immutable requirements or restrict external agents.

Full verify: 1,471/1,471; separate i18n 7/7; actual projectless reload retained table,
code, credits and unsent text. Mobile RTL widths had no document overflow and
Escape restored focus, but 320×568 Results-body readability remains a documented
layout limitation. These observations do not certify all prior acceptance-map
items or the untested real-provider/storage/concurrency workflows.

## One server-managed session — 2026-10-03 (foundation; earlier presentation)

Read `ONE_SESSION_CHECKPOINT.md` for the persistence foundation and activation
gate. Its older panel/navigation locations are superseded by the current map
above; later and earlier totals must not be combined as new verification claims.

| Existing capability | Current owner | Verification |
| --- | --- | --- |
| Markdown tables/code/copy/answer exports | One ChatMessages renderer | Existing renderer suite + browser table/code assertions before and after QA |
| Six tasks/models/starters/paste/drop/files | Original ChatComposer and attachment services | Existing composer/attachment/model suites; isolated draft/file browser checks |
| Stable identity/project/visible index/credits | Sessions facade + account summary/index | DB adoption/CAS; canonical/legacy routes; failed-index and incomplete-usage browser assertions |
| Unsent text/files across reload | Existing draft manager with owner-key IndexedDB adapter | Late-hydration/owner/consume tests + actual browser reload |
| Exact Recipe/Runner/production approval | One QaRunApprovalPanel/service | Existing security suite + conversation consent, request revision, read failure and production browser gates |
| Timeline/results/later report | Transactional timeline counter + original QA events | DB concurrent allocation/backfill rehearsal; equal-date browser ordering |
| Discussion during QA / explicit failed-turn retry | Existing turn queue and separate QA lease | API/DB worker tests + browser active-run discussion |
| Context/files/preview/Integrations/project management | One WorkspacePanel and existing ProjectsPage/actions | Existing memory/document/portability/context suites; shared project viewport checks |
| Rename/move/archive/delete/import/export | Account facade with QA-link guards; ordinary text import | API ownership/portability suites, teleported menu/focus browser check |

No real approved QA record is a fixture. The new migration was separately
approved and activated locally on 2026-10-04; preservation evidence is in
`LOCAL_ONE_SESSION_ACTIVATION.md`. Mocked browser coverage and read-only activation
checks are not live provider/storage certification.

## Continuous conversation and one decision — 2026-09-29 (historical)

Handoff for that historical slice: `SESSION_DOCK_CHECKPOINT.md`. Older sections below record their
original scope; neither the Chat/QA navigation split nor the large scrolling
Test footer describes the current presentation.

| Capability | Current location / boundary | Verification |
| --- | --- | --- |
| Writer on Home, Chat, project and Test | Shared measured `SessionComposerDock`; original `ChatComposer` events | Both isolated browser harnesses; composer/draft/unit tests |
| Six modes, models, starters, image suggestion, AI note | Original native controls; compact Start a test action nearby | Ordinary shell browser + composer contracts; keyboard/paste/drop regressions retained |
| Long draft and attachments | Bounded textarea; horizontal preview row; short-height flow fallback | 390×667/320×568 controls checked for visibility and occlusion |
| Current QA decision | `sessionDecision`, existing canPrepare/canStart/canReview gates | Decision unit tests + proposal/review/recovery overlap scenarios |
| Exact run and production consent | One mounted approval form; expanded controls in transcript | Existing approval suite + resize/Escape/version/read-error browser cases |
| Completed records / older unresolved review | Transcript status and named request links; Results panel | Approved + proposal and previous-review tests; no navigation writes |
| Reading older messages | Reader-follow state and Back to latest | Polling and draft-resize browser regression |
| Native session scrollbar | Dock and fade exclude measured physical gutters; short-height flow keeps native scrolling | Native thumb drag + hit tests in en/ar light/dark, changing gutter widths, overlay-clearance units; headless scrollbars no longer hidden |
| Context, Files and Results | One state holder, filtered views, Integrations footer | Memory draft survives tab/collapse; document upload/drop/preview retained |
| Panel preference and mobile access | Owner-scoped boolean; project/account tab reset; named header/mobile controls | Reload/explicit Results reopening, Escape/focus and viewport matrix |
| Routes, scope, import/export and Chat-to-Test | Existing stores, routes and services unchanged by this slice | Existing isolation/controller/shell suites and portability browser cases |

Browser requests are mocked; these results do not claim a new real provider or
Runner execution. Physical keyboard/assistive-tech and first-user validation
remain manual checks. All changes are local, with no database mutation or push.

## Separate navigation, shared context — 2026-09-27 (historical)

See `WORKSPACE_NAVIGATION_CHECKPOINT.md`. Chat tree/actions remain in
ConversationSidebarContent; QA has a filtered summary-only session list and
collapsed archive in TestSidebarContent. ChatSidebar retains the accessible
drawer, account actions and shared project-management entry. ProjectsPage's
optional QA presentation reuses all project/context/portability controls without
mounting the ordinary Chat composer. Session project selection is immutable after
save; its breadcrumb opens shared details. No QA contract or RAG change.

Regression coverage: `testNavigation`, `lastWork`, `useAppRoute`,
`sidebarNavigation` and `testSessionShell` unit tests; expanded
`test-session-smoke.mjs` for independent project destinations, filter isolation,
draft/file restoration, archived/legacy records, retry and history with zero
navigation writes. `ux-navigation-smoke.mjs` retains ordinary composer/upload,
project menus, portability and auth/settings coverage. Unsaved drafts remain
in-memory; navigation storage contains IDs only, not attachments or transcripts.

## Conversational Test sessions — 2026-09-26 (historical checkpoint)

Implemented and verified on 2026-09-24; owner-approved backup/restore rehearsal
and local working-DB migration completed on 2026-09-25. Read
`TEST_SESSIONS_CHECKPOINT.md` for implementation results and
`LOCAL_TEST_SESSIONS_ACTIVATION.md` for activation evidence and remaining limits.
The subsequent real-provider preparation, Runner execution and owner record
approval are verified in `TEST_SESSIONS_LIVE_CHECKPOINT.md`.
Older sections below document their original scope, not current API/schema state.

| Capability | Current location | Preserved contract |
| --- | --- | --- |
| Conversations / Tests | Sidebar destination switch, shared project tree | No copied project/memory/files; ordinary chats retain six tasks and menus |
| New test / discussion | Test-session transcript and bottom shared composer | Explicit project choice; server-owned turns; attachment/paste/drop and scoped drafts |
| Confirm objective | Persistent Prepare this test card; details in transcript | Versioned proposal and source provenance; text alone grants no authority |
| Preparation/recovery | Persistent status/Runner/recovery card | Durable existing QA jobs, bounded retries and session lock; no run on navigation/reload |
| Exact run approval | Card above composer; large Recipe/profile details in transcript | Same shared approval rules as legacy dialog; production confirmation, immutable hashes, stale/duplicate guards |
| Results / evidence | Recorded-by-Oddpath card, adjacent check disclosures | Stored observations only; context attachments are not evidence; missing proof focuses exact requirement |
| Final review | Persistent review card; optional note expands in transcript | Explicit QA-record decision, not release approval; old pending reviews remain accessible |
| Multiple requests | Requests and history selector within session | Sequential preparation/execution; viewing old results does not retarget new commands |
| Rename/archive/delete | Session menu | Delete only unlinked draft with confirmation; linked sessions cannot move or be deleted through ordinary chat |
| Project details | Visible desktop aside; named mobile shortcuts | Existing instruction/memory/document permissions and Integrations remain |
| Portability | Session export; existing project/account exports | Supported transcript/files only; import as ordinary non-executable chat, never restored approvals |
| Navigation/recovery | Restorable project/session/request routes and old routes | Authorized destination, hidden-view and late-response fencing; no implicit creation/preparation/run |

2026-09-24 regression evidence: full verify 1,399 tests (429 web), i18n 7, isolated DB 30,
Test browser 60 and ordinary shell browser 21; all passed. Browser APIs are mocked.
The matrix includes en/ar/de, RTL, light/dark, 1440/1024/992/991/390/320px and
short phones with files. Actual virtual keyboards, real provider quality and real
Runner end-to-end execution remain outside this verification. On extreme phone
heights approval/composition remain scroll-reachable rather than both guaranteed
visible at once. Unsent drafts stay in memory; full reload is not draft recovery.

The 2026-09-25 local activation separately passed migration status, zero drift,
six read-only HTTP checks and unchanged fingerprints for all 44 pre-existing DB
tables. At that activation checkpoint, all 11 existing chats remained ordinary;
no Test session or historical QA link had been created. After private owner login,
one new real provider turn and preparation completed. On 2026-09-26 the owner
connected the Runner, approved exact execution and then the record: one run, four
PASS/one intentional FAIL, five stored TEXT proofs. A full reload retained approval
and the failing result. A separate historical-request session link/timestamp change
is documented in the live checkpoint; do not extend activation fingerprints to
later user activity. Unassisted onboarding/usability and production gates remain open.

## Historical focused Tests checkpoint — 2026-09-21

The owner-approved Tests slice is now implemented on top of the merged shell.
See `TESTS_FOCUS_CHECKPOINT.md` for final checks, screenshots and known limits.
The historical checkpoints below remain records of their original scope.

| Tests capability | Current location | Preserved contract |
| --- | --- | --- |
| Select request | 224px list; collapsible above record on mobile | Close on selection, Escape/return focus, stale-response isolation |
| Primary next step | Record header action area | Derived from existing state; no implicit generation/start/approval |
| Playwright setup | Existing Prepare run dialog | Exact Recipe/profile selection, review recovery, production confirmation |
| Connected agent | Explicit secondary start action / Connections | Existing MCP/REST access; saved credentials do not imply online agents |
| Checklist/result/proof | Main check rows and Run evidence | Exact requirement IDs, stored observed results only, unmatched evidence retained |
| Missing proof | First missing check opens and receives focus | Describes executor submission; no invented upload action |
| Final review | Existing review form, linked by Review record | Explicit decision; record approval is not release approval |
| Operations/history | Current errors visible; history disclosure | Original identities/statuses retained, review comments accessible |
| Loading/failures | State guidance and explicit refresh | No stale-record action, no false empty Runner state, retry exact failed request |
| Appearance/localization | Scoped Tests and Teleported dialog roots | en/ar/de new page copy; auth/settings unchanged |

No change to APIs, routes, data schemas, real approved records or private-file
authorization. Chat/QA linking, visible browser and new integrations remain
outside this slice. Feature preservation for the existing shell below still
applies and is covered by the navigation smoke script.

## Historical original phase-one scope

Phase one implements navigation, chat/project composition and integration entry
points only. QA records remain independent of chats. No schema/API migration,
new MCP server/client, streaming browser, deployment, or blanket approval.

| Existing capability | Destination | Acceptance |
| --- | --- | --- |
| Workspace and old hash routes | Tests navigation, existing `#/` | Still opens real QA workflows; no implicit execution |
| Chat startup | `#/home`, New conversation | Composer and recent conversations; no automatic project/chat creation |
| Project/recent collapse and expanded project chats | Sidebar | Name opens project; independent chevron expands; keyboard/touch usable |
| Rename, move/add/remove project, create project for chat, delete | Chat row menu | Enter/Escape/blur rename; preserve explicit delete confirmation |
| Chat/answer export | Existing row/answer menus; account shortcut | MD/TXT/CSV/JSON preserved; CSV escaping and metadata-only import preserved |
| JSON chat import | Account menu | Normal parser, new chat identity; navigate to imported chat |
| Project search/sort/edit/delete/add chats | Project index and header menu | Existing ordering, confirmations and owner guards |
| Project/account ZIP portability | Project index/menu; account settings | Preview/digest/commit, warnings, include-chats option and identity refresh |
| Instructions, project memory, documents | Visible project aside and project chats | Existing preview/edit/clear/library/download/source rules and locked-QA separation |
| Chat file input, paste, drop, preview/remove | Bottom composer | Existing policies; attachment-only submit; isolated draft state |
| Project file input/drop/manual text | Project files section/library | Separate drop target, existing limits and private-storage fallback |
| General QA plus five tasks and models | Composer controls | Existing routing; shortcuts never overwrite nonempty drafts |
| Settings, theme, locale, usage, account memory | Account menu/settings | Keep en/ar/de, RTL, guest recovery and account ownership boundaries |
| Named MCP/REST credentials | Project integrations / existing QA setup | Create/copy/revoke, one-time secret reveal; not an online-agent count |
| Runner profiles/connectivity | Separate integrations section | Real ONLINE/OFFLINE/INCOMPATIBLE; no simulated browser or automatic run |

## Original phase-one regression scenarios (historical scope)

- Scope unsent text/mode/model/files by owner and chat/new-project context in
  memory only. Navigation retains drafts; logout disposes them and object URLs.
- A delayed file conversion/upload/AI response cannot clear a different draft,
  cross accounts, recreate a deleted chat, or undo a rename/project move.
- Keep sent attachment metadata, history, copy/export, quota errors and model
  compatibility. Do not silently expand file formats, quotas, or export scope.
- Exercise menus by keyboard/touch, viewport clamping, Escape/return focus,
  mobile project panels, and composer visibility under long content.
- Run frontend typecheck/tests/i18n/build and full `verify`; record actual
  results in handoff. A visual mockup is not runtime evidence.

Local artifacts and prior preview/design files are preserved. Delivery does not
authorize a commit, push, publication, or mutation of the approved smoke record.

## Verification checkpoint — 2026-09-14

- Full `npm run verify`: passed; final web suite 321/321. Backend, Runner and
  execution-contract checks/tests remained green without source/schema changes.
- `build:web` and i18n 7/7 passed. Build used placeholder
  `VITE_API_BASE_URL=https://api.example.test`, not a deployment configuration.
  Project context is lazy-loaded; the initial JS chunk is below Vite's 500 kB
  warning threshold without increasing that threshold.
- Chromium UI smoke: 16/16 scenarios, no page errors, using only intercepted
  fixture APIs. Desktop plus 320/390/991/992px; en/ar/de, RTL, light/dark; draft
  switching, model/startup races, project context, menu focus/clamping, separate
  chat/project file input/drop (and chat paste), JSON download/import, project
  ZIP include-chats control, normal login and legacy QA navigation.
- Run with Node 24.19.0 and a local Vite server:
  `npm --prefix apps/web run dev -- --port 5182 --strictPort`, then
  `node apps/web/scripts/ux-navigation-smoke.mjs` from repository root.
  Generated screenshots are in `work/ux-validation`; browser context is isolated.
  Requires the existing Runner Playwright dependency and installed Chromium.
- All API routes are fixtures, and external requests are aborted. This does not
  establish private-storage upload success, real API persistence, production
  readiness, a new QA execution, or fresh database-integration verification.
- Remaining product work is explicit in `AI_HANDOFF.md` and `NEXT_STEPS.md`.

## Core visual refresh checkpoint — 2026-09-19

- The owner explicitly chose visual quality for Home/chat/projects first;
  QA flow redesign and durable chat-to-QA linkage remain separate work.
- Opt-in `workspace-surface` tokens and styles modernize shared navigation,
  core pages and their Teleported menus/dialogs. Shared QA connection management
  accepts a presentation-only opt-in from Project Integrations; QA/auth/settings
  main content retains its original colors and typography. No global root theme
  replacement, route/API/schema change, UI dependency or new execution control.
- Desktop sidebar/context widths are 248/288px; reading/composer lanes max out
  at 740px. Keep the 991/992px breakpoint and visible desktop project context.
  Assistant output is unboxed, document sections lighter, starters above the
  composer, and attachment/native task/native model/send controls in its toolbar.
  The text input's focus indicator is the outer composer ring, not two rings.
- All original preservation requirements above still apply. Six new static
  contracts cover composer structure and Teleport/shared-dialog boundaries.
  Full `verify` passed (327 web tests), i18n 7/7 and web production build passed.
  Initial JS remains below 500 kB without changing the warning threshold.
- Isolated Chromium smoke passed 19 scenarios, no page errors. Coverage now
  includes 1440/1024/992/991/390/320px, both themes, en/ar/de, rich Markdown,
  composer/control visibility, open mobile context panels, explicit scoped
  menus/dialogs, 248/288px geometry and legacy QA/auth/settings isolation.
  Settings fixtures include a valid updatedAt; the first extended smoke exposed
  that missing fixture field, not a changed Settings implementation.
- Visually reviewed rendered Home, chat, project, mobile RTL and dialog/menu
  screenshots against the focus prototype. Current captures are under
  `work/ux-validation` (for example `chat-en-1440-dark.png`, `project-light.png`,
  `chat-ar-320-dark.png`). A stale `failure.png` is not the final state.
- No real account/provider/storage/QA mutation, commit, push or deployment.
  No new database-integration or production smoke run is claimed.

## Accumulated publication review — 2026-10-07–08

See `PRE_COMMIT_REVIEW.md` for the final verification ledger and boundaries.
Review regressions preserve stored project drafts across fresh page loads,
project moves and late account/navigation responses; guard provider calls from
stale worker claims; and cover both session-turn aliases before body parsing.
No QA approval, snapshot, import/export authority or execution contract was
relaxed. Security dependency updates retain the same application interfaces;
the real Nodemailer package is exercised offline, not through real SMTP.
Only reviewed implementation, maintained tests and curated evidence are eligible
for the authorized branch push; raw local artifacts and Eluthira stay excluded.

## Pre-commit review checkpoint — 2026-09-20

- MR-style review covers the accumulated shell and visual changes, including
  account/project isolation, late async results, menus and portability.
- A real 390x667/320x568 regression was found: open Files plus a multiline
  attachment draft could clip the composer. The mobile-only fix keeps project
  content scrollable with a sticky composer. Chat gives context a nonzero row
  and an overflow fallback instead of collapsing it; `.chat-area` remains the
  message-autoscroll target. Very short views can require scrolling between
  context and the composer, without losing either set of controls.
- Short-height browser cases exercise file preview, context close/reopen and
  returning to the composer. All APIs remain isolated fixtures. Native mobile
  keyboards and real-device execution are not claimed by these viewport tests.
- Final smoke passed 21 scenarios with no page errors; screenshots were
  inspected. Full `verify` passed during review, web check/tests passed again
  (327/327), and the final CSS passed the production web build. i18n passed 7/7
  and the full dependency audit reported zero advisories. No new live database,
  provider, private-storage or production verification is implied.
- The owner authorized commit and branch push, not merge or deployment. Local
  previews/design boards and generated screenshots remain outside the commit;
  screenshots can be regenerated using the checked-in smoke script.
