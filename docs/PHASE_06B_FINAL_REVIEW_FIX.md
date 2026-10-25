# Phase 06B — final independent review repairs

The owner authorized the two P1 and two P2 findings in the final independent
adversarial review dated 2026-10-15. The original report, tests and evidence
remain immutable. New red logs reproduce account-deletion quota reset,
duplicate QA generation after SQL publication failure, lost initial-read
accounting, and summary metadata loss before any production repair.

Account deletion serializes with quota admission and settlement. It scrubs
identifying financial fields, reservation policy identity and receipt context,
retaining only ownerless global exposure and original consumption keys until
a fixed `anonymousUntil` deadline. Late receipt settlement is idempotent;
deleted work cannot start a new provider attempt. Normal user data is deleted.
Generic retention preserves this exposure before the deadline and removes it
afterwards, including unresolved estimates. The default remainder lifetime is
32 days from last exposure/hold expiry; a longer explicitly configured global
rolling guard determines a correspondingly finite longer lifetime.

QA generation and review persist a pre-provider fence. DB-only publication
retries reuse the generated result and recognize an already committed job.
Once generation started, failure/reclaim cannot automatically generate again.
An interrupted unpublished result requires explicit user recovery/retry.
The initial usage lookup joins bounded accounting retries; provider calls
are never repeated by those retries. Summary output validation errors carry
validated actual token usage into existing receipts. The invalid summary is
not saved. No metadata means no invented confirmed charge.

The additive migration adds only the financial retention marker and QA attempt
fence. Existing pending/reclaimed jobs with earlier attempts are fenced during
upgrade; drain old workers first. No second session/QA controller, new provider,
public billing endpoint, production activation or working-DB migration is added.

Maintained real PostgreSQL regressions cover the four original failures,
authenticated HTTP password/CSRF deletion, concurrent late receipts/admission,
anonymous payload scrubbing and finite retention, SQL capture/publication
failures, lost publication acknowledgement and actual worker process death.
Prior fallback-window, credit, partial/unknown, browser capacity/Stop and
recovery controls remain required. The isolated HTTP/SDK suite lives in
`quota-final-http.postgres.integration.ts` because its application configuration
must be set before module import; run it as its own process against the same
guarded disposable target, after the main PostgreSQL suite.

Final counts, red/green logs, populated upgrade, restore/recovery and file hashes
belong in the separate `evidence/phase-06b/final-review-fix.json` ledger.
Intermediate typecheck/fixture/build-configuration failures are retained.

No Astra or higher-cost model was started for this repair. A subagent inherited
the execution session's model for the bounded summary fix and additional QA
recovery tests; the root integrated and verified them on real PostgreSQL.
Independent Astra review is deliberately still pending. Phase 06B is not
accepted merely because local checks pass; public activation remains NO_GO.

Actual provider responses were offline fixtures, not invoice verification.
Result loss before durable publication can require an explicit new generation.
Financial evidence genuinely lost before capture still requires trustworthy
external reconciliation. Physical Chrome/noVNC behavior was not revalidated
by these financial changes. Read the separate final repair report for exact
checks run and remaining operational gates.

Final local gates: full verify passed with 1,927 passes and the existing one
Windows vault-journal skip. The fresh guarded PostgreSQL suite passed165/165,
and the separate HTTP/SDK suite passed4/4. Populated upgrade, anonymous pending
receipt dump/restore with concurrent process recovery, zero schema drift and
both builds passed. A post-restore run reused its seed budget and failed narrow
quota fixtures; the final financial suite used a fresh separate database.
Original red and intermediate logs remain retained. Independent Astra acceptance
is pending; no Astra was started during this repair.
