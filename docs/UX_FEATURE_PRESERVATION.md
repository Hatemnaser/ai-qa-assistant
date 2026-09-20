# Focused workspace — implementation acceptance map

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

## Required regression scenarios

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
