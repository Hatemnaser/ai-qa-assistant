# Durable quota operations

Phase 06B has bounded local acceptance GO (`PHASE_06B_CLOSEOUT.md`). Phase 06C
and 07 also have local closeouts. Public rollout still requires the existing
operating/activation gates in `PHASE_08A_READINESS_INVENTORY.md`; no ledger,
provider retry or quota redesign follows from deployment preparation.

Usage retention age is a minimum storage policy, not permission to reset an
active quota. Cleanup also preserves guarded AI events created in any active
global window, their recent provider attempts, and live durable holds. It
uses the earliest boundary of the configured rolling window, rolling 24 hours
and current UTC calendar month, inclusively, on both candidate reads and final
deletes. A 40-day quota with 32-day usage retention remains supported: relevant
financial rows survive cleanup until outside the quota and eligible under the
existing retention policy. Legacy events without attempts are protected by
their creation time; a newer attempt protects an older parent event.

For events still linked to a user, guest ID or IP hash, cleanup also uses the
same `USAGE_WINDOW_HOURS` boundary as identity admission. This applies to
creation and attempt times inclusively and can exceed both base retention and
all global windows. Account deletion clears those identities; their long
former identity window does not prolong the finite anonymous financial term.
Current settings apply after process restart. Increasing a window cannot
reconstruct history already purged under earlier settings. Apply consistent
settings to API/workers/cleanup; drain active work when changing quota policy.

Deploy the additive migration through the controlled `db:migrate:deploy`
release procedure after backup/restore rehearsal and draining old workers.
Never reset the live DB or run development migrations as an upgrade step.
The migration preserves known per-day allocation consumption and marks
existing occupied runtimes as capacity consumers, including unconfirmed Stop.
Legacy historical AI rows keep their conservative charges.

Run `npm --prefix apps/api run usage:reconcile` from a supervised operator job
after builds (development uses `usage:reconcile:dev`). One pass handles at most
50 records: pending consumption receipts first, then expired reservations.
Repeat while it returns a nonzero count. The operator command exits with an
error if any selected receipt remains unapplied; alert and fix that failure.
Admission also performs bounded reconciliation and logs failed recoveries.
This command makes no provider calls and never retries a generation. A call
without a receipt retains an estimated quota hold, with `creditsUsed=null`
and `unknown` status; only an uncalled reservation releases its hold to zero.
Do not clear an uncertain hold manually to create headroom.

`UsageSettlementReceipt` records a confirmed receipt in its own transaction
before settlement, bound uniquely to its original attempt and event with a consumption
fingerprint. The same transaction publishes the known units and
`settlement_pending` status. Applying the receipt, setting actual tokens/debit
and marking `appliedAt` happen in a second atomic transaction. Capture and
application each have at most three database attempts. They never call the AI.
An unapplied receipt already consumes its actual credits in quota admission.
Repeated recovery, duplicate completion and a later failure do not add another
debit; a conflicting receipt is rejected even after application. Several
attempt receipts can belong to one event. No receipt can be reassigned to an
attempt from a different event.

`UsageEvent.units` is quota exposure: confirmed credits plus unresolved estimates
and the existing one-time fixed fee. `creditsUsed` contains only confirmed
credits when any receipt is applied, and stays null without confirmed
consumption. A successful fallback with an earlier unknown generation is
`partial`, with `accountingStatus:unconfirmed`; it is not fully settled. The
internal accounting reader exposes `confirmedUnits` and `unconfirmedUnits`.
Router attempts keep the existing fixed-fee policy and do not invent a token
receipt. Unknown estimates continue consuming quota in their attempt windows.

Trusted internal reconciliation can submit `UsageUpdateInput.attemptId` with
actual consumption evidence to the same repository completion boundary. It
records an immutable receipt for that original attempt, applies it once, and
recomputes the remaining unknown exposure. It cannot authorize a new provider
call. This is an internal accounting contract, not a new public endpoint or a
way for a client to declare its own consumption. Without trustworthy evidence,
leave the outcome unconfirmed. Reconciliation never guesses token usage.

Chat responses with a durable pending receipt retain the generated answer and
return its known usage with `accountingStatus:pending`. If all receipt writes
fail, the API returns `AI_USAGE_ACCOUNTING_UNAVAILABLE` rather than silently
returning a successful estimated settlement. No automatic model retry follows.
The pre-call attempt remains available for tracing; after expiry its outcome
is unknown. A successful response without token usage also exposes
`accountingStatus:unconfirmed`. An estimate is not a verified provider bill.
If no receipt was committed before a process/storage loss, exact tokens cannot
be reconstructed by this system. Reconcile from trustworthy external evidence;
never call the model again as an accounting recovery step.

Quota windows use individual `UsageProviderAttempt.startedAt` timestamps.
Fixed fees count once at the first attempt, and the unused portion of an active
hold remains counted even after its event creation time leaves a short window.
Beginning an attempt transfers that hold rather than adding it twice. Legacy
events without the durable policy retain their existing conservative behavior.

Generic usage retention and unverified-account cleanup preserve pending
receipts, durable active holds, and unresolved durable partial/unknown events.
Settled receipts follow their event's normal retention. Account deletion now
removes the user graph and identifying usage/context fields, including identities
inside reservation policies and receipt payloads, under the same quota locks.
Only ownerless global financial exposure and consumption keys remain. An
`anonymousUntil` deadline is fixed from the last exposure/hold expiry: 32 days
by default, or the explicitly configured longer global rolling window plus
one day. Retention deletes these rows and their attempts/receipts at that
deadline even if their outcome remains unknown, once outside every active
quota window. Reads/reconciliation never rewrite the deadline. If a later
configuration extends the quota beyond an already stored anonymous deadline,
cleanup temporarily preserves the still-relevant ownerless financial rows,
then removes them after that finite window expires. No prompt, answer,
account ID, guest ID, IP hash, or browser state
is retained in this financial remainder. It is not accessible through owner
usage/export scope. A live response can settle its original consumption key
after deletion, but cannot begin another attempt or restore deleted context.

The additive `20261015000200_per_attempt_usage_receipts` migration preserves
existing receipts, permits one receipt per attempt, and corrects already
completed mixed events to partial with their confirmed debit only. Their
quota units are preserved. Drain old workers and use the controlled release
migration after the populated-upgrade/restore rehearsal; local checks do not
authorize changing the working database or activating public beta.

Conversation summary generation requires a committed reservation identifier
and a successful durable attempt registration. Any storage/admission failure
stops optional summary generation and leaves the saved chat/messages intact.
Output/schema failure after a response retains validated actual usage through
the same completion/receipt boundary, while rejecting the summary. Missing or
invalid usage metadata still leaves an unconfirmed estimate. The initial receipt
read now participates in bounded DB-only retries too; none of these accounting
paths retry the provider.

QA generation/review jobs persist `providerStartedAt` under their current lease
before invoking intelligence. Publication retries only the already generated
value, at most three database attempts. A lost commit acknowledgement checks
the succeeded job rather than creating another artifact. A failed publication,
timeout, or dead worker with this fence must not buy another generation:
reclaimed ambiguous work fails with `QA_PROVIDER_OUTCOME_UNKNOWN` and requires
an explicit user retry. Already billed usage remains recorded. If the result
was never durably published and the process died, the result itself cannot be
recovered; an explicit new generation may incur new consumption. This fence
also covers Checklist review and Recipe generation/review. Drain old workers
before applying `20261015000300_protect_deleted_usage_and_qa_generation`;
existing claimed/retried pending jobs are conservatively fenced by the upgrade.

Keep the existing `browser:reaper` process and runtime supervisor/watchdogs
separately supervised. Queue expiry fails the old attempt and requires a new
approval. Closing a tab does not cancel a reservation. Owner Stop/logout use
the existing cancellation path. A failed job with STOP_UNCONFIRMED still owns
capacity; resolve the runtime/supervisor termination problem and report actual
process exit. Never edit a reservation to RELEASED to bypass that proof.

Browser daily limits are UTC days. Accepted queued reservations consume a
daily allocation, including later cancellation or expiry. Deleting a project
does not reset the owner's counter. One eligible oldest queued job can start
after capacity is confirmed free; an unavailable head waits only until its
existing approval/queue deadline. Waiting never extends an approval.

Diagnose accounting from UsageEvent and UsageProviderAttempt IDs, status,
ordinal, model, credit estimates/receipts and timestamps. They contain no
prompt, cookies, passwords, provider key or browser login state. `unknown`
means an uncertain provider outcome with a conservative debit, not a proven
free call. Aggregate insight APIs keep the existing account scope. Retention
of an event cascades to its attempt rows; public billing, pricing changes and
account credit purchases are outside this slice.

The migration/upgrade and quota suites require guarded disposable PostgreSQL
targets. `quota-migration.postgres.integration.ts` additionally requires an
empty separate database and `ODDPATH_QUOTA_UPGRADE_TEST=1`; it refuses a DB with
an existing User table. Its populated-baseline rehearsal is not a command to
run against normal application data.

The retention-window regression suite is standalone because its 40-day/32-day
configuration must precede application imports. With the same explicit
disposable-DB guards, run from the repository root:
`node --import tsx --test apps/api/tests/quota-retention.postgres.integration.ts`.
It covers legacy actions, inclusive attempt boundaries, finite anonymous
retention, periodic batches, concurrent settlement/admission and fresh service
processes. Existing data already purged before a window extension cannot be
reconstructed by this repair; do not treat missing history as verified zero.

The identity-window suites also run standalone, with the same disposable-DB
guards, because they set a 40-day identity window and 32-day retention before
imports:
`node --import tsx --test apps/api/tests/quota-identity-retention.postgres.integration.ts`
and
`node --import tsx --test apps/api/tests/quota-identity-retention-http.postgres.integration.ts`.
They cover user/guest/IP scopes, old legacy rows, delayed attempts, exact
boundaries, finite account deletion, automatic unverified-account deletion,
concurrent accounting/admission, configuration reload and real HTTP/SDK
admission before/after cleanup. Their assertions do not replace the earlier
global-window or accounting regressions.
