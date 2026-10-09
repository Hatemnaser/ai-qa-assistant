# Unified session workspace checkpoint

Historical presentation checkpoint. Superseded on 2026-10-03 by
`ONE_SESSION_CHECKPOINT.md`: no explicit Chat-to-Test conversion control; one
server-managed session facade and timeline. Its migration activation boundary
supersedes the no-new-migration description of this earlier presentation slice.

Presentation follow-up (2026-09-29): read `SESSION_DOCK_CHECKPOINT.md` for the
shared floating writer, single decision, responsive flow fallback and real
Context/Files separation. This document records the earlier unified shell.

Updated: 2026-09-28. Local, uncommitted work on the existing `main` checkout.
This replaces the *presentation* split described in
`WORKSPACE_NAVIGATION_CHECKPOINT.md`; that file remains a historical checkpoint.
The QA records, permissions, Runner contract, and exact approval gates are not
replaced by chat messages.

## User-facing architecture

- One sidebar groups ordinary conversations and Test sessions under their shared
  projects, with recent work and archived Tests. There is no Chat/QA product
  selector or QA-only project tree. Project management remains accessible.
- One central writing/reading surface is used for a conversation or Test. An
  explicit **Start a test** action turns an existing saved Chat into a Test with
  the same identifier and transcript. A new unsent draft can instead start a
  Test without first creating an empty Chat. Neither navigation nor conversion
  prepares or executes a QA run.
- The right work panel exposes project context and files. In a Test it also has
  saved QA results. On a narrow screen it is a named, collapsible panel; Escape
  closes it and returns focus. On a short phone an open project panel lets the
  document/history area scroll instead of placing it beneath a large draft.
  Focusing the composer collapses that mobile panel; a long attachment draft
  stops using a sticky composer on a very short phone so history stays tappable.
- Project details show both conversations and Tests. The existing instruction,
  memory, document/upload, integration, import/export and ordinary-chat task
  controls remain available. General Test discussion uses the existing
  structured QA brief; the other five QA task modes are advisory replies and
  cannot become execution approval by themselves.
- Last-work restoration uses one owner-scoped destination. Explicit links and
  browser history win; old `#/chat`, `#/tests`, and project URLs still work.
  Older local navigation formats are read as a fallback. Unsent text/files stay
  in the existing account-session draft store, not localStorage.

## Conversion and safety boundary

- `POST /api/projects/:projectId/test-sessions/activate` requires owner access,
  the original Chat ID, expected server timestamp, and message count. Inside a
  transaction it locks the project and Chat, rejects another owner/project,
  checks attachment ownership/readiness/scope, and changes the Chat kind while
  creating its TestSession row. A replay for that same project is idempotent.
- The web first waits for normal Chat persistence and compares the canonical
  server transcript before calling activation. A stale or failed conversion
  leaves the conversation and its unsent draft in place. On success the Test
  screen receives that draft, mode, model and selected attachments.
- QA proposal confirmation, immutable Recipe review, chosen Runner/profile,
  production confirmation, exact run approval, evidence requirements and final
  human record review remain explicit. Typing “run” does not authorize them.
  Saved results/old QA records are read from their original QA tables.
- No automatic link is inferred from matching names. Legacy QA requests retain
  their explicit open/link flow. Existing approval records are not rewritten.

## Verification and limits

The full `npm run verify`, Prisma schema validation, i18n tests and production
web build passed on Node 24.19.0. The intercepted-API Test browser smoke passed
63 scenarios spanning en/ar/de, light/dark, 1440/1024/992/991/390/320px and
short phones. It covered drafting, legacy records, archives, exact run/review,
offline Runner recovery, missing evidence, explicit same-ID Chat promotion,
project context and mobile focus. Local screenshots are under
`work/test-session-validation/2026-09-28T15-20-53-970Z/`.
The ordinary Chat/project browser regression passed all 21 scenarios, including
file picking/dropping/preview, chat import/export, drafts, account isolation,
auth/settings boundaries, and 390×667/320×568 with a multiline attachment
draft. Its local screenshots are in `work/ux-validation/`.

No real approved QA record was used as a mutable fixture, and no real Runner or
provider was contacted by browser tests. The isolated PostgreSQL suite was not
run in this round because no explicitly named disposable test database was
available; the working database must not be substituted. No migration was
applied to the working DB in this round. No commit, push or deployment occurred.

Deferred: live browser/Android tabs, take-over, parallel agents, provider or
MCP additions, Jira/Figma/MR integrations, and an independent first-user study.
