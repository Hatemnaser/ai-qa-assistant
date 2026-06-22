# Production Email Provider Review

Last updated: 2026-06-23

This review documents the current email delivery state for password reset and
email verification.

Auth Slice 6B is implemented: SMTP is the first production email provider.
Resend, SendGrid, and Mailgun are not wired in this slice.

## 1. Current Email Abstraction

The backend has a small auth email abstraction in
`apps/api/src/modules/auth/auth.email.ts`.

- `AuthEmailService` exposes:
  - `sendPasswordResetEmail(message)`
  - `sendEmailVerificationEmail(message)`
- `InMemoryAuthEmailService` stores sent reset and verification messages in
  memory for development and tests.
- `NoopAuthEmailService` intentionally does nothing and is allowed only outside
  production.
- `SmtpAuthEmailService` sends password reset and verification emails through
  an SMTP transporter.
- `createAuthEmailService()` returns:
  - `SmtpAuthEmailService` when `EMAIL_PROVIDER=smtp`
  - `NoopAuthEmailService` when `EMAIL_PROVIDER=noop` outside production
  - `InMemoryAuthEmailService` by default outside production
- Reset and verification URLs are built from `APP_ORIGIN` plus
  `PASSWORD_RESET_PATH` or `EMAIL_VERIFICATION_PATH`.
- SPA hash routes are supported, so paths like `/#/reset-password` and
  `/#/verify-email` keep raw tokens after `#`, reducing token exposure in
  server, proxy, and hosting access logs.

The abstraction is a good starting boundary: auth flows do not need to know
which provider sends the email.

## 2. Where Reset Password Email Is Used

Password reset email is used by the forgot-password flow:

- Route: `POST /api/auth/forgot-password`
- Controller: `apps/api/src/modules/auth/auth.controller.ts`
- Service method: `auth.service.requestPasswordReset`
- Email helper: `safeSendPasswordResetEmail`

Current behavior:

1. The request accepts an email address.
2. The service looks up the user by email.
3. The API always returns the same generic response, whether the account exists
   or not.
4. If the user exists and has a password hash, the backend creates a strong
   reset token.
5. Only the reset token hash is stored in `PasswordResetToken`.
6. The raw token is placed into the reset link sent by the email service.
7. The raw token is not returned in the API response.
8. Email delivery errors are swallowed to preserve the generic,
   non-enumerating response.

## 3. Where Email Verification Email Is Used

Email verification email is used by registration and resend-verification:

- Routes:
  - `POST /api/auth/register`
  - `POST /api/auth/resend-verification`
- Controller: `apps/api/src/modules/auth/auth.controller.ts`
- Service methods:
  - `auth.service.register`
  - `auth.service.resendVerification`
- Email helper: `safeSendEmailVerificationEmail`

Current behavior:

1. Register creates a user with `emailVerifiedAt = null`.
2. Register creates an email verification token and stores only its hash.
3. Register sends a verification link through the email abstraction.
4. Register does not create a session and does not set `qa_session`.
5. Login blocks unverified users with `EMAIL_NOT_VERIFIED` after password
   verification succeeds.
6. Resend-verification returns a generic response for missing, verified, and
   unverified emails.
7. If the user exists and is unverified, resend-verification creates a new
   verification token and sends a new email.
8. `POST /api/auth/verify-email` consumes the token and sets
   `emailVerifiedAt`; it does not log in the user automatically.

## 4. What Happens In Production Now

Production must use `EMAIL_PROVIDER=smtp`.

That means:

- The API fails fast at startup if `EMAIL_PROVIDER` is missing or `noop`.
- The API fails fast at startup if SMTP credentials are incomplete.
- Password reset emails are sent through `SmtpAuthEmailService`.
- Email verification emails are sent through `SmtpAuthEmailService`.
- Emails use simple text templates with the reset or verification link.
- The email body sent to the SMTP provider contains the reset or verification
  link because that is the user-facing delivery mechanism.
- Raw reset and verification tokens are not logged by the SMTP service.
- Full `resetUrl` and `verificationUrl` values must not be written to
  application logs or security events because they contain raw tokens.
- Forgot-password and resend-verification still return generic responses to
  avoid email enumeration.

The deployment still must configure a real SMTP provider, verified sender
domain, SPF, DKIM, DMARC, and provider-level monitoring before real users.

## 5. Risks If NoopAuthEmailService Remains In Production

Production no longer allows `NoopAuthEmailService`. If that guard were removed
or bypassed, the risks would be:

- New users could not verify their email, so they could not sign in after
  registration.
- Password reset would be unusable, causing account lockout and support burden.
- The product could appear production-ready while critical auth email flows are
  non-functional.
- Tokens would still be created in the database even though no user receives
  them, increasing stale token churn.
- Generic auth responses hide provider delivery failures from users by design,
  so missing provider configuration must be caught at startup, not discovered
  through user reports.
- Public demo signups could become a dead end if email verification is required.

## 6. Provider Options

### SMTP

Pros:

- Portable and widely supported.
- Good if the project already has a trusted mailbox or transactional SMTP
  provider.
- Avoids tying the app to a single HTTP email API.
- Implemented in Slice 6B as the first provider.

Cons:

- Deliverability, retries, logging, and templates are often more manual.
- Credentials and TLS settings are easy to misconfigure.
- Some mailbox SMTP servers are not suitable for application transactional
  email.

### Resend

Pros:

- Small API surface and good developer experience.
- Well-suited for MVP transactional email.
- Simple fit for password reset and verification links.
- Easier than generic SMTP to test with a mocked provider client.

Cons:

- Adds provider dependency.
- Requires domain verification and DNS setup before real sending.

### SendGrid

Pros:

- Mature provider with high-volume transactional email support.
- Strong template and analytics features.
- Common enterprise choice.

Cons:

- Heavier setup for this project's current needs.
- More operational surface than needed for the first real-provider slice.

### Mailgun

Pros:

- Strong transactional email and domain tooling.
- Useful logs and routing capabilities.

Cons:

- More configuration and provider-specific concepts than the MVP needs.
- May be heavier than necessary for simple auth email delivery.

## 7. Minimal Implementation Suitable For This Project

The smallest suitable implementation is now in place: one production provider
behind the existing `AuthEmailService` interface, plus fail-fast production
configuration.

Implemented shape:

- Keep `InMemoryAuthEmailService` for development and tests.
- Add `SmtpAuthEmailService` as the first production provider.
- Add explicit provider selection with `EMAIL_PROVIDER`.
- Allow `EMAIL_PROVIDER=noop` only outside production.
- Do not allow production to boot with `noop` or missing SMTP configuration.
- Add `EMAIL_FROM` and SMTP credentials.
- Send simple text emails for:
  - password reset
  - email verification
- Keep raw reset and verification tokens out of logs.
- Keep full reset and verification URLs out of logs; only the SMTP email body
  should carry those links.
- Keep token URLs in SPA hash routes when possible.
- Preserve current auth responses and non-enumerating behavior.

This does not add billing, dashboards, marketing templates, or complex retry
queues.

## 8. Required Env Variables

Base email configuration:

- `EMAIL_PROVIDER`
- `EMAIL_FROM`
- `EMAIL_REPLY_TO` optional
- `APP_ORIGIN`
- `PASSWORD_RESET_PATH`
- `EMAIL_VERIFICATION_PATH`
- `PASSWORD_RESET_TOKEN_TTL_MINUTES`
- `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`

Recommended path values for SPA deployments:

- `PASSWORD_RESET_PATH=/#/reset-password`
- `EMAIL_VERIFICATION_PATH=/#/verify-email`

If using Resend:

- `RESEND_API_KEY`

If using SMTP:

- `SMTP_HOST`
- `SMTP_PORT`
- `SMTP_USER`
- `SMTP_PASS`
- `SMTP_SECURE`

If SendGrid or Mailgun are added later, use provider-specific variables such as:

- `SENDGRID_API_KEY`
- `MAILGUN_API_KEY`
- `MAILGUN_DOMAIN`

Only the selected provider's required variables are mandatory. In production,
`EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, and
`SMTP_PASS` are required.

## 9. Should Production Fail Fast If Provider Is Not Configured?

Yes.

Production should fail during startup when:

- `EMAIL_PROVIDER` is missing.
- `EMAIL_PROVIDER` is `noop`.
- SMTP is selected and required credentials are missing.
- `EMAIL_FROM` is missing or invalid.
- `APP_ORIGIN` is not an explicit production origin.

This matters because auth email delivery failures are intentionally hidden from
users to prevent enumeration and token leaks. A missing provider cannot be
reliably detected from client-facing responses.

Development and test continue to use the in-memory service by default without
requiring provider credentials. Explicit `EMAIL_PROVIDER=noop` is available
outside production for local dry runs.

## 10. Required Tests

Implemented and recommended tests for Slice 6B:

- `createAuthEmailService` uses in-memory delivery in development/test.
- Production startup fails when `EMAIL_PROVIDER` is missing.
- Production startup fails when `EMAIL_PROVIDER=noop`.
- Production startup fails when the selected provider is missing credentials.
- Production startup fails when `EMAIL_FROM` is missing.
- Production startup accepts complete SMTP configuration.
- SMTP delivery calls the transporter with the expected `to`, `from`, and
  `subject`.
- Password reset sends an email through the configured provider for an existing
  user.
- Email verification sends an email through the configured provider on register.
- Resend verification sends an email only for an existing unverified user.
- Forgot-password response remains generic when email sending fails.
- Resend-verification response remains generic when email sending fails.
- Register response does not include a raw verification token.
- Password reset response does not include a raw reset token.
- Logs and security events do not contain raw reset tokens, raw verification
  tokens, session tokens, cookies, or raw passwords.
- Logs and security events do not contain full reset or verification URLs.
- Hash-route reset and verification URLs place the token after `#`.

## 11. Recommended Slice 6B Plan

Slice 6B implementation status:

1. Added email provider env parsing:
   - `EMAIL_PROVIDER`
   - `EMAIL_FROM`
   - `SMTP_HOST`
   - `SMTP_PORT`
   - `SMTP_USER`
   - `SMTP_PASS`
   - `SMTP_SECURE`
2. Added production fail-fast validation for missing or unsafe email provider
   configuration.
3. Implemented SMTP behind `AuthEmailService`.
4. Kept `InMemoryAuthEmailService` for local development and tests.
5. Added plain text password reset and verification email bodies.
6. Kept SMTP delivery free of token logging.
7. Added tests for provider selection, production fail-fast behavior, SMTP
   delivery, and token-log safety.
8. Updated `docs/AUTH.md`, this review, and `docs/PRODUCTION_READINESS.md`.

## Recommendation

Use SMTP for the first production implementation, as decided in Slice 6B.

The project should not go to real users until the selected SMTP provider is
configured, sender identity is verified, DNS records are in place, and the
password reset and email verification flows are smoke-tested in the deployed
environment.
