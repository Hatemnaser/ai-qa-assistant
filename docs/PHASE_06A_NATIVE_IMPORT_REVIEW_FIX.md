# Phase 06A — native account import model repair

Date: 2026-10-14. The owner authorized repair of F1-R2 from the independent
unified-session repair review. Independent acceptance of Phase 06A remains
pending; public activation remains NO_GO.

Native account imports and external provider imports both use an `imported`
metadata envelope. Native archives retain their recorded model in the message
row, while external imports additionally carry an explicit `originalModel`
field. The shared reader previously treated every envelope as that external
format, blanking known native archive models and propagating those empty
values through export and subsequent saves.

The projection now overrides the row's model only when the envelope has its
own `originalModel` field. An explicit null or blank original model remains
unknown for external imports, even if the old row contains an inferred draft
default. A native account envelope without that field retains the actual row
model. Error flags keep the same behavior. This is a change to historical
message projection; it adds no migration, backfill, dependency or provider call.

Account/project canonical ZIP message exports use that same projection too.
Otherwise an older external import's inferred raw model could be exported as
recorded fact and lose its provenance when restored as a native account import.
Known native row models remain intact, and unknown portable models are null,
as permitted by the existing archive contracts. Two regressions exercise the
actual ZIP exporters and import validators with both provenance formats.
Previously erased model values without another retained source cannot be
reconstructed reliably.

The maintained service test now covers native known, unknown and failed
messages alongside external known/null and ordinary retired models. A new
guarded PostgreSQL regression uses the real native account importer, verifies
both readers and read-only row preservation, then validates and saves the
history DTO and checks the stored/reloaded models again. It writes its real
session response when `ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE` names a scratch
file. The maintained browser suite consumes that response, tests initial
rendering and reload, then checks transcript JSON export/import and waits for
the imported message IDs before checking the labels again.

Run the database suite with both `ODDPATH_MODEL_HISTORY_DTO_FILE` and
`ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE` set, then run
`node --test apps/web/tests/modelSelection.browser.mjs` with the same paths.
These chained cases explicitly skip without their respective database DTO
file. PostgreSQL services and Vue components are real; the browser API
transport remains a fixture rather than a live auth HTTP end-to-end claim.

Original ledgers and review evidence remain dated records. Final validation
for this repair is recorded separately in
`evidence/phase-06a/native-import-review-fix-validation.json`. Independent
repair review is the next gate before Phase 06B quotas/browser reservations.

Fresh final validation: `npm run verify` passed with 1,919 passing tests and
one existing Windows vault-journal skip. All 111 disposable PostgreSQL tests,
migration deploy and dump/restore passed. Ten model/history journeys, including
both freshly generated service DTOs and native archive transcript roundtrip,
and all 19 resource/viewer/consent/production-CSP journeys passed in actual
Vue/Chromium without retries or overlapping builds. API/web builds and diff
checks passed, with the existing web bundle-size advisory. Owned resources
were cleaned up. Independent repair review remains pending.
