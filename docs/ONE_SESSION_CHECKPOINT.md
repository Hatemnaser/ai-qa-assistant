# One session: conversation first, QA as a capability

Updated: 2026-10-04. Implemented locally on the existing dirty `main` checkout.
No commit, push or deployment. Following separate owner approval, the working
local database received `20261003090000_unified_session_timeline` on 2026-10-04.
See `LOCAL_ONE_SESSION_ACTIVATION.md`: protected backup, restore rehearsal,
23 applied migrations, zero drift, all 47 original-table fingerprints preserved.
Earlier local changes and approved real QA records are preserved.
Post-activation assistant correction: `SESSION_ASSISTANT_CAPABILITY_FIX.md`
records the selected-task persona mismatch, the capability-aware prompt, and
968 passing API tests. Tasks no longer restrict a session's QA capabilities.

## User-facing result

- Authenticated Home, Chat, project work and old Tests links use
  `features/sessions/SessionPage.vue`. There is no Start test control or Chat/QA
  switch. The guest conversation stays on its existing compatible path.
- One account-level session index feeds the sidebar and project session list.
  Failed refresh retains this owner's successful index; changing owner clears
  it immediately. Project management and its existing actions remain available.
- `ChatMessages`, the six-task `ChatComposer`, the floating dock and one mounted
  project Context/Files/Results panel are reused. Tables, code, private file
  references, copying, exports, model choice, paste/drop and drafts stay usable.
- `#/chat?sessionId=…` is canonical, with optional project/request scope. Existing
  `#/tests` links open this same surface. Navigation never creates QA work.
- QA system events and messages share their persisted timeline. Finished record
  approval precedes the later report; a historical request does not silently
  replace the current command target. Event type identifiers remain raw audit
  data, not invented assistant replies or translated historical content.
- Authoritative credits live under the account and refresh after discussion/QA
  work. Incomplete or failed usage reads retain the previous value, never estimate
  a debit. Canonicalizing an old Tests link does not reload projects and erase
  otherwise unchanged consent.

## Persistence and boundaries

`/api/sessions` is an account-scoped facade over the existing Chat/Message,
TestSession extension, turn queue, preparation coordinator and QA services.
New sessions have internal kind `SESSION`; current `TEST` sessions work directly.
Legacy `CONVERSATION` adoption keeps IDs and messages. Pending local saves must
settle first with server timestamp CAS; conflicting snapshots stay unresolved,
with their local cache retained. The old snapshot writer cannot rewrite TEST or
SESSION messages. Imported text remains an ordinary, non-executable conversation.

The additive migration creates the timeline counter/positions and provider-call
and explicit-retry markers. Historical positions use original timestamps, IDs
and available request sequence. This is a deterministic fallback, not recovery
of unrecorded historical ordering. New positions allocate in the same transaction
under session locks; QA request sequence is unchanged.

Discussion uses the current reply/retrieval/usage reservation pipeline, with a
validated internal `{ reply, proposalAction, proposal }` contract. Actual user
content remains the retrieval query; application instructions and bounded QA
context are separate. An ordinary response keeps the pending proposal. Writing
test cases is not execution. No additional classification provider call was added.

One AI turn and one QA work lease are independent. Discussion can continue while
the Runner records results. A subsequent proposal waits for active work before
preparation. The scope confirmation, exact Recipe/Runner/production approval and
record review remain distinct human actions. Chat files are not execution evidence;
record approval is not release permission. Unknown provider outcomes are failed
explicitly rather than silently replayed; an explicit retry reuses the user turn.

Linked QA sessions cannot be moved or deleted by ordinary chat actions; archive
and legacy QA links retain their existing guards. Unlinked sessions can move only
after validating the owner/project/readiness of their attachment assets.

### Private unsent drafts

Authenticated unsent drafts opt into owner/key-scoped IndexedDB, including File
objects, task and model. Live preview URLs are rebuilt, not serialized. Late
hydration cannot overwrite editing or cross an account/project boundary. Submitted
drafts are removed after acknowledged persistence. Rows older than seven days are
discarded when accessed; this is not a guaranteed background disk-erasure timer.
Logout releases in-memory previews but intentionally leaves that owner's unsent
cache available for later sign-in. This cache is not authoritative conversation
storage and never contains approval authority. Guest behavior is unchanged.

## Verification and evidence

- `verify`: **1,442/1,442** tests: execution-contract **4**, API **957**, Runner
  **18**, web **463**, with type and architecture checks. Full log:
  `work/unified-session-verify.log`.
- Isolated PostgreSQL: **35/35**, fresh migrations and a transactionally rolled
  back backfill rehearsal preserving original IDs/text/timestamps/outcomes.
  Separate discussion/QA concurrency, legacy CAS, import ordering and explicit
  provider retry were exercised. Disposable database only, never the real record.
- Session browser: **54/54** intercepted-API scenarios, including message → scope
  → exact run → review → report with a stable ID, equal-timestamp ordering,
  tables/code, draft/file reload, discussion during QA, unchanged consent after
  ordinary discussion, index/usage read failure and teleported menu/Escape focus.
- Session screenshots:
  `work/test-session-validation/2026-10-03T00-02-24-318Z/`.
  Matrix: en/ar/de, light/dark, 1440/1024/992/991/390/320px, including
  390×667 and 320×568. These are local screenshots, not published artifacts.
- Updated UX-navigation browser: **15/15**, no page errors. Covers all six
  modes, starters, tables/code, attachment picker/drop/paste, project document
  upload/drop/preview, integrations, four transcript exports, guarded move,
  project ZIP options, ordinary JSON import and guest/auth/settings boundaries.
  Log: `work/unified-session-parity-browser.log`; screenshots:
  `work/ux-validation/`.
- Translation key/placeholder tests: **7/7**. API/web/Runner builds and Git
  whitespace checks passed. Production web build uses
  process-only HTTPS dummy origins, not the local HTTP development `.env`.
  CSP/EU-R2 origin checks remain intact; the existing >500kB chunk warning remains.

Browser mocks do not prove live provider, Runner, R2 or physical keyboard/mobile
behavior. Existing upload/portability/memory/RAG/security suites are retained;
manual accessibility and an unfamiliar user's first-test check still matter.
The older UX-navigation harness has been updated for this authenticated surface;
the 15 scenarios above are a fresh run, not a historical checkpoint's total.

## Activation and next steps

1. Local activation is complete with separate approval; read
   `LOCAL_ONE_SESSION_ACTIVATION.md` for backup and preservation evidence.
   Read-only API/schema checks are not a live assistant/Runner journey.
2. With a fresh, explicitly chosen disposable request, validate the real assistant
   journey and unfamiliar-user UX. Resolve concrete findings before launch.

Visible browser/streaming/take-over, new tabs, Android, new providers/integrations,
release-readiness certification and publishing remain separate work. Old REST/MCP
QA services, guest chat and preview components are retained for compatibility;
the old authenticated Test page and TestDraftHandoff are removed from the active
journey. Historical checkpoints below this document are not the current contract.
