# Chat / QA navigation checkpoint

Historical checkpoint: the 2026-09-28 unified session workspace superseded
this visible split. See `UNIFIED_SESSION_CHECKPOINT.md` for current behavior;
keep this document as verification history, not implementation instructions.

Updated: 2026-09-27. Local implementation on the existing dirty `main`.
This is the owner-approved navigation-only slice, not a new execution workflow.
Earlier Test-session/API/schema/Runner work remains preserved in this checkout.
No commit, push, deployment, working-database migration or real QA run belongs to
this slice. Do not use either approved smoke record as a mutable fixture.

## Delivered behavior

- A labelled native workspace selector lives with the Oddpath brand. The mobile
  bar identifies the active workspace. Shared account menu and accessible drawer
  remain; Escape restores focus. Chat keeps project trees, expandable project
  chats, recent chats and all existing menus/actions in ConversationSidebarContent.
- QA uses TestSidebarContent and a summary-only list: project filter, newest
  sessions, known phase, collapsed archives and labelled legacy records. No
  per-row detail fetches or exhaustive outstanding-approval claims were added.
- The QA filter affects only the list. New Test uses that filter, or an unscoped
  draft for All projects. An open saved session/legacy request shows its own
  immutable project as a details link, even when filtered out.
- Manage projects is present in both sidebars. Shared ProjectsPage defaults to
  Chat; its QA variant shows project tests and New Test instead of the Chat
  list/composer. Explicit cross-workspace project actions preserve project identity;
  ordinary workspace switching restores each space's independent work.
- Instructions, Memory, Documents/upload/preview and Integrations reuse existing
  context components, labelled Current project context. Desktop panels and named
  mobile controls remain. No RAG-used/source-count badge. Project IDs, retrieval,
  immutable QA snapshots, approvals and execution APIs are unchanged. Editing
  current context does not rewrite an earlier request's snapshot.

## Navigation contract

- Owner-scoped `oddpath:navigation:v2:<owner>` stores identifiers only: active
  workspace, both destinations and QA filter. The old `oddpath:last-work:v1` hint
  seeds a missing v2 entry. Bad/disabled storage is non-fatal.
- Chat destinations are Home, a chat/draft, or project details. QA destinations
  are session/request or new-test draft. QA project management/settings do not
  replace the last QA session; Chat project details are a Chat composer destination.
- `#/projects?view=tests&projectId=...` hosts shared details in QA. Optional
  project IDs work in Chat too; `#/projects` remains the Chat index. Existing
  Tests/request and Chat links remain valid.
- Explicit routes/history beat storage. Restoration authorizes the destination
  against current server indexes. Confirmed missing destinations fall back to
  their workspace start; read failure preserves the saved destination and offers
  retry. Late completion cannot override newer navigation or another account.
  Failed restoration leaves the selector showing the actual current workspace.
- The brand opens the workspace beginning without creating records. Draft text
  and files remain in the existing owner-scoped in-memory registries across
  switches. This is **not** new unsent-file persistence across a browser reload;
  only navigation identifiers are persisted in this slice.

## Verification

`npm run verify` passed **1,409/1,409**: API 948, web 439, Runner 18 and execution
contract 4, including type and architecture checks. Expanded Test smoke:
**62 scenarios passed**. Ordinary Chat smoke: **21 scenarios passed**. i18n:
**7/7**. Web build and `git diff --check` passed. Logs are under
`work/workspace-verify-final.log`, `work/workspace-browser-final.log`,
`work/workspace-chat-browser.log`, `work/workspace-build-final.log` and
`work/workspace-i18n.log`. Browser APIs are intercepted; external traffic is
blocked. No provider, database or real Runner is involved.

After the final sidebar binding cleanup, the web type check, all 439 web tests
and web build were rerun successfully (`work/workspace-web-final.log`). The
temporary fixture Vite server on port 5182 was stopped after verification.

The new scenario covers two independent projects, filter isolation, unscoped and
project drafts, attachments across switches, archives, legacy records, shared
project details, failed-index retry, history/reload and zero navigation writes.
Existing exact approval, production/account isolation, upload and portability
tests remain intact. Chat browser checks include project file/drop/preview,
composer input/drop/paste, import/export, drafts and delayed account settings.

The visual matrix covers en/ar/de, light/dark, widths 1440/1024/992/991/390/320,
including 390x667 and 320x568 phones. It captures the actual QA session, sidebar
drawer and shared QA project details with long names. Geometry/access checks and
representative visual inspection are not a real-device keyboard certification
or an independent user's unassisted usability study.

The final matrix produced 150 actual-render screenshots in
`work/test-session-validation/2026-09-27T20-43-26-719Z/` (local ignored evidence),
including `navigation-ar-dark-390x844.png`, `de-light-992x900.png`,
`qa-project-de-dark-320x568.png` and `qa-project-ar-light-1024x900.png`.
Shared Chat regression screenshots remain under `work/ux-validation/`.

Build verification uses Node 24.19.0 and process-only
`VITE_API_BASE_URL=https://api.example.test`. The local HTTP origin is correctly
rejected by the production security-header guard. No environment file was edited
and no security guard bypassed. The existing >500 kB main-chunk warning remains.

## Next slice: real session tabs, not a second sidebar

Future QA session tabs can expose Conversation, Checks/Results, Files and a real
Browser surface under the same session/request identity. Keep the decision card
and composer reachable outside tab content. Tabs must not grant approval, rewrite
project context or silently retarget new commands. Browser streaming/interaction
needs a separate security design: Chromium in the Runner is not an embedded live
browser. No fake tabs, stream, takeover, new MCP, provider or agent orchestration
was implemented here.

Next acceptance: an unfamiliar user switches between Chat in one project and QA
in another, finds shared context and starts an unscoped draft without assistance.
Then review the accumulated local changes before any owner-authorized commit/push.
Production readiness remains a separate gate.
