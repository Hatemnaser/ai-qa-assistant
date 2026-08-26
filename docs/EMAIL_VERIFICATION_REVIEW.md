# Email Verification Review

Last updated: 2026-08-19

This document originally reviewed the auth system's email verification posture.
Auth Slice 5B is now implemented. New password registrations create an
unverified account, send a verification email through the auth email
abstraction, and do not create a session until the user verifies the email and
then signs in.

Implementation status:

- `User.emailVerifiedAt DateTime?` exists.
- `EmailVerificationToken` exists with hashed token storage, expiry, one-time
  use, and indexes.
- `POST /api/auth/verify-email` verifies a token and sets
  `emailVerifiedAt`.
- `POST /api/auth/resend-verification` returns a generic response and sends a
  new link only for existing unverified users.
- `POST /api/auth/register` returns a pending verification message, creates no
  session, and sets no `qa_session` cookie.
- `POST /api/auth/login` returns `EMAIL_NOT_VERIFIED` for unverified password
  users after password validation and creates no session.
- Guest chat adoption waits until verified login.
- Production requires SMTP and uses an encrypted, durable database outbox.
  Request handlers enqueue verification/reset delivery; the in-process worker
  claims, sends, retries, expires, and clears encrypted payloads without
  storing raw tokens.

## 1. Current Registration Flow

Current registration is implemented by:

- Backend: `apps/api/src/modules/auth/auth.routes.ts`,
  `auth.controller.ts`, `auth.schema.ts`, `auth.service.ts`,
  `auth.repository.ts`, `auth.security.ts`, and `auth.cookies.ts`.
- Frontend: `apps/web/src/features/auth/pages/RegisterPage.vue`,
  `authApi.ts`, `useAuthRequest.ts`, `useAuthSession.ts`, and `App.vue`.

Flow today:

1. `RegisterPage.vue` submits name, email, locale, and password.
2. `authApi.register` sends `POST /api/auth/register` with credentials and
   CSRF handling.
3. `registerRequestSchema` normalizes the email to lowercase and validates the
   password creation policy.
4. `auth.service.register` checks whether the email already exists while
   keeping the public response generic.
5. Existing submissions still perform password hashing; eligible unverified
   accounts may receive a fresh verification link and verified accounts remain
   unchanged.
6. A new password is hashed with `scrypt`.
7. `auth.repository.createPasswordUser` creates `User` and `UserSettings`.
8. The user is created with `emailVerifiedAt = null`.
9. `auth.service.register` creates an email verification token and stores only
   its hash. SMTP deployments put the raw link only inside an authenticated,
   encrypted `AuthEmailJob` payload; the worker clears that ciphertext after a
   terminal result.
10. `auth.controller.register` returns the pending verification message and
    does not set `qa_session`.
11. `RegisterPage.vue` shows the pending verification message and does not
    emit `authenticated`.
12. Guest chats remain in guest/local state until the user verifies email and
    signs in.

There is now an email verification step before a new password user can sign in.

## 2. Is `email_verified` Or `emailVerifiedAt` Present?

Yes. The current Prisma `User` model has:

- `id`
- `email`
- `name`
- `passwordHash`
- `locale`
- `emailVerifiedAt`
- `createdAt`
- `updatedAt`

The Prisma schema also includes `EmailVerificationToken`, and the public auth
user shape exposes `emailVerifiedAt`.

## 3. Is Login Allowed Before Verification?

No for new password users.

Current behavior:

- Register creates an unverified user and no session.
- Login checks email/password first.
- If the password is valid but `emailVerifiedAt` is `null`, login returns
  `EMAIL_NOT_VERIFIED` and creates no session.
- Verified users log in normally and receive the server-side session cookie.
- `GET /api/auth/me` only returns users with existing valid sessions.

Existing pre-verification users are backfilled as verified by the Slice 5B
migration to avoid locking out pre-launch development accounts.

## 4. Risks Without Email Verification

Main risks:

- A user can register an email address they do not control.
- A malicious user can squat someone else's email address.
- The app cannot prove account ownership for account recovery, notifications,
  or security messages.
- Password reset can create confusing ownership behavior: the real email owner
  may later receive reset links for an account they did not create.
- If the real email owner resets that account, they may gain access to data
  created by the squatter under that email.
- Abuse controls cannot rely on email ownership.
- Account trust signals are weak for future collaboration, sharing, billing,
  or organization features.
- Support workflows cannot safely treat email as verified contact information.

Current mitigations:

- Registration requires a password and rate limits.
- Sessions are server-side and token-hashed.
- Forgot-password does not enumerate accounts.
- The application-side SMTP integration and durable encrypted delivery outbox
  are implemented. Real email-based account operations remain gated on
  production sender-domain DNS, credentials, monitoring, and a staging
  verification/reset delivery smoke test.

Risk level:

- Private/local demo: low-to-medium.
- Public demo: medium.
- Real users: high enough to require email verification before launch.

## 5. Impact On Guest Adoption After Register/Login

Current frontend behavior in `App.vue`:

- `handleAuthenticated` runs after verified login.
- It calls `setAuthenticatedUser(user)`.
- It calls `setChatStorageOwner(user.id, { adoptGuestChats: true })`.
- It clears guest-limit state and syncs account chats.

Implemented Slice 5B behavior:

- Register does not emit `authenticated`.
- Register creates no session and no auth cookie.
- Guest chats remain in guest/local storage until verification succeeds and a
  real session is created through login.
- After verification and login, the existing adoption path can run normally.
- This keeps durable account data from being adopted into an email address
  before ownership is proven.

## 6. Safe Verification Token Design

A safe verification-token flow should mirror the reset-token hardening already
used in auth:

- Generate a cryptographically random token with `randomBytes(32)`.
- Send the raw token only through the verification email link.
- Store only a hash of the token in PostgreSQL.
- Give tokens a short expiry, such as 30-60 minutes or 24 hours depending on
  UX needs.
- Make tokens one-time use.
- Mark tokens as used or delete them after successful verification.
- Do not log raw tokens.
- Do not return raw tokens in API responses.
- Return generic responses for resend/send flows where enumeration is possible.
- Rate limit resend/send endpoints.
- Use CSRF protection for state-changing endpoints.
- Consider invalidating older outstanding verification tokens when a new token
  is issued.

Implemented schema:

- `User.emailVerifiedAt DateTime?`.
- `EmailVerificationToken` with:
  - `id`
  - `userId`
  - `tokenHash` unique
  - `expiresAt`
  - `usedAt`
  - `createdAt`
  - indexes on `userId, createdAt` and `expiresAt`

No raw token should ever be stored.

## 7. Can The Current Email Abstraction Be Reused?

Yes. Slice 5B reuses and extends it.

The current `auth.email.ts` abstraction already has useful pieces:

- `AuthEmailService` interface.
- `InMemoryAuthEmailService` for development/test.
- `NoopAuthEmailService` for explicit non-production use only; production
  startup rejects it.
- `SmtpAuthEmailService` with bounded TLS/STARTTLS transport.
- reset-link URL construction using `APP_ORIGIN` and a path config.

Implemented extension:

- Add `sendEmailVerificationEmail(message)` to `AuthEmailService`.
- Add `EmailVerificationEmailMessage`.
- Add `buildEmailVerificationUrl(token, config)`.
- Add env/config such as:
  - `EMAIL_VERIFICATION_PATH`
  - `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`
- Keep development/test in-memory behavior.
- Production fails closed unless the SMTP provider, credentials, sender, and a
  distinct outbox-encryption secret are configured.
- Use SPA hash routes such as `/#/verify-email` when possible so the raw token
  is placed after `#`, which reduces exposure in server, hosting, and proxy
  logs. Ordinary path routes remain supported when needed.

Delivery boundary:

- SMTP delivery is implemented, but provider account provisioning, sender
  authentication, staging delivery tests, alerts, and the normal at-least-once
  duplicate-delivery caveat remain operational launch work.

## 8. Required Endpoints

Implemented endpoints:

- `POST /api/auth/verify-email`
  - Accepts `{ token }`.
  - Hashes the token and looks it up.
  - Rejects missing, expired, or used tokens with a generic error.
  - Sets `User.emailVerifiedAt`.
  - Consumes the token.
  - Does not expose token details.

- `POST /api/auth/resend-verification`
  - Accepts `{ email }`.
  - Returns a generic response for missing, verified, and unverified users.
  - Creates a verification token only for existing unverified password users.
  - Rate limited.
  - Does not reveal whether an arbitrary email exists.

Frontend route/page:

- `RegisterPage.vue` shows a pending verification message after register.
- `VerifyEmailPage.vue` reads the token from the URL and calls
  `POST /api/auth/verify-email`.
- `useAppRoute.ts` recognizes `verify-email` as a hash route and direct path.

Prefer `POST /api/auth/verify-email` over a state-changing `GET` API route.
The frontend page may be a `GET` browser route, but the API mutation should be
POST.

## 9. Should Login Be Blocked Before Verification?

Slice 5B implements Option A.

### Option A: Block Login Until Verified

Behavior:

- Registration creates the account and atomically queues verification email.
- Registration does not create a full session.
- Login rejects unverified users with a generic or carefully designed
  `EMAIL_NOT_VERIFIED` response.
- Verification completes first, then the user logs in.

Pros:

- Strongest simple model.
- Guest adoption naturally waits until verified login.
- Durable user data is not tied to unverified email ownership.
- Easier to reason about before real users.

Cons:

- Slightly more friction.
- Requires frontend pending-verification UX.

### Option B: Allow Restricted Unverified Sessions

Not implemented. It remains a possible future product decision, but it is not
the current auth behavior.

Behavior if considered later:

- Registration creates a session, but the user has `emailVerifiedAt = null`.
- The app can show a verification prompt and limit sensitive actions.
- Resend verification is available from the signed-in state.

Pros:

- Lower signup friction.
- Easier to keep the current immediate-auth UX.

Cons:

- Requires route-level authorization decisions for verified vs unverified
  users.
- Guest adoption may happen before email ownership is proven.
- More states to test and more ways to accidentally grant full access.

Current recommendation for this codebase:

- Keep Option A for real-user readiness.
- If public demo UX needs immediate access, use Option B only with explicit
  restrictions and documentation.
- Do not open registration until the actual SMTP account, authenticated sender,
  encrypted outbox, retry path, and staging delivery smoke test are verified.

## 10. Slice 5B Implementation Summary

Implemented:

1. Schema support:
   - `User.emailVerifiedAt DateTime?`.
   - `EmailVerificationToken` table with hashed token, expiry, used marker, and
     indexes.

2. Security helpers:
   - `createEmailVerificationToken`.
   - `hashEmailVerificationToken`.

3. Email abstraction:
   - `sendEmailVerificationEmail`.
   - `buildEmailVerificationUrl`.
   - dev/test sink support.
   - production SMTP delivery uses an encrypted durable outbox; noop remains
     available only outside production.

4. Registration:
   - Create user as unverified.
   - Create the token and encrypted delivery job; the worker sends it.
   - Create no session before verification.

5. Verify/resend endpoints:
   - `POST /api/auth/verify-email`.
   - `POST /api/auth/resend-verification`.

6. Rate limiting:
   - resend verification.
   - verify token attempts.

7. Public user shape:
   - Include `emailVerifiedAt`.
   - Keep raw verification tokens out of responses.

8. Frontend:
   - Pending verification page after register.
   - Verify-email completion page.
   - Guest adoption waits until verified login.

### Should Have Soon

- Add cleanup for expired/used email verification tokens.
- Add basic security logging for verification resend abuse and invalid token
  attempts without logging raw tokens or emails.
- Decide whether password reset should be allowed for unverified accounts or
  treated as an implicit email-ownership proof.
- Add staging smoke tests once a real provider exists.

### Optional Later

- Add email-change flow with re-verification.
- Add admin/support audit events after admin roles exist.
- Add provider webhook handling for bounced verification emails.

## 11. Required Tests

Backend service/repository tests:

- Register creates an unverified user.
- Register creates an email verification token for password users.
- Raw verification token is not stored in DB.
- Verification token hash is stored.
- Verification token has expiry.
- Valid token sets `emailVerifiedAt`.
- Valid token is one-time use.
- Expired token fails with a generic error.
- Used token fails with a generic error.
- Missing/invalid token fails with a generic error.
- Resend creates a new token for unverified users.
- Resend does not create tokens for already verified users.
- Resend response does not enumerate arbitrary emails if email-based.
- Old outstanding tokens are invalidated or behavior is documented.

API tests:

- `POST /api/auth/verify-email` requires CSRF.
- `POST /api/auth/verify-email` with valid token verifies the user.
- Invalid/expired/used tokens return the same generic shape.
- `POST /api/auth/resend-verification` is rate limited.
- Register response does not include raw verification token.
- Verification emails are captured in the dev/test sink only.
- Production startup rejects noop/incomplete SMTP and unsafe outbox secrets.
- The outbox clears encrypted payloads on terminal states, fences stale
  claims, bounds retries, and cancels expired jobs.

Login/session tests:

- Unverified login returns `EMAIL_NOT_VERIFIED` and does not create a session.
- Verified users can log in normally.
- `GET /api/auth/me` exposes verification state without sensitive data.

Frontend tests:

- Register moves to pending verification instead of authenticated chat if login
  is blocked.
- Guest chats are not adopted until verified authentication if blocking login.
- Verify-email page calls the API with token.
- Resend verification handles generic success/failure safely.
- Login surfaces `EMAIL_NOT_VERIFIED` clearly for unverified users.

Security regression tests:

- Raw verification token is not logged.
- Raw verification token is not returned in API responses.
- Raw verification token is not stored in DB.
- Email resend does not leak whether an email exists when designed as an
  email-based endpoint.

## 12. Recommendation Timing

Before public demo:

- Recommended if the demo is broadly accessible, indexed, or expected to
  collect real user accounts.
- Can be deferred if the demo is private, invite-only, and clearly not
  production account infrastructure.

Before real users:

- Strongly recommended.
- Real-user launch should not rely on unverified email addresses, especially
  while password reset and future account recovery depend on email ownership.

Overall recommendation:

- Slice 5B is implemented and covered by automated tests.
- Keep registration disabled until the real SMTP sender/domain is configured
  and verification, resend, forgot-password, and reset links pass the staging
  HTTPS smoke test.
