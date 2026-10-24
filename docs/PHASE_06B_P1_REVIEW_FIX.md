# Phase 06B — P1 quota and receipt recovery repair

The owner authorized repair of the two findings in the independent financial
review dated 2026-10-15, with red regressions before implementation, real
PostgreSQL races/failures and server restart. This is a local repair awaiting
independent review. Phase 06B is not closed; public activation remains NO_GO.

## Scope and behavior

`usage-quota.ts` provides one aggregate used by initial admission, per-attempt
admission and usage counts. Each attempt contributes at its own `startedAt`;
fixed fees contribute once at the first attempt. An active unspent reservation
contributes only its remainder, independent of its event's age. The same quota
advisory locks cover admission, fallback and settlement. Existing non-durable
rows keep their previous conservative accounting. No new provider or pricing
catalog is introduced.

The additive `20261015000100_usage_settlement_receipts` migration adds a receipt
bound uniquely to the event and concrete attempt. Receipt capture commits
separately from applying the debit. Capture publishes known units and
`settlement_pending`; application updates the attempt/event and `appliedAt`
atomically. The receipt fingerprint rejects conflicting pending consumption.
At most three database attempts happen at each stage; generation is never
retried by accounting recovery. Recovery prioritizes pending receipts, and a
pending known receipt already consumes quota. Duplicate completions, concurrent
recovery and later failures cannot add or erase a settled debit.

The existing chat service retains an answer with a durable pending receipt,
using known units and explicit `accountingStatus:pending`. A complete capture
failure propagates `AI_USAGE_ACCOUNTING_UNAVAILABLE`; an absent token receipt
is `unconfirmed`, with `creditsUsed=null` and an estimated quota hold. A missing
receipt after total storage/process loss cannot be reconstructed into exact
tokens. Unknown outcomes remain traceable rather than being declared settled.
The repair cannot recreate historical receipts already lost before this
mechanism existed. Such rows require trustworthy external consumption evidence;
their old estimates must not be promoted to verified usage by guessing.

Two adjacent boundaries are necessary for the receipt's durability: generic
retention/unverified-account cleanup must preserve pending receipts/active
holds, and the public chat usage type must permit pending/unconfirmed state.
Their changes do not add auth features, another controller or a new UI flow.
Explicit account-deletion privacy behavior stays unchanged. The existing
browser reservation/controller/runtime production code is unchanged.

## Evidence and review

Red regressions on the previous source had six protective cases pass and
three expected failures: minute-window bypass, hour-window bypass and debit
1 instead of known debit 2. Those logs are retained separately. An initial
fixture-path failure is also retained and is not the red regression evidence.

The guarded maintained PostgreSQL suite imports
`quota-recovery.postgres.integration.ts`. It covers abrupt process death before
and during settlement, actual SQL failures, known-receipt retry, conflicting
receipts, concurrent hour-window admissions independently for credits and
request count, twelve concurrent initial holds, expiry-vs-receipt races,
unused hold/fixed-fee transfer, and browser capacity with/without a registered
runtime after process death. Retention preserves pending receipts and active
holds, then permits normal removal after settlement.

The HTTP restart case uses the actual `createApp`, chat route/controller,
CSRF, Gemini SDK and usage services against real PostgreSQL. Only the SDK's
outbound fetch is replaced with an offline response. It kills the server after
a successful response with a pending receipt, restores settlement, starts a
new HTTP server and runs the operator reconciliation boundary. It asserts one
provider call before death, zero after restart and an eventual debit of 2.
Another case terminates the PostgreSQL connection inside settlement and checks
that a new connection applies the committed receipt without another AI call.
No paid AI call or working database is used. Browser exit proof is a contract
fixture here; this repair does not repeat Chrome/noVNC operating validation.

The separate populated-schema rehearsal applies both 06B migrations and
checks legacy charges, existing attempt settlement, daily counts and occupied
browser reservations. Fresh migration deploy and dump/restore are included.
Final counts, builds, hashes, modified-file inventory, known skip/advisories
and cleanup proof live in `evidence/phase-06b/p1-review-fix.json`.

Review the financial invariants and the irrecoverable-before-capture boundary,
not just test counts. No deployment, activation, automatic provider replay or
next-phase implementation is authorized by passing local checks.

Final local gates: full verify has 1,919 passing cases and one existing Windows
vault-journal skip; guarded PostgreSQL has 140 passing cases (17 new recovery
regressions), plus the populated upgrade rehearsal. API/web builds and all 35
maintained Vue/Chromium journeys passed. The existing bundle advisory remains.
Status: LOCAL_P1_FIX_CHECKS_PASS_AWAITING_INDEPENDENT_REVIEW. Public NO_GO.
