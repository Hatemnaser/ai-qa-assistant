# Phase 06A — unified session message repair

Date: 2026-10-14. The owner authorized repair of the remaining P2 from the
independent repair review. Phase 06A remains pending independent acceptance;
public activation remains NO_GO.

The previous repair corrected the chat-history DTO, but `/api/sessions/:id`
used a separate mapper. It still exposed the old local draft model for legacy
external imports and omitted saved error flags. The real SessionPage therefore
displayed a successful-model label for unknown historical models and failed
requests.

Both readers now use the same small `recordedMessageMetadata` projection.
Retained `imported.originalModel` takes precedence over a legacy inferred row
model; null/missing/blank recorded models remain unknown (empty string).
Known model strings remain intact, including external or retired models.
Error flags reach the unified DTO and its frontend type, allowing the existing
Vue component to suppress successful-model labels for failed requests.
The session transcript export retains that same error flag through JSON
export/import, so reopening exported history does not relabel a failed request.

Only message presentation is shared. Session ownership, timeline order,
attachments, QA state transitions, approval, browser/login/Stop, Runner and
quota/provider behavior retain their existing implementation. No database
migration, backfill or new dependency is included. Historical inferred models
without retained provenance cannot be recovered reliably.

The guarded PostgreSQL regression saves current history/error messages,
recreates retained legacy import metadata, reads the same rows through both
real services, and verifies matching model/error information. It also verifies
that reads leave database rows unchanged and reject a different owner.
With `ODDPATH_MODEL_HISTORY_DTO_FILE` set to a scratch output path, the test
writes the actual unified service response. The maintained model browser suite
consumes that same file and checks the real SessionPage before and after a
reload, then repeats the assertions after transcript export/import. Its API
transport is a fixture; no live authentication or provider is
claimed. Without that explicit file, this chained browser case is skipped
with instructions to run the guarded database suite first.

Original implementation, repair and independent review evidence remains
unchanged. Fresh validation for this repair will be retained separately in
`evidence/phase-06a/session-review-fix-validation.json`. Independent review is
the next gate before Phase 06B durable quotas/browser reservations.

Fresh final validation: full `npm run verify` passed with 1,917 passing tests
and one existing Windows vault-journal skip. All 110 disposable PostgreSQL
tests, migration deploy and dump/restore passed. The actual unified service DTO
was consumed by the maintained browser regression: all 9 model/history and 19
resource/viewer/consent/production-CSP cases passed in Vue/Chromium, without
retries or overlapping builds. API/web production builds and diff checks
passed; the existing bundle-size advisory remains. Owned test resources were
cleaned up. Independent repair review is pending.
