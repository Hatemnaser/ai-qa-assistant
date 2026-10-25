# Phase 06B — summary admission and partial consumption repair

The owner authorized repair of F1/F2 in the independent P1 review dated
2026-10-15. Before product edits, two maintained regressions failed against
real PostgreSQL: three summary calls without any UsageEvent, and a mixed
fallback event with debit3 although only2 was confirmed. Their exact test
snapshot and red logs are retained separately.

Optional conversation summaries now stop on any reservation failure, a
missing reservation identifier or failed attempt registration. Saved chats
and messages remain available. A provider call requires both committed
reservation and durable pre-call attempt. Existing quota errors still skip
the optional summary.

Quota exposure (`units`) stays separate from confirmed consumption
(`creditsUsed`). A known fallback receipt2 with earlier unknown estimate1
retains units3 and confirmed debit2, with event `partial` and public
`accountingStatus:unconfirmed`. A missing receipt is never promoted to final
consumption. The shared attempt-time quota aggregate and its locks are
unchanged; unknown exposure remains counted in its actual attempt windows.

The additive per-attempt receipt migration preserves old receipts, changes
their key to the original attempt, and corrects populated mixed events
without releasing their quota hold. Internal trusted reconciliation can bind
late actual evidence using `UsageUpdateInput.attemptId`. Receipts are immutable,
conflicting duplicates fail, and capture/application remain separate atomic
transactions with bounded DB-only retries. Applying older evidence recomputes
the event; it never reopens authority to call AI. Several unresolved attempts
keep the event partial until all are supported by trustworthy evidence.

The fresh independent Astra review also reproduced a confirmation-only/zero-token
payload promoting a reserved estimate to a verified debit. Its maintained red
test failed before repair. Receipt capture now requires a positive token count
or an explicit credit amount, rejects invalid numeric values, and never uses
reserved credits as evidence. Trusted explicit zero credits remain supported.

Generic retention preserves unresolved durable events and their receipts.
After full reconciliation, ordinary retention can remove them. Explicit
account deletion retains its existing privacy behavior. No public reconciliation
endpoint, provider integration, pricing change, second session or QA controller
was added. Exact tokens lost before capture remain unrecoverable without an
external trusted source; estimates are not a provider invoice or EUR spend cap.

Maintained coverage adds real SQL failures before initial reservation, before
attempt registration and during receipt capture/application; it checks stored
chat integrity, late evidence, concurrent duplicate/recovery, wrong-event
binding, several unknown outcomes, verified zero consumption and retention.
Earlier hour/minute quota, HTTP restart, PostgreSQL connection termination,
browser capacity/Stop and receipt-recovery regressions remain required.
The populated upgrade now seeds a previously confirmed mixed event and retains
its receipt. A real pending receipt is also dumped/restored and reconciled by
the actual operator script, with a schema-drift check.

Final validation and independent Astra review results are recorded in the
separate `evidence/phase-06b/partial-review-fix.json`. Public activation stays
NO_GO; local checks do not authorize deployment or Phase06C.

Final local gates: 1,921 full-verify passes and the existing one Windows vault
skip; 150 guarded PostgreSQL passes (10 new), 8 prior independent-review
controls, populated upgrade, pending-receipt restore/operator recovery and
zero schema drift. API/web builds and all 35 maintained Chromium journeys
passed. An overlapping browser run was interrupted; a separate resource run
recorded HMR updates during API generation and timed out. Isolated final
groups passed without product/test/timeout edits. All intermediate logs are
retained. The existing web bundle advisory remains.

The owner-requested independent Astra agent found the confirmation-only
receipt gap, independently reproduced it, then passed five real PostgreSQL
probes after repair. Its final decision is no remaining blocking findings in
the reviewed F1/F2/R3 scope. The report separates its own probes from the
implementer's broader checks and documents trusted-evidence assumptions.
Status: LOCAL_REPAIR_REVIEW_PASSED. Public NO_GO remains.
