# Phase 06A — review repair

Date: 2026-10-14. Owner authorized repair of the two retained independent
review findings. This is repair of 06A, not a new Phase 06B implementation.
Independent review of the repaired version is still required. Public beta
activation remains NO_GO.

F1: the draft selection/default remains independent from historical message
metadata. Missing/null/blank message models normalize to an empty string,
meaning unknown, through local import, storage, JSON export and account
persistence. Markdown/CSV do not substitute the chat's selection for a missing
message model. Error flags survive import, so failed responses do not receive
the successful-model label. Known historical model strings remain intact,
including models no longer in the local generation catalog. The existing Vue
label already suppresses empty models and Auto.

Account message validation accepts missing/empty model metadata while the
chat's selection still has its existing nonempty default. Account DTOs do not
invent a model for null database values. New external imports store their
original model, or null; existing external imports use retained original-model
metadata instead of their former local draft model. No database migration or
historical bulk update is involved. A historical row that already contains an
inferred model without provenance cannot be distinguished from a recorded
model by this repair.

F2: the Gemini adapter now recognizes a narrowly identified model-specific
404/NOT_FOUND for the selected model and normalizes it to MODEL_UNAVAILABLE.
The existing Auto-only fallback gate then chooses a compatible registered
model. Explicit selection still returns the error after one model attempt.
Generic missing resources, another model's name, invalid input and permission
errors remain ineligible. Provider messages are not exposed. No model catalog,
pricing, provider integration or live availability check is added.

Regression coverage includes missing/known historical model import/export and
local reload, account schema/DTO save/reload, real PostgreSQL persistence, the
actual Vue model label, and the installed Gemini SDK with every network fetch
intercepted by synthetic responses. Provider calls are not paid/live.

Validation results and source hashes are retained in
`evidence/phase-06a/review-fix-validation.json` after completion. The original
implementation ledger and independent review artifacts remain dated evidence.
Preserve the existing session, QA controller, Runner/browser/login/Stop and
approval boundaries. Durable quotas/browser reservations and public auth/email
remain later Phase 06 slices.

Final repair verification: `npm run verify` passed with 1,917 passing tests and
one existing Windows vault-journal skip. All 109 disposable PostgreSQL tests,
migration deploy and dump/restore passed. Eight model/history UI journeys and
19 resource/viewer/consent/production-CSP journeys passed in actual Vue/Chromium
without retries or overlapping builds. API/web production builds and diff
checks passed; the existing web bundle-size advisory remains. Temporary
resources were cleaned up. Earlier new-fixture/runtime and test-type failures
are retained separately in the repair ledger. Independent repair review remains
pending.
