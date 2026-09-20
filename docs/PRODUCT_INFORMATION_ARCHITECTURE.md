# Oddpath Product Information Architecture

Last updated: 2026-09-20

Status: the broader direction below began as a proposal. The owner approved a
bounded phase-one shell, now implemented locally as recorded immediately below.
Later session/live-browser ideas remain proposals, not shipped capabilities.
Read `PRODUCT_UX_DIRECTION.md` for the thesis, limits and safety constraints.

## Phase-One Implementation Checkpoint — 2026-09-14

- `#/home` is explicit new-conversation home with recent chats and a bottom
  composer; normal sign-in and the brand go there. Legacy `#/` remains Tests.
  New Chat restores an unsent unassigned draft without persisting an empty chat.
- Sidebar project name opens details; its separate chevron expands conversations.
  Recent chats include project labels and avoid duplicating expanded children.
  Existing chat/project menus, rename/move/delete and import/export stay usable
  by mouse, keyboard and touch. Mobile uses an accessible navigation drawer.
- Project instructions/memory/files remain visible in the desktop side column
  of both project and project-chat views, per the owner's latest decision.
  Narrow layouts expose named controls. Project/attachment drop targets stay
  distinct; project CRUD, manual text, previews, library and portability remain.
- All six task modes and model selection live at the composer. Three starters
  never replace typed text; an attached image offers contextual Visual Review.
  Existing Visual Review model routing and file policies are unchanged.
- Unsent text/mode/model/files/quick-action state is per owner and chat/new
  project, in memory only. Slow work keeps its original identity and target;
  account settings seed future drafts without overriding existing choices.
- Project Integrations separates named inbound MCP/REST credentials from Runner
  credentials and live profiles. It reuses existing create/copy/revoke contracts.
  It can list multiple named connections; it is not a new MCP/plugin platform.
- QA Requests and chats remain separate records. The old QA Workspace and exact
  approval/recipe/evidence lifecycle still work; no new session schema, inline
  run approvals, browser streaming, takeover or mobile execution was introduced.

Full `verify` and 321 web tests passed on Node 24.19.0. The reproducible
`apps/web/scripts/ux-navigation-smoke.mjs` passed 16 intercepted-API Chromium
scenarios, including login, direct Home reload, sidebar menus/focus, drafts,
model races, input/paste/drop and JSON/ZIP controls in responsive en/ar/de UI.
This validates actual Vue components with fixtures, not live backend data or
an external participant's usability. See `UX_FEATURE_PRESERVATION.md` for scope.
At that checkpoint changes were local/uncommitted; no deployment, credentials,
database or approved smoke records were changed. The owner later authorized
review and branch commit/push. See `AI_HANDOFF.md` and Git for current status.
Earlier prototypes and unrelated edits are retained locally, not bundled into
the application commit. Paths under `work/` are optional local design/validation
artifacts; regenerate validation screenshots with the smoke script above.

## Owner Feedback And Current Friction

The first interactive session concept felt better, but still had too many
steps. The owner wants the public home, post-login home, sidebar, existing chat,
and projects to make sense together. Improving only the Run dialog is not enough.

Baseline code audit before phase one (historical, not the current shell):

- `apps/web/src/router/useAppRoute.ts`: QA Workspace is the default route;
  Chat and Projects are separate destinations.
- `apps/web/src/App.vue`, `handleAuthenticated`: sign-in goes to Workspace,
  rather than restoring a specific interrupted task.
- `apps/web/src/features/chat/components/ChatSidebar.vue`: Workspace,
  Projects, and QA Chat are top-level entries; All Projects appears again.
  A project name expands chats; a separate arrow opens the project.
  Recent Chats excludes project-owned chats once projects exist.
- `apps/web/src/features/projects/ProjectsPage.vue`: project detail has a
  composer, chat history, and knowledge. Empty Projects opens creation automatically.
- `apps/web/src/features/qa/QaWorkspacePage.vue`: another selector chooses the
  same project, with a separate request list; QA creation requires a project.

These are presentation problems to address deliberately, not reasons to remove
project ownership or rewrite the completed QA lifecycle.

## Recommended Mental Model

Three user-facing concepts: **Home** to start or resume work; **Project** for
shared context and organization; **Session** for discussing, preparing, following,
and inspecting one task.

Session is a presentation concept, not a replacement for Chat, QA Request, Run,
Recipe, or evidence records, and not an authentication session. Not every chat
needs QA; not every QA record has a chat. Never infer links between existing
records from similar titles or timestamps.

## Page Responsibilities

| Surface | Primary purpose | Keep out of the first view |
| --- | --- | --- |
| Public home, signed out | Brief value statement, honestly labeled example, sign-in and existing invite-only beta access path | Operational queues, project setup, unimplemented live-control claims |
| Home, signed in | One goal composer, optional target URL, visible project context, recent work and items needing attention | Another dashboard tour, automatic project-creation dialog, Runner jargon |
| Project home | Same start composer scoped to the project, recent work, secondary Context and Settings | A separate chat product or duplicate project selector |
| Session | Conversation plus structured plan/progress/results in one persistent surface, with one primary next action per state | Repeated modals and banners, raw hashes as primary content |
| Account settings | Language/theme, usage, account data and account controls | A mandatory step before each test |
| Project settings / Integrations | Scoped external-agent connections, executor setup and diagnostics | An implication that MCP is required for the built-in Runner path |

This is a logical map, not new URL contracts. Preserve current deep links and
ownership checks during a later migration; do not introduce redirects now.

### Public Home And Sign-In

The public home explains the product; the signed-in home helps the user work.
Do not expose the full operational shell as the first explanation of Oddpath.
Preserve invite-only launch policy and the existing guest/demo chat path. This
proposal does not open signup, remove guest data, or add a waitlist service.

After sign-in, prefer returning to intended authorized work; otherwise show
Home. Restoring a draft must not submit it or start a run. Validate internal
return targets and access. Do not transfer an old account's private draft into
a new account. Preserve reset/verification, guest adoption, and stale-response
protections. This return behavior is proposed, not implemented.

### Sidebar

- Oddpath brand opens Home; it does not start or discard work.
- One primary **New session** action opens the empty composer.
- One **Projects** section: its heading opens the index; project names open
  their homes; a separate accessible chevron may expand their work. Creation
  belongs here, without a second All Projects navigation entry.
- **Recent work** shows shortcuts across projects with context and type/status
  labels, including projectless chats. It aggregates records, not duplicates or
  reassigns them. Avoid presenting a linked chat and QA request as duplicate work.
- The account menu contains settings and usage. Project-scoped integrations
  remain accessible from the project and relevant inline setup state.

No parallel top-level Workspace / QA Chat choice in the proposed main journey.
On small screens use a sidebar drawer; the active session keeps its own title,
context, status, and next action without requiring that drawer to stay open.

### Chat And Projects Within The Session

Reuse chat to ask questions, refine plans, explain failures, and draft reports.
Structured execution status, approval controls, and evidence remain authoritative;
assistant prose is not an execution receipt. A conversational "looks good" is
not consent to run tests.

The composer need not demand a Chat-versus-Test mode choice. Its response can
propose a next step, never infer authority to execute. Clarify ambiguous intent
before creating QA work. Preserve ordinary chat, attachments, usage, persistence,
and import/export; do not force every conversation into the QA lifecycle.

Project Context holds instructions, manual memory, and documents. Show what is
included in the session; preserve the locked snapshot of an existing QA Request.
Changing project knowledge must not rewrite approved instructions. This does
not add multi-user membership or change current owner-only project access.

For a first QA request, recommend inline project selection/creation after the
goal is entered, keeping the draft. A suggested name can help, but creation
needs an explicit action and normal quotas/access checks. Do not create hidden
default projects merely by loading Home. Projectless chat remains supported.

## Fewer Steps, Same Safeguards

The experience should feel like **describe -> review and run -> inspect**,
not a six-page wizard. These are three work moments, not a three-click promise.

| Moment | Interaction | Boundary |
| --- | --- | --- |
| Describe | Goal, target when needed, project context; ask only for missing information | Sending a message does not start execution |
| Review and run | Readable plan and required setup stay in the session; identify the current missing prerequisite | Owner checklist selection, reviewed Recipe, exact request/profile/hash approval, and production confirmations remain enforced |
| Inspect | Summary first; select a finding for expected/observed/evidence; review the QA record when ready | Required evidence and final Human Review remain separate from execution approval |

Ready prerequisites need no ceremonial clicks. Resolve blockers inline without
repeating completed setup on every run. A failed review offers same-Recipe retry;
an offline executor offers connection help. Disabled actions have an accessible
reason. Asynchronous generation/review must have honest progress and recovery.

Never silently select a checklist or treat plan preview as selection. If several
owner decisions share a review region, keep each explicit and use its current
lifecycle operation. Combining them transactionally needs separate domain review.

## Browser And Evidence Placement

Conversation and structured work occupy the main session surface. A secondary
browser/evidence panel appears when useful, beside it on wide screens or through
an in-session switch on narrow screens. Avoid three permanent Overview/Live/Debug
dashboards. Users should not have to watch a browser to finish a test.

Distinguish progress, a real local browser window, embedded live view, recorded
evidence, and an offline executor. Simulated movement is not a live run. Streaming,
credential handoff, takeover, pause/resume, and safe step replay remain separate
unbuilt capabilities. Never ask for test-site passwords in chat. A visible
browser alone does not implement safe interactive login.

Recovered processing failures belong in expandable history; current blockers
stay prominent. Failed checks, setup errors, intentional negative tests, and
approved QA records with FAIL outcomes must remain distinguishable.

## Broader Implementation Order — Historical Proposal

1. Review one whole-shell prototype: signed-out home, signed-in empty/returning
   home, Project Context, an existing chat, and a test session. Reuse the first
   concept as exploration and remove unnecessary ceremony.
2. Agree a navigation-only slice: sidebar/project entry clarity and in-place
   context, with current routes/data reachable. Cover regressions before
   changing login return behavior or route mapping.
3. Integrate preparation/execution/results into the session surface with explicit
   gates. Specify chat-to-QA linkage and the recent-work read model first;
   a mockup is not evidence those integrations already exist.
4. Scope visible-browser delivery separately; basic navigation improvements need
   not wait for a streaming/takeover architecture.

Avoid migrations, a new session entity, new AI providers, deployment, or a broad
backend rewrite in a navigation-only slice. Make any necessary new persistence
or APIs explicit rather than calling them a presentation-only change.

## Validation And Remaining Choices

An unfamiliar tester should start without choosing Chat versus Workspace, find
older work, open a project, resume after login, understand approval, distinguish
live execution from a demo, and locate proof without searching a long transcript.
Check keyboard/focus, identity switching, empty/error/loading states, en/ar/de,
RTL, and small screens. Prototype checks are not a real onboarding trial.

Owner review remains necessary for these navigation choices and labels, the first
beta use case, and executor/visual scope. Mobile, billing, more integrations, and
per-PR environments are not bundled into this decision.

## Quick Actions And Existing Features — Prototype Decision

The owner asked us to use judgment about the existing quick actions, not simply
copy their current placement. The code audit found five generation modes exposed
in the composer, four repeated in empty chat, and the same modes in the topbar.
They prefill/select a request; they do not execute a test.

The proposed default keeps three empty-composer starters (Test Cases, Bug Report,
Visual Review), with all five modes plus General QA in one message-task menu.
Edge Cases and QA Checklist remain distinct outputs, not deleted capabilities.
Starters preserve a nonempty draft. Treat an override as applying to this message,
then return to General QA; this unifies two differing current mode lifetimes.
Show an image-review action with an attachment and a report action beside a
finding. The concept also lets the owner compare all-five versus menu-only
placement through its design controls.

Preservation requirements for future implementation:

- Scope the whole draft bundle (text, task, attachment) to its conversation;
  keep submitted attachment metadata and earlier follow-ups visible.
- Retain upload/paste/drop, supported file limits, attachment-only submission,
  and explicit task override. The concept attaches only an example image; it
  does not implement those real file-input routes.
- Keep actual model disclosure/selection in compact message settings. Visual
  Review currently requires Gemini 2.5 Flash; simplification cannot bypass that
  routing. The prototype does not call or implement a model selector.
- Keep copy/export, chat import/export, project assignment, account data/usage,
  guest recovery, and instructions/memory/documents discoverable. Secondary
  menus in the concept show their intended location, not real data operations.

## Whole-Product Concept Checkpoint — 2026-09-12

The local conversation-only concept is
`C:/Users/hatem/.codex/visualizations/2026/08/07/019fdd33-3d71-7d62-8cec-eb3f36e90c78/oddpath-product-journey.html`.
It connects the public home, credential-free demo sign-in, signed-in home,
sidebar/projects/context/settings, ordinary chat, and example QA execution and
review. It uses Arabic RTL by default with an English design alternative.

This is not a production UI change or owner design approval. The browser,
responses, project creation, connectivity, evidence, and approval are all local
simulation. The test target is the read-only public-login example, never a URL
actually visited. Moving from another conversation to that example is explicit
and retains the original conversation. Rich actual-value evidence shown here
is proposed; it is not a claim about the current Runner formatter.

Sandboxed local interaction checks cover draft/attachment isolation, the quick
action path, preserved replies, explicit checklist/run/review gates, continuing
simulation during navigation, stop/retry/offline recovery, and Arabic/English
layouts at 320–1024px. No application API or test-target request is made. These
checks are not an unfamiliar-user usability trial, real auth/file upload, live
streaming, or production validation. Empty-account onboarding and safe real
login return still need their own implementation/prototype acceptance coverage.

## Focused-Shell Concept Checkpoint — 2026-09-13

The owner still found the whole-product concept too complicated. Their latest
reference is a compact Codex-style details menu, not a request to copy every
Codex feature. The new conversation-only alternative is
`work/ux-prototypes/oddpath-focus-session.html`.

- Keep project sessions/history reachable from navigation. Put instructions,
  memory, files, history, and execution details in an on-demand panel.
- Let the center show the conversation, plan, simulated browser, or results.
  Anchor the composer below it; keep pending decisions immediately above it.
- Retain separate checklist selection, exact-run approval, and final QA-record
  review. Enter sends a message; it cannot approve execution. A persistent
  permission card is not a disappearing notification or blanket permission.
- Compare floating versus docked details through the prototype design controls.
  On narrow screens, details overlay only the center, not the approval/composer.
- Keep all five generation modes plus General QA in the message-task menu;
  preserve scoped drafts, attachments, previous replies, and project context.

The source and its local inspection helper/wrapper are isolated under
`work/ux-prototypes/`, not wired into application routes. All responses, evidence,
permissions, files, memory edits, and browser activity are simulated. Recipe and
profile identifiers are readable demonstration IDs, not real immutable hashes.
No real upload, credentials, AI/provider call, Runner, or test-target request is
used. Existing QA context stays fixed when the sample project memory changes.

Local browser checks cover anchored decisions/composer, draft and attachment
isolation, task modes, panel focus, selected-text preservation while another
session runs, inspection of exact actions, stop/retry/offline states, and final
review with the intentional failure retained. Layout checks cover Arabic/English,
floating/docked panels, and 320–1024px widths. This is not a real mobile keyboard
test, newcomer usability trial, live-browser architecture, or production proof.
Owner feedback and the earlier whole-product navigation decisions remain open;
this focused concept does not replace the pending public/auth/onboarding work.

## Historical Interruption Checkpoint — Before Phase One

The owner cancelled an accidental Sites publication request on 2026-09-12.
No Sites project was registered, source pushed, or deployment started. A local
isolated copy and static hosting preparation exist outside the application
repository; do not resume publishing without a new request. The original
visualization, sandboxed iframe, and CSP are unchanged.

This checkpoint changes documentation only. Application code, the database,
approved smoke record, and unrelated preview/design files were not changed.
Git whitespace/conflict checks do not establish new runtime or deployment proof.
