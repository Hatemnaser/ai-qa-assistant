# Phase 06B — durable quotas and browser reservations

2026-10-16 closeout: final targeted independent review accepted **Phase 06B GO**.
See `PHASE_06B_CLOSEOUT.md`; older pending-review paragraphs below are historical.
The owner authorized local Phase 06C. Public activation remains NO_GO.

Latest targeted review confirmed the global-window repair and found a P2 in
the configurable identity window. Its owner-authorized repair is documented
in `PHASE_06B_IDENTITY_RETENTION_FIX.md` and its separate evidence ledger.
The previous review and validation ledgers remain immutable. Phase06B final
independent acceptance is pending; public activation remains NO_GO.

The acceptance-gate review confirmed the four preceding repairs and found one
remaining P2: retention could erase a still-active longer global quota window.
The owner authorized its local repair. Read `PHASE_06B_RETENTION_WINDOW_FIX.md`
and `evidence/phase-06b/retention-window-fix.json` for the active validation
boundary. All older ledgers/reviews remain historical evidence; independent
acceptance is still pending and public activation is NO_GO.

Started 2026-10-14 after independent acceptance of Phase 06A and the owner's
authorization. This slice implements durable accounting and capacity; public
authentication/email/abuse hardening remains a later slice. Public activation
remains NO_GO.

## AI accounting

Initial credit and in-flight admission still use the shared usage service and
transactional repository. New reservations persist a bounded expiry and their
quota policy. Each provider attempt is written before its call, with ordinal,
concrete provider/model, kind and credit hold. Every fallback must acquire
additional available identity/global credits and global request capacity;
settlement shares the initial reservation's advisory locks. A refused hold
cannot reach the provider. The provider never receives Auto as a model id.

Successful generation tokens use that attempt's model multiplier. Failed or
interrupted calls without a receipt retain their estimated credits; an
abandoned reservation with no attempted call releases its hold. The existing
fixed attachment/router fees apply once per operation. Router attempts have
their own provenance/request count; their fixed credit cost remains in that
one-time fee because the router currently returns no token receipt.

Event `units` is the current total held/charged amount, `creditsReserved` is
the initial estimate, and attempt rows retain individual estimates/receipts.
Successful finalization is idempotent; a duplicate failure cannot erase its
charge. A late actual receipt can reconcile an expired unknown attempt once,
without reopening its authority to call. New calls recheck expiry after locks
and budget reads. Holds expire by the configured stale interval or the next
UTC midnight, whichever comes first; existing rolling identity/global limits
are preserved. Model price/catalog refresh is outside this slice.

Expired holds are reconciled on admission and through the separate bounded
operator command documented in `QUOTA_OPERATIONS.md`. Recreating API/service
instances uses the same persisted holds and counters. Legacy rows without
the new policy keep their previous conservative accounting behavior.

## Browser admission

V2 approval creates a durable queue reservation in the same transaction as
its existing run and immutable authorization. The shared QA start/claim/accept
paths remain authoritative. Initial limits are one active browser globally,
one queued/active allocation per account, three accepted reservations per UTC
day, ten queued reservations globally and a maximum wait of ten minutes.
Cancellation, timeout and project deletion do not refund a daily allocation.
The daily counter is independent of the project's lifetime.

Eligible queue order is persisted; claim grants capacity before returning a
task, and runtime registration/acceptance require an active reservation. The
queue never extends the immutable approval deadline: waiting consumes that
validity, and an expired wait requires a new approval. Existing preparation,
execution, ownership proof, login and lease limits still apply.

An active slot stays occupied while a runtime is LIVE, STOP_REQUESTED or
STOP_UNCONFIRMED, even if its job/lease ends. It is released only after physical
STOP_CONFIRMED, or when a terminal job never registered a runtime. The existing
separately supervised reaper expires queued work and reconciles capacity.
Pre-migration runtimes also block admission. The additive migration backfills
known daily consumption and occupied/queued jobs. Local/legacy v1 behavior is
preserved; no second session or QA controller was added.

Both approval surfaces display localized managed-browser limits in en/de/ar.
No paid service, dependency, production flag activation, working-DB migration,
auth migration or deployment is included. The repository's injection-only
`enforceBrowserQuota:false` option is used by historical isolated target/login
tests; production factories use quota enforcement by default. Dedicated real
PostgreSQL tests exercise those defaults.

## Verification gate

Final results and retained intermediate failures are recorded separately in
`evidence/phase-06b/validation.json`. Required checks include full verify,
real DB concurrency/lock wait/restart/late receipt/Stop and queue tests, fresh
migration and populated-schema upgrade rehearsal, dump/restore, builds and
actual localized UI/history/resource regressions. Independent review precedes
the next public-auth slice. Documentation of these gates alone is not a pass.

Final local validation: full verify passed with 1,919 passing tests and one
existing Windows vault-journal skip. All 123 guarded PostgreSQL cases and the
separate populated pre-06B upgrade rehearsal passed; migration deploy and
dump/restore succeeded. API/web builds and 35 actual Vue/Chromium journeys
passed, including six localized capacity/deadline checks, ten model/history
journeys with fresh DB DTOs and nineteen resource/Stop/consent/CSP regressions.
The existing web bundle advisory remains. Owned test resources were removed.
Status: LOCAL_CHECKS_PASS_AWAITING_INDEPENDENT_REVIEW. Public activation NO_GO.

## P1 financial review repair — 2026-10-15

The independent financial review requested changes: attempt windows used the
parent event timestamp, and a pre-existing chat catch could discard a known
receipt after settlement failure. The owner authorized their repair and real
PostgreSQL crash/concurrency/recovery checks. Read `PHASE_06B_P1_REVIEW_FIX.md`
and the separate `evidence/phase-06b/p1-review-fix.json`. The original ledger and
independent review remain historical evidence. The repair awaits a fresh
independent review; it does not close Phase 06B or activate public beta.

## Summary admission and partial accounting follow-up

The subsequent independent review found a pre-existing optional-summary path
that called AI after a failed reservation, and a mixed-outcome settlement that
promoted an unknown attempt's estimate into a confirmed debit. The owner
authorized their repair. Read `PHASE_06B_PARTIAL_REVIEW_FIX.md`; original ledgers
and both independent reviews remain unchanged. No public activation or next
phase is authorized by local test success.
