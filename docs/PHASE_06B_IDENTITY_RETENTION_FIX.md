# Phase 06B — identity-window usage retention repair

The targeted independent review proved T4/P2: an allowed 40-day identity
window (`USAGE_WINDOW_HOURS=960`) with 32-day retention lost a 33-day-old
consumption record during cleanup. Real HTTP changed from429 to200 and the
SDK was called twice against a one-credit identity quota. The owner authorized
this bounded repair. No Astra or subagent is used during implementation.

The production change is confined to `retention.repository.ts`. In addition
to the existing global rolling/24-hour/UTC-month guard and live holds, cleanup
protects AI records linked to a user, guest ID or IP hash within the same
configured identity boundary used by admission (`getUsageWindowStart`). Both
the event timestamp and each attempt timestamp are inclusive. The guard is
shared by candidate selection and final deletion inside Serializable.

Deleted accounts have no remaining identity. Their financial remainder still
uses the global quota guard and fixed anonymous deadline, without an extension
from the former identity window. Account deletion, automatic unverified-account
deletion and accounting reconciliation preserve their existing behavior. No
new migration, dependency, quota price, model retry or controller is introduced.

UsageEvent deletion paths were checked: periodic/manual retention share this
repository; account graph deletion routes through the anonymization coordinator;
the stale-reservation/reconciler paths update accounting rather than deleting
rows. AiUsageLog is analytics, not the quota ledger. Browser daily counters and
Stop reservations are separate and are not deleted by generic usage retention.

T4 is rerun unchanged before/after repair. Eight dedicated PostgreSQL tests
cover actual user charges, delayed-attempt boundaries and concurrent admission,
guest/IP limits, all guarded legacy actions, unrelated/expired cleanup, finite
deleted-account retention, unverified-account deletion, concurrent duplicate
settlement, and new service processes with changed identity/global/retention
settings. A maintained HTTP regression retains the original T4 assertions.
The suites run separately so configuration is loaded before application imports;
commands and guards are in `QUOTA_OPERATIONS.md`.

Historical usage already deleted under an earlier policy cannot be recreated.
Quota-policy changes require consistent settings and draining active work.
This repair does not claim restoration of missing history or provider billing
verification. Final results and hashes are recorded in the separate repair
report/evidence, not written over preceding evidence.

Local validation prepares the owner's independent acceptance review. It does
not accept Phase06B or authorize public release or Phase06C.
