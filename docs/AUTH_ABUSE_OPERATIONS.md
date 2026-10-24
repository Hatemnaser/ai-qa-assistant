# Public authentication and email protection

Phase 06C builds on owned auth and the encrypted PostgreSQL email outbox. It
adds no paid service or dependency. Local checks do not approve public launch.

Production requires `AUTH_ABUSE_STORE=postgres`; memory is development/test only.
Apply `20261016000100_shared_auth_abuse` through controlled migrate deploy after
backup/upgrade rehearsal. The additive table contains only HMAC key, count and
reset time, with no User relation, raw email, IP, token, password or request body.
It does not alter existing account/session/usage data or recreate deleted users.

Admission layers:

- Existing coarse route/IP limiter runs before the 16 KiB auth JSON parser.
- Shared PostgreSQL pre-body gate atomically consumes a global auth mutation
  budget and route/IP budget. Default global maximum: 120 per 15-minute window.
- Post-parse normalized email budget is route-specific. Register, resend and
  forgot-password also share 100 mail-related requests globally and five per
  recipient per fixed 24-hour window, anchored on the first request.
  Unknown and existing recipients consume the same request budget before lookup.
- Every shared decision takes sorted advisory locks, then fresh database time.
  A denied multi-key decision inserts no new identity bucket. Counts saturate at
  the limit. A failure closes Auth with 503/AUTH_PROTECTION_UNAVAILABLE, with no
  fallback to memory. Accounting and LLM retries are unrelated and unchanged.

These are request budgets, including unsuccessful requests, not proof of email
delivery or an exact provider billing cap. Mail jobs have bounded retries; SMTP
can accept a message and lose its acknowledgement. Delivery is at least once,
with a stable Message-ID per job to support recipient deduplication, not a
guarantee of exactly one received email. A reclaimed job beyond its attempt cap
is failed without another send. Terminal jobs clear encrypted payloads. Outbox
status only reports delivery when markSent confirms its current claim.

Defaults/maxima: `AUTH_GLOBAL_RATE_LIMIT_MAX=120` (max1000),
`AUTH_EMAIL_DAILY_MAX=100` (max1000), `AUTH_RECIPIENT_DAILY_MAX=5` (max20).
Existing route maxima and `AUTH_RATE_LIMIT_WINDOW_MS` remain validated.
Shared HMAC keys use `USAGE_IP_HASH_SALT` with a dedicated namespace. Treat them
as pseudonymous abuse data, not anonymous data. Account deletion cannot erase
them and reset abuse history. No account FK or profile context is retained.
Windows are at most 24 hours. Only expired rows are deleted; reads do not extend
deadlines. Request-time GC and `cleanup:retention` remove bounded batches; the
scheduled command surfaces backlog as failure. Schedule it at least hourly and
monitor errors/backlog; expired rows can remain longer during an outage and
must be drained after recovery. Never truncate active buckets to restore access.

Use the same limits, store and HMAC salt across API processes. Changing policy
or rotating the salt changes abuse enforcement; coordinate a controlled rollout
after the old windows expire. Policy extension cannot reconstruct expired
history. No mixed-policy or hot-reload guarantee is made. Edge request/body/TLS
limits are still required: PostgreSQL admission is not a network DDoS boundary.

Public production registration remains disabled by default. Its explicit
`PUBLIC_REGISTRATION_RELEASE_CONFIRMED=true` acknowledgement is separate from
`LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true` and a reviewed terms version. Set
neither by inference from local tests. The Blueprint retains disabled/false.
No new auth provider, OAuth, account MFA or auth-platform migration is included.
Managed browser target-login/MFA retains its existing independent controls.

Email activation requires `{token, newPassword}`. Opening a link never activates
the account automatically. The mailbox owner explicitly chooses a password on
the activation page, under the existing password policy. The pending signup
password is never promoted to an active credential, including when another
person pre-registered the address. Unauthenticated re-registration/resend may
issue a new ownership link but cannot select an active password.

Activation writes the chosen password and email verification together, revokes
all sessions and reset/verification proofs, and cancels pending/processing auth
emails in the same transaction. An old link cannot alter an already verified
account. Reset also revokes outstanding activation links without implicitly
verifying an unverified email. Such a user can request a new verification link.
Issuance rechecks the account and the credential snapshot under the same fence;
work delayed across activation/reset/deletion cannot resurrect stale links.
A message already handed to SMTP cannot be unsent; its revoked token fails.

Password reset and email verification check expiry after auth, User and token-row
locks. Password login supplies the credential hash it verified; session creation
rechecks it under the reset lock. A verification begun before password reset
cannot create an old-password session after reset. Reset links remain one-use;
reset invalidates all existing sessions. Ordinary session TTL/cookies and
logout/browser Stop behavior remain in their existing modules.

Deploy the activation API and web changes together, draining every older API
process before enabling public registration. Old clients which send only a token
receive a validation error; they must refresh the web app. Existing unexpired
links for unverified accounts work with the new page, which requires a password.
No database migration or token reissue is necessary for this repair. Do not run
mixed old/new Auth servers: the old server still accepts unsafe token-only
activation. The repair cannot infer ownership of already verified accounts that
may have been compromised before rollout; a deployment with such exposure needs
an explicit incident response and credential/session remediation before release.

Guarded standalone PostgreSQL tests (configuration must precede imports):

```
node --import tsx --test apps/api/tests/auth-public.postgres.integration.ts
node --import tsx --test apps/api/tests/auth-public-http.postgres.integration.ts
node --import tsx --test apps/api/tests/auth-mail.postgres.integration.ts
node --import tsx --test apps/api/tests/auth-activation.postgres.integration.ts
node --import tsx --test apps/api/tests/auth-activation-races.postgres.integration.ts
```

The populated upgrade test additionally requires a separate EMPTY disposable
database and `ODDPATH_AUTH_UPGRADE_TEST=1`:
`node --import tsx --test apps/api/tests/auth-migration.postgres.integration.ts`.
Never point these tests, SQL failure triggers or crash fixtures at working data.
The local SMTP fixture bypasses TLS only for loopback test capture. Production
SMTP still requires TLS. Actual sender/DNS deliverability, HTTPS cookies, chosen
ingress forwarding/spoofing and the final legal/budget/operator gates require
staging evidence before public release.
