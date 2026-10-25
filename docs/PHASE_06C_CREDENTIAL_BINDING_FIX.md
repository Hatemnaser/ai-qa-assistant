# Phase 06C — mailbox ownership and activation credential repair

Status: P1 repaired, local tests passed; independent acceptance remains
required. This document addresses the single P1 from the 2026-10-16 independent
review. Phase 06B acceptance and public-release gates are separate decisions.

## Vulnerability and repair

An attacker could pre-register someone else's email with password A. When the
owner registered with B and verified the new link, the old implementation
activated A. The duplicate-registration branch hashed B but never stored it.
Simply replacing A on every unauthenticated registration would let the attacker
race the owner's verification and choose the active credential again.

Activation now requires the email proof and a password explicitly chosen by the
mailbox owner. It atomically verifies the email, replaces the pending hash, and
revokes all sessions and outstanding reset/verification proofs. Pending auth
emails are cancelled and their ciphertext removed. Existing verified accounts
reject activation, even with a legacy unused proof. Password reset invalidates
activation proofs too. Login keeps its existing credential fence.

Issuance, activation and reset share the existing per-user advisory lock, then
lock the User row. Issuance rechecks the account and the credential snapshot.
Consumption locks the token and checks expiry with fresh time after the locks.
Rollback includes the credential, verified flag, proof, sessions and outbox.
No migration, new dependency, service or accounting change is needed.

## Evidence design

- `auth-activation.postgres.integration.ts`: eight unchanged red/green tests
  using real HTTP, CSRF, two API processes and disposable PostgreSQL. Includes
  the exact takeover, token-only/weak password rejection, re-registration,
  resend/replay, concurrent consumption, reset, injected persistence failure,
  restart and generic public responses.
- `auth-activation-races.postgres.integration.ts`: stale issuance after
  activation/reset in direct/outbox modes; real User-row expiry waits;
  deterministically ordered activation/reset races; verified legacy proof;
  deletion preventing late issuance.
- `verifyEmailPage.test.ts`: actual compiled Vue setup with the real request
  state helper; no automatic activation, mismatch/missing proof, pending guard,
  failed request and explicit retry. Browser evidence additionally uses the
  real Vue component, HTTP API and PostgreSQL.
- Previous PostgreSQL/HTTP/SMTP and quota/accounting tests remain mandatory.
  Old verification fixtures supply the newly required password; existing
  security/quota assertions are preserved. Earlier review artifacts stay
  immutable; copied review tests adapt only the activation input contract.

See `AUTH_ABUSE_OPERATIONS.md` for the rollout boundary. Every old API process
must be drained; token-only clients fail closed. The fix covers pending account
activation, not retroactive ownership attribution for historically compromised
verified accounts. Local SMTP and browser tests do not prove real-world mail
deliverability or production HTTPS/ingress configuration.

Validation: 232 guarded PostgreSQL/HTTP/SMTP/upgrade cases passed, excluding
repeat executions and the expected pre-fix failures. Full verify passed 1,931
tests, with zero failures and one inherited Windows-specific journal skip. The
actual browser journey and dump/restore checks also passed. The red A1 evidence
shows attacker login 200 / owner 401; unchanged green assertions require and
observe attacker 401 / owner 200. A total of 148 prior evidence artifacts remain
byte-identical. No test assertion was weakened to hide the vulnerability.

The final sanitized evidence ledger is
`evidence/phase-06c/credential-binding-fix.json`. The original incomplete verify
attempt and browser-fixture parsing failure are preserved separately; neither
counts as acceptance evidence. The successful reruns and their conditions are
recorded in the repair report. Astra has not reviewed this repair yet.
