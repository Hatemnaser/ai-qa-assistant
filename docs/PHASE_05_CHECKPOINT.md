# Phase 05 — evidence, retention and export

Started 2026-10-14 after `PHASE_04_CLOSEOUT.md` and owner authorization.
Implementation is local. See `evidence/phase-05/validation.json` for the final
checks when present. Independent review is required before stage 6.
The first review's three findings have authorized local repairs described in
`PHASE_05_REVIEW_FIX.md`, with a separate validation ledger. The original
implementation ledger stays unchanged; independent repair review passed.
Read `PHASE_05_CLOSEOUT.md` for the local closeout and retained evidence.

Scope: server-bound expected/observed provenance, executor timing/step references,
explicit missing/expired binary states, thirty-day expiry for new QA evidence
assets, retained metadata and durable object deletion, bounded JSON/Markdown/ZIP
reports and QA records in project/account portability. Imported QA history is
inert: no approval, execution job, lease, runtime, login state or credential is
restored. Existing storage quotas and one QA controller remain authoritative.

## Contracts and retained boundaries

- New results/evidence store strict provenance from the server's current
  request/item/run and immutable Runner profile. It includes expected result,
  declared target/build, recipe/target hashes, executor and recording time.
  Optional executor observation times and completed/failed step references are
  checked against the approved recipe. Existing v1 submissions without this
  optional observation remain accepted; their unknown timing stays explicit.
  Local v1 HTTP target references remain metadata, with credentials/query/hash
  removed. None of this supplies verified deployment identity or a GO decision.
- New `QA_EVIDENCE` reservations have a thirty-day binary expiry. Legacy assets
  are not retrospectively expired. Downloads reject expired assets, bound TTL to
  expiry and pass a fixed signing date to the AWS presigner. Expired screenshots
  do not satisfy required evidence at finish/review. Historical approvals are
  not rewritten. The UI shows missing/expired files and preserves their receipt.
- Cleanup uses the existing locked durable deletion outbox. It detaches the
  expired object binding, retains its descriptor/checksum and explicit EXPIRED
  reason, then deletes the object and releases quota only after confirmation.
  Provider failures remain retryable; no object key or credential is displayed.
- Owner-only `POST /api/projects/:projectId/qa/requests/:requestId/export`
  accepts strict `{format: JSON|MARKDOWN|ZIP, runId?: string}`. The existing
  cookie/CSRF boundary and portability rate/concurrency guard apply. Historical
  resource exports do not select or mutate the QA controller. Late downloads
  after owner/resource/run deactivation are discarded.
- Reports use QA schema 1; project/account archives containing QA use outer
  format 3.0. Existing 1.0 and 2.0 packages remain accepted. QA JSON/Markdown and
  all included file hashes travel together. Live jobs/leases/approvals, browser
  grants, registration credentials, vault state and arbitrary metadata are
  excluded by explicit whitelists. AI checklist interpretations remain separate.
- QA reads preflight row and byte weight before loading nested records: at most
  50 requests, 5,000 records and 2 MiB normalized JSON per history. Over-limit
  project export fails explicitly and offers per-request export. QA binaries are
  read sequentially, at most 64 files/4 MiB each and 8 MiB together; account and
  project portability share that byte budget with existing binary files. Missing,
  expired, mismatched or unavailable objects are recorded as gaps. Existing
  project/account archive/entry byte ceilings remain enforced.
- Imported QA is stored only in `QaImportedArchive`, disconnected from all
  executable QA models. No requests, approvals, jobs, runtime or login state are
  created. Its history can be exported again. Original QA binary files remain
  in the user's ZIP; the importer validates them but does not restore them as
  active private assets. The preview/commit warns explicitly and imported
  descriptors become NOT_INCLUDED with no live path. Full QA binary restore is
  outside this inert history import; no complete binary disaster-recovery claim
  is made. Existing chat/document binary restore remains unchanged.

The additive migration is rehearsed only in a labeled disposable tmpfs database,
including dump/restore of the complete schema. Production private assets and
portability imports retain their existing fail-closed activation restrictions.

Verify types/architecture/regressions, real disposable PostgreSQL ownership,
expiry/cleanup/migration/restore, portable report hashes and import fences, and
actual resource UI. Real EU R2 interruption proof remains a separate deployment
gate if no test storage is configured. Do not enable production private assets
on the strength of local/fake object-store tests. No paid AI call, public
activation, deployment or migration of the working application database.
