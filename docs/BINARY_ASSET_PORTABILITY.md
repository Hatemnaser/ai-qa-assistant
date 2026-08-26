# Private Binary Asset Portability

Status: bounded Account and Project archive v2 plus staged restore are
implemented and covered by automated unit/contract tests. The production
private-assets guard remains closed until the provider and interruption gates
below are completed.

## Implemented archive contract

Account and Project portability now support two compatible package versions:

- version `1.0` remains accepted for legacy archives without private binary
  entries;
- version `2.0` is emitted when an export contains stored private assets and
  includes their descriptors, bytes under deterministic `assets/` paths,
  manifest hashes, counts, and total asset bytes; and
- the web Preview/Commit clients accept both versions and surface optional
  binary-asset counts.

Export repositories obtain candidate files from owner-scoped relational
`MessageAttachment` and `ProjectDocument.sourceAsset` links in the same
consistent export snapshot as their canonical messages/documents. The
relation-completeness path verifies that every row has exactly one valid
binding and fails closed on missing, duplicate, cross-owner, non-`READY`, or
ambiguous state. This exact-relation work is implemented and covered by the
recorded repository verification gate.

`apps/api/src/modules/data-portability/binary-assets.ts` provides the shared
provider-neutral contract. It:

- accepts only owner-matching `READY` records with an exact source
  message/document binding;
- never exports an object key or destination account identifier;
- rejects duplicate asset IDs, object keys, archive paths, or bindings;
- reads objects sequentially with count, per-object, total-byte, and path
  limits applied before object-store access;
- verifies database size, object-store metadata, SHA-256 checksums, generated
  file digest, MIME/extension policy, actual byte content, purpose, and
  binding;
- generates traversal-safe deterministic `assets/NNN-name` ZIP paths; and
- validates every untrusted descriptor and byte before storage or database
  mutation.

The shared portability ceiling is 64 assets, 4 MiB per asset, and 8 MiB total.
Existing ZIP entry/compressed/expanded limits remain authoritative where they
are stricter. This is deliberately bounded in-memory packaging, not an
arbitrary-size streaming export promise.

The `AssetStorage` port exposes bounded complete-object reads and immutable,
caller-bounded server-side writes. The R2 adapter reads at most one byte beyond
the declared limit, compares HEAD and GET lengths, uses `If-None-Match: *` for
writes, and supplies exact content length and checksum metadata. Normal private
asset consumption also re-hashes full bytes and verifies length, MIME metadata,
and provider checksum before returning them.

## Implemented restore protocol

Import Preview validates the outer ZIP, manifest entries, binary descriptors
and bytes, source project/message/document bindings, file hashes, MIME/content
policy, and bounded counts before any write, then returns the exact package
digest that Commit must revalidate.

Import Commit uses a staged protocol:

1. Under the same owner advisory quota lock used by interactive uploads, a
   serializable transaction creates destination `PENDING` `StoredAsset` rows
   and durable object-deletion jobs before object storage is touched.
2. The service writes each object under a new server-generated key with an
   immutable bounded write.
3. The canonical Account or Project import transaction generates new local
   IDs, verifies an exact descriptor/upload match, locks the staged assets,
   creates message/document relations, marks assets `READY`, and removes their
   deletion jobs atomically with the imported records.
4. A normal failed write/commit claims only the exact unreferenced
   `PENDING` staging row, changes it to `DELETE_PENDING`, and leaves cleanup to
   the durable worker after a quarantine delay.
5. An ambiguous failure, including a lost database-commit acknowledgement,
   does not delete inline. If the exact staging row cannot be safely claimed,
   it is quarantined and the durable job/state is left for reconciliation so a
   potentially committed `READY` object is not destroyed.
6. The cleanup worker claims a deletion job only when its exact object key
   still joins to an unreferenced `DELETE_PENDING` asset. After provider
   deletion, it removes that exact asset row before releasing the matching job;
   a relation or state change fails closed instead of deleting bookkeeping.

Every staged restore also owns a persisted session/attempt/token fence. The
service revalidates that exact live fence and the complete staged row/job set
before and after every object write and again before commit; finalization
rechecks it inside the canonical transaction. A frozen or stale worker cannot
promote after cleanup takes over. Successful finalization clears both asset
fence fields before deleting the session atomically, while failed-session state
is removed only after its last staged asset is safely deleted.

Deletion workers renew an exact database lease before touching R2 and use that
same lease token as a compare-and-set for failure and completion. A stale
instance therefore cannot overwrite a newer retry or delete relational
metadata. Lease conflicts are surfaced in the sanitized operational event and
make the scheduled command fail for alerting.

Destination storage quota is checked during staging under the owner lock.
Canonical project/chat/memory quotas remain checked in their existing
serializable import transaction. Document indexing still starts only after a
successful canonical commit.

## Verification state

Automated coverage includes bounded collection/validation, v1/v2 package
compatibility, manifest and binding tampering, staging/quota behavior,
immutable write failures, finalization mismatches, rollback cleanup,
persisted-fence freeze/lease boundaries, exact cleanup lease conflicts,
Project/Account service wiring, and a 64-asset restore totaling exactly 8 MiB
with sequential writes. A fail-closed EU R2 mutation harness covers the
conditional-write/CORS/integrity/range/auth/cleanup contract with dependency-
injected tests. Real-PostgreSQL restore and concurrent-cleanup cases are also
present, but they have not been run locally in the current environment; CI is
expected to run the guarded database suite against disposable PostgreSQL.

## Production activation remains blocked

Keep `PRIVATE_ASSETS_ENABLED=false` in production. Production startup
intentionally rejects enabling it. Archive v2 and staged restore remove the
previous archive-coverage gap, but they do not complete the operational proof
required for real user files.

Before reconsidering the guard, complete and record all of the following:

- run the real-PostgreSQL portability/cleanup suite and retain its result;
- run a real **EU-jurisdiction Cloudflare R2** smoke and interruption matrix,
  including conditional PUT conflict behavior, exact checksum and content
  length, bounded/range reads, authorization, and delete/cleanup retry; the
  opt-in runner and safe operating steps are in `docs/R2_SMOKE_RUNBOOK.md`;
- run process-kill/freeze recovery against real PostgreSQL and R2 across every
  staging/write/finalize edge, retaining the sanitized results;
- validate the already-covered maximum package boundary against production
  transaction timeouts, serialization retries, storage latency, and memory
  ceilings; and
- run the guarded real-PostgreSQL concurrent-cleanup case, then validate the
  scheduled reconciliation alerts and multi-instance behavior in the deployed
  environment.

R2 credentials and bucket provisioning are operator work. They are not needed
to review the archive contract, and their presence is never permission to
enable the production flag.
