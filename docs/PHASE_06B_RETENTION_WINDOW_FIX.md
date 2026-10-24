# Phase 06B — quota-aware usage retention repair

The owner authorized the sole remaining acceptance-gate P2: an accepted
40-day global quota with 32-day usage retention was reset by scheduled cleanup.
The original acceptance report, source snapshots, tests and evidence remain
immutable. The original N5/H6 assertions were rerun and failed before this
repair. The new dedicated retention regressions also ran red first.

The production change is confined to the retention repository. Its existing
age/status/deadline policy now additionally excludes AI consumption relevant
to any active global quota. The cutoff is the earliest of the configured
rolling window, rolling 24 hours and the current UTC month. Parent creation
and individual provider-attempt timestamps are checked inclusively, along
with live durable holds. The same predicate is used for selection and final
deletion inside the existing Serializable transaction.

Existing allowed settings remain valid; no fixed maximum window is introduced
and no migration is needed. Legacy events without attempts retain their global
charge by creation time. Newer attempts protect older parent events. Cleanup
can delete unrelated usage and drain expired eligible rows even while old
quota-relevant rows remain. It makes no provider calls and never retries a
generation, changes a receipt, or converts unknown usage to a confirmed charge.

Account deletion still removes identities and context under the existing locks.
Ownerless financial rows keep their stored finite anonymous deadline; reads do
not rewrite it. Cleanup can remove them when that deadline has arrived and no
active quota needs them, including unresolved anonymous estimates. A persisted
deadline from a previous shorter configuration cannot erase active exposure
after a window extension: that financial remainder survives only until outside
the newly configured finite window. This does not restore previously deleted
data or recreate a deleted account.

`quota-retention.postgres.integration.ts` runs as a separate process because its
configuration must precede imports. It covers 40/32 compatibility; delayed
attempts and the exact inclusive boundary plus one millisecond; every guarded
legacy action and small cleanup batches; account deletion and a fixed deadline;
old anonymous deadlines after configuration extension; concurrent cleanup,
duplicate receipts and admission; and three fresh Node service processes.
The final evidence ledger records the exact red/green results and broader
regression, HTTP/SDK, full-verify and recovery gates.

Two older PostgreSQL retention fixtures set only their parent createdAt to
2001, leaving recent/future attempts, then expected deletion immediately after
settlement. They now retain the settled receipt while its quota is active and
test deletion beyond the last attempt's windows. The mixed/unknown fixture
also tests unresolved protection outside all windows before trusted recovery,
so quota protection cannot mask the original accounting safeguard. Initial
failures and original fixture sources are preserved for independent review.

No Astra or subagent was run. Local validation prepares a fresh independent
acceptance review; it does not accept Phase 06B or authorize public release.
Working application data, session/QA controllers, browser supervision and
production activation are outside this repair.
