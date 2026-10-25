# Phase 06C — public account, email and abuse foundation

2026-10-17 closeout: **locally accepted GO** after final adversarial review.
`PHASE_06C_CLOSEOUT.md` and `evidence/phase-06c/acceptance.json` supersede the
pending-review status below; its implementation/repair notes remain historical.
The owner authorized Phase 07. Public activation remains NO_GO.

Authorized locally on 2026-10-16 after Phase 06B acceptance
(`PHASE_06B_CLOSEOUT.md`). Status: P1_REPAIRED_AWAITING_INDEPENDENT_ACCEPTANCE.

The independent review subsequently found P1 R1: a mailbox owner's activation
could enable a pre-registrant's password. The repair below supersedes the
original implementation checkpoint; Phase 06C is not accepted yet.

Scope: harden the existing owned authentication module and encrypted email
outbox; durable shared IP/account/global admission using the existing PostgreSQL
service; bounded email-request budgets; reset/verification/session concurrency;
explicit public-registration deployment gates. Preserve one session and one QA
controller, all 06B accounting and browser Stop contracts. No new paid service,
auth-platform migration, paid AI request, working-DB migration or deployment.

Acceptance requires real PostgreSQL and HTTP tests for concurrent requests,
restart, DB failure, forwarding boundaries, token replay/expiry, credential
change, generic enumeration responses and outbox failure/recovery. Fresh and
populated additive migration, restore, source/test typechecks and existing
regressions must pass. Independent review is required before local acceptance.
Live sender/DNS/HTTPS/ingress and operator legal/release approvals remain launch
gates; local evidence cannot close those external gates.

Implemented: PostgreSQL IP/email/global mutation and mail-request budgets,
bounded HMAC-only abuse history/cleanup, fail-closed DB errors, explicit public
registration release acknowledgement, fresh expiry after auth/token locks,
credential-fenced session creation, and bounded outbox recovery with stable
Message-ID. `AUTH_ABUSE_OPERATIONS.md` records settings and rollout boundaries.

Validation on 2026-10-16: 16 new guarded PostgreSQL/HTTP/SMTP/upgrade cases
passed, plus 185 existing DB/HTTP quota regressions. The isolated old Auth
repository fails three race regressions; the current implementation passes.
The populated upgrade preserves 57 previous-table fingerprints, including
accounts/sessions and absence of a deleted account. Dump/restore preserves
Auth denial and existing partial/confirmed usage recovery from fresh processes.
Full verify: 1,928 PASS, zero FAIL, one inherited Windows journal test SKIP;
API production build and schema drift checks passed. No skip is counted PASS.

The sanitized ledger at `evidence/phase-06c/validation.json` links the local
implementation report and detailed evidence.
Existing Phase 06B evidence remains immutable. Test resources were removed.
No paid provider call, additional model, subagent, working-DB migration,
deployment or public registration activation occurred. Independent acceptance
of 06C is still required; stages 7–8 and public release remain pending.

P1 repair verification (2026-10-16): activation now requires the mailbox owner's
explicit password choice, atomically replaces the pending credential and revokes
sessions/reset/verification proofs. Stale issuance is fenced across activation,
reset and deletion. Eight real HTTP/PostgreSQL regressions fail on the old code
and pass unchanged after the repair; fourteen additional DB race/expiry cases
pass. The complete guarded DB/HTTP/SMTP/upgrade set passes 232 cases, including
the previous accounting/quota protections. A real Chromium/Vue/API/PostgreSQL
journey and a dump/restore from fresh processes preserve the credential and
revocation rules. Full verify: 1,931 PASS, zero FAIL, one inherited Windows SKIP.
See `PHASE_06C_CREDENTIAL_BINDING_FIX.md`, `AUTH_ABUSE_OPERATIONS.md` and
`evidence/phase-06c/credential-binding-fix.json` for the evidence, modified-file
inventory, rollout limits and independent-review handoff. No new migration or
dependency is part of this repair. No public release was enabled.
