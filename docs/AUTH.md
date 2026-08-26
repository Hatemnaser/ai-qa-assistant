# Auth Documentation

Last reviewed: 2026-08-19

This document describes the authentication system that exists in the codebase
today. It is documentation only. It does not approve the current system as a
complete real-user production auth implementation.

## 1. Overview

Oddpath currently uses a custom email/password authentication
foundation. The backend stores users and server-side sessions in PostgreSQL
through Prisma. The browser receives an opaque session token in an httpOnly
cookie named `qa_session`; the database stores only a SHA-256 hash of that
token.

The implemented auth surface supports:

- Register with email, password, optional name, a supported locale (`en`, `ar`,
  or `de`), explicit acceptance of the active legal-document version, and an
  invite code when the server is in private-beta mode.
- Login with email, password, and optional remember-me session length.
- Logout by deleting the current session and clearing the cookie.
- Current-user lookup through the session cookie.
- Forgot-password request with a generic response, hashed reset-token storage,
  and email delivery through an abstraction.
- Reset-password completion with one-time tokens and session invalidation.
- Email verification with hashed, one-time verification tokens before a new
  password user can sign in.

Google OAuth buttons exist in the UI but are disabled and not wired to backend
routes. Auth email delivery is behind `AuthEmailService`; development/test use
an in-memory sink by default, explicit non-production `EMAIL_PROVIDER=noop` is
available for local dry runs, and production must use `EMAIL_PROVIDER=smtp`.

Auth route hardening is implemented: login, register, forgot-password,
reset-password, resend-verification, and verify-email have endpoint-specific
in-memory rate limiting, and production cookie/CORS env guards
fail fast on unsafe deployment settings. The rate limiter is suitable as a
single-process baseline; multi-instance deployments should move the counters
to Redis, Upstash, or another shared store. Because the limiter keys off
Express `req.ip`, deployments behind a proxy must configure `trust proxy`
correctly so the API sees the real client IP instead of the proxy address.

Production registration is fail-closed. `REGISTRATION_MODE` defaults to
`disabled`; production rejects `public`, and `invite` additionally requires an
active `CURRENT_TERMS_VERSION`, SHA-256 invite-code hashes, and the explicit
operator acknowledgement `LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true`. That
acknowledgement is only a runtime release gate and does not replace legal
review. `GET /api/auth/registration-config` publishes the mode, document
version, and legal URLs without exposing invite material.

Auth Slice 3B is implemented: state-changing API requests now use signed
double-submit CSRF protection. The frontend gets a token from
`GET /api/auth/csrf`, receives a readable `qa_csrf` cookie, and sends the same
token in `X-CSRF-Token` for `POST`, `PUT`, `PATCH`, and `DELETE` requests.

The password policy uses a 15-character minimum, a 128-character maximum, no
composition rules, and a local common/context-specific password blocklist.
Register and reset-password share the same creation policy. Login rejects
passwords over the maximum length before password verification work runs but
does not reapply new-password rules to existing credentials.

Auth Slice 5B is implemented: registration creates an unverified account,
sends a verification link through the auth email abstraction, and does not
create a session. Login for unverified password users returns
`EMAIL_NOT_VERIFIED` and creates no session. Guest chat adoption waits until
the user verifies the email and then signs in normally.

Password reset and email verification links can use SPA hash routes such as
`/#/reset-password` and `/#/verify-email`. When these paths are configured, the
raw token is placed after the URL fragment marker (`#`) to reduce exposure in
server, hosting, and proxy logs. Ordinary path routes remain supported when
needed.

Auth Slice 6B is implemented: SMTP email delivery is available for production
through `EMAIL_PROVIDER=smtp`, `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_PASS`, and `SMTP_SECURE`. Production startup fails fast if
email delivery is left as `noop` or required SMTP settings are missing.

## 2. Current Architecture

### Backend Auth Structure

The backend auth module lives in `apps/api/src/modules/auth`:

- `auth.routes.ts`: Express routes under `/api/auth`.
- `auth.controller.ts`: request parsing, cookie setting/clearing, response
  shaping.
- `auth.service.ts`: register, login, logout, current-user, optional-current
  user, session creation, forgot-password, and reset-password behavior.
- `auth.repository.ts`: Prisma reads/writes for `User`, `Session`, and
  `PasswordResetToken`.
- `auth.schema.ts`: Zod schemas for register, login, forgot-password, and
  reset-password payloads.
- `auth.security.ts`: password hashing/verification plus session-token and
  reset-token/email-verification-token hashing.
- `auth.email.ts`: password reset and email verification delivery abstraction
  plus link construction.
- `auth.cookies.ts`: auth cookie name and cookie helpers.
- `auth.rateLimit.ts`: in-memory per-IP plus normalized-email auth rate limiting
  for all six public credential/token mutation routes. The email key is
  independent of IP so rotating addresses cannot bypass an account-oriented
  throttle.
- `auth.middleware.ts`: `requireAuth` middleware and `req.authUser` loading.
- `auth.types.ts`: request/response/service record types.

CSRF protection is implemented outside the auth module in
`apps/api/src/middleware/csrf.middleware.ts`, with the issue endpoint wired
through `GET /api/auth/csrf`.

Related config:

- `apps/api/src/config/cookies.ts`: shared cookie options.
- `apps/api/src/config/env.ts`: `COOKIE_DOMAIN`, `COOKIE_SAME_SITE`,
  `COOKIE_SECURE`, `CORS_ORIGIN`, `APP_ORIGIN`, `PASSWORD_RESET_PATH`,
  `PASSWORD_RESET_TOKEN_TTL_MINUTES`, `EMAIL_VERIFICATION_PATH`,
  `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`, `CSRF_SECRET`, `CSRF_COOKIE_NAME`,
  `CSRF_HEADER_NAME`, auth rate-limit settings, production safety guards, and
  other runtime config.
- `apps/api/src/config/cors.ts`: CORS with `credentials: true`.

### Frontend Auth Structure

The Vue auth feature lives in `apps/web/src/features/auth`:

- `authApi.ts`: calls `/api/auth/*` with `credentials: "include"`.
- `types.ts`: frontend auth response and input types.
- `useAuthRequest.ts`: shared submit/loading/error helper for auth forms.
- `composables/useAuthSession.ts`: current-user state, session loading, and
  logout handling.
- `pages/LoginPage.vue`: login form and disabled Google sign-in button.
- `pages/RegisterPage.vue`: register form and disabled Google sign-up button.
- `pages/ForgotPasswordPage.vue`: forgot-password request form.
- `components/AuthLayout.vue`: shared auth page layout.

State-changing frontend API calls go through `apps/web/src/api/csrf.ts`, which
keeps the CSRF token in module memory, fetches it from `/api/auth/csrf`, and
sends it as `X-CSRF-Token`. The token is not stored in localStorage.

`apps/web/src/App.vue` wires auth state into the application shell. The app uses
a small hash-route helper in `apps/web/src/router/useAppRoute.ts`; there is no
Vue Router guard layer today.

### PostgreSQL Usage

Auth uses Prisma models from `apps/api/prisma/schema.prisma`:

- `User`: account identity and password hash.
- `Session`: server-side session records keyed by `tokenHash`.
- `PasswordResetToken`: one-time password reset records keyed by hashed token.
- `UserSettings`: created during password registration so new users have
  default account settings.

Other domain tables reference `User` for owner-scoped data, including chats,
projects, memory, usage events, and project memberships.

### Session Strategy

Sessions are server-side database records:

1. A raw random token is generated with `randomBytes(32)`.
2. The raw token is returned only to the browser in the `qa_session` cookie.
3. The backend stores `sha256(rawToken)` in `Session.tokenHash`.
4. Current-user lookup hashes the cookie token and looks up the matching
   session.
5. Expired sessions are deleted when encountered during current-user lookup.

Session lifetimes:

- Default session: 7 days.
- Remember-me session: 30 days.

There is no explicit session rotation today.

### Cookie Strategy

The auth cookie is set by `auth.cookies.ts` using the shared base cookie
options:

- Name: `qa_session`.
- `httpOnly`: true.
- `path`: `/`.
- `sameSite`: from `COOKIE_SAME_SITE`, default `lax`.
- `secure`: from `COOKIE_SECURE`, default true when `NODE_ENV=production`.
- `domain`: from `COOKIE_DOMAIN` when configured.
- `expires`: set to the session expiry date.

Frontend requests include cookies with `credentials: "include"`.

The CSRF cookie is separate from the auth cookie:

- Default name: `qa_csrf`.
- `httpOnly`: no, intentionally readable by frontend JavaScript for the
  double-submit header.
- `secure`, `sameSite`, `path`, and optional `domain`: inherited from shared
  cookie options.
- Header name: `X-CSRF-Token`.
- Token format: random nonce plus HMAC-SHA256 signature using `CSRF_SECRET`.
- The token does not contain a session token or other sensitive data.

## 3. Auth Flows

### Register

Endpoint:

- `POST /api/auth/register`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`,
  `auth.email.ts`, and the `auth-email-outbox.*` modules.
- Frontend: `RegisterPage.vue`, `authApi.ts`, `useAuthRequest.ts`,
  `App.vue`.

Steps:

1. `RegisterPage.vue` loads `GET /api/auth/registration-config`. It disables
   submission while the policy is unknown or closed, shows the invite field
   only in invite mode, and links to the advertised Terms and Privacy routes.
2. After the user checks the real consent checkbox, the page submits email,
   name, locale, password, optional invite code, `termsAccepted: true`, and the
   exact advertised `termsVersion` through `authApi.register`.
3. `authApi.ts` sends a JSON `POST` request with `credentials: "include"`.
4. `auth.controller.ts` parses the body with `registerRequestSchema`; omitted
   or false acceptance is rejected.
5. `auth.schema.ts` trims and lowercases email, validates locale against the
   shared supported-locale list, validates name, and applies the current
   password policy.
6. `auth.service.ts` applies the server registration policy. Closed mode,
   invalid invite codes, and stale terms versions fail before password hashing
   or database writes.
7. The service checks for an existing user by email. Existing and new eligible
   submissions receive the same public response; an existing unverified user
   can receive a fresh link, while a verified account is left unchanged.
8. The password is hashed in `auth.security.ts`, including duplicate-email
   submissions, so the obvious fast duplicate-account timing path is removed.
9. `auth.repository.ts` creates a `User` and a related `UserSettings` record.
10. The user is created with `emailVerifiedAt = null` and server-authored terms
    acceptance version/time.
11. `auth.service.ts` creates a strong email verification token and stores only
    its hash in `EmailVerificationToken`.
12. `auth.email.ts` builds a verification link using `APP_ORIGIN` and
    `EMAIL_VERIFICATION_PATH`. In SMTP mode, the link payload is encrypted with
    authenticated AES-256-GCM under `EMAIL_OUTBOX_ENCRYPTION_SECRET` and queued
    in `AuthEmailJob`; the API never waits for SMTP. The in-process worker uses
    atomic claims, validates the linked token immediately before delivery,
    retries with bounded backoff, and clears ciphertext on terminal states.
    Hash-route tokens stay out of hosting and proxy request logs.
13. No session is created, no `qa_session` cookie is set, and guest chats are
    not adopted.
14. The frontend shows the pending verification message and keeps the user in
    guest mode until verification plus login succeeds.

Stored in DB:

- `User.email`, `User.name`, `User.locale`, `User.passwordHash`,
  `User.emailVerifiedAt = null`.
- `User.acceptedTermsVersion` and `User.acceptedTermsAt`, sourced from the
  active server policy and server clock rather than trusted client metadata.
- The authenticated Account Data export includes this acceptance metadata;
  importing an archive never counts as acceptance of the destination's terms.
- `UserSettings` row with language set to the registration locale.
- `EmailVerificationToken.userId`, `tokenHash`, `expiresAt`, `createdAt`,
  and `usedAt = null`.

Returned to frontend:

- HTTP 201.
- JSON `{ message: "Check your email to verify your account." }`.
- No verification token, user object, session payload, or auth cookie.

### Login

Endpoint:

- `POST /api/auth/login`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`,
  `auth.cookies.ts`.
- Frontend: `LoginPage.vue`, `authApi.ts`, `useAuthRequest.ts`,
  `useAuthSession.ts`, `App.vue`.

Steps:

1. `LoginPage.vue` submits email, password, and remember-me through
   `authApi.login`.
2. `authApi.ts` sends a JSON `POST` request with `credentials: "include"`.
3. `auth.controller.ts` parses the body with `loginRequestSchema`.
4. `auth.service.ts` finds the user by normalized email.
5. If the user is missing or has no password hash, the service returns
   `INVALID_CREDENTIALS` with HTTP 401.
6. `auth.security.ts` verifies the password against the stored hash.
7. If verification fails, the service returns the same generic
   `INVALID_CREDENTIALS` error.
8. If the password is valid but `emailVerifiedAt` is still `null`, the service
   returns `EMAIL_NOT_VERIFIED` with HTTP 403 and creates no session.
9. For verified users, the service creates a new server-side session. Remember-me uses 30 days;
   otherwise the session lasts 7 days.
10. `auth.controller.ts` sets the `qa_session` cookie.
11. `App.vue` stores the current user, switches chat storage to the user owner,
    clears guest-limit state, loads settings, and syncs account chats.

Stored in DB:

- A new `Session` row with hashed token, user id, expiry, and optional request
  context.

Returned to frontend:

- HTTP 200.
- JSON `{ user, session: { expiresAt } }`.
- `Set-Cookie: qa_session=<raw session token>; ...`.

### Logout

Endpoint:

- `POST /api/auth/logout`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.service.ts`,
  `auth.repository.ts`, `auth.cookies.ts`.
- Frontend: `authApi.ts`, `useAuthSession.ts`, `App.vue`, `ChatSidebar.vue`
  caller path.

Steps:

1. The frontend calls `logoutCurrentUser`.
2. `App.vue` may persist account chats before logout through the
   `beforeLogout` callback.
3. `authApi.logout` posts to `/api/auth/logout` with credentials included.
4. `auth.controller.ts` reads the `qa_session` cookie.
5. `auth.service.ts` hashes the token and deletes matching sessions.
6. `auth.controller.ts` clears the cookie.
7. `useAuthSession.ts` clears `currentUser` in a `finally` block.
8. `App.vue` resets local account state and returns the app to guest mode.

Stored in DB:

- Matching `Session` rows are deleted.
- No user record is changed.

Returned to frontend:

- HTTP 200.
- JSON `{ ok: true }`.
- A clearing `Set-Cookie` header for `qa_session`.

### Account Deletion

Endpoint:

- `DELETE /api/account`

The endpoint requires a valid authenticated session, a valid CSRF token, and
JSON `{ currentPassword }`. The service verifies the current password before
starting deletion. In one transaction it queues an idempotent
`ObjectDeletionJob` for every owned stored object, deletes the account's
restrictive attachment links, clears original-document asset references,
deletes `AiUsageLog` and `UsageEvent` rows, then deletes the `User`; database
foreign-key cascades remove sessions, settings, owned projects, chats,
messages, memories, and tokens. The response clears `qa_session` only after the
transaction succeeds.

The Settings danger zone uses a deliberate two-step confirmation. After a
successful response, the web app removes the deleted user's scoped local chat
cache, clears the in-memory authenticated user and other account state, and
returns to guest chat. The committed outbox jobs preserve object keys after
relational deletion; processing/retrying those jobs remains the object-storage
worker's responsibility.

Returned to frontend:

- HTTP 200 and JSON `{ ok: true }`.
- A clearing `Set-Cookie` header for `qa_session`.
- `CURRENT_PASSWORD_INVALID` with HTTP 403 when confirmation fails.

### Session Validation / Current User

Endpoint:

- `GET /api/auth/me`

Responsible files:

- Backend: `auth.routes.ts`, `auth.middleware.ts`, `auth.service.ts`,
  `auth.repository.ts`, `auth.security.ts`, `auth.controller.ts`.
- Frontend: `authApi.ts`, `useAuthSession.ts`, `App.vue`.

Steps:

1. `App.vue` calls `initializeSession` on mount.
2. `useAuthSession.loadCurrentUser` calls `authApi.getCurrentUser`.
3. `authApi.ts` sends `GET /api/auth/me` with credentials included.
4. `auth.routes.ts` protects the route with `requireAuth`.
5. `requireAuth` reads the `qa_session` cookie.
6. If the cookie is missing, `SESSION_REQUIRED` is returned.
7. `auth.service.getCurrentUser` hashes the cookie token and queries
   `Session.tokenHash`.
8. If no session exists, `SESSION_REQUIRED` is returned.
9. If the session is expired, it is deleted and `SESSION_REQUIRED` is returned.
10. If valid, the public user is assigned to `req.authUser`.
11. `auth.controller.getCurrentUser` returns `{ user: req.authUser }`.
12. The frontend stores the user or treats HTTP 401 as no current session.

Stored in DB:

- No new data is stored.
- Expired matching sessions are deleted when discovered.

Returned to frontend:

- Valid session: HTTP 200 with `{ user }`.
- Missing, invalid, or expired session: HTTP 401 with `SESSION_REQUIRED`.
- `authApi.getCurrentUser` maps HTTP 401 to `null`.

### Forgot Password

Endpoint:

- `POST /api/auth/forgot-password`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`,
  `auth.email.ts`.
- Frontend: `ForgotPasswordPage.vue`, `authApi.ts`, `useAuthRequest.ts`.

Steps:

1. `ForgotPasswordPage.vue` submits the email through
   `authApi.forgotPassword`.
2. `authApi.ts` sends a JSON `POST` request with credentials included.
3. `auth.controller.ts` parses the body with `forgotPasswordRequestSchema`.
4. `auth.service.requestPasswordReset` calls `findUserByEmail`.
5. If the user is missing, the service does not create anything and still
   returns the generic response.
6. If the user exists and has a password hash, the service generates a strong
   random reset token.
7. The raw token is hashed in `auth.security.ts`.
8. `auth.repository.ts` stores only the token hash, user id, expiry, and
   timestamps in `PasswordResetToken`.
9. `auth.email.ts` builds a reset link using `APP_ORIGIN` and
   `PASSWORD_RESET_PATH`, then passes it to the configured email abstraction.
   If the configured path is a hash route, the raw token is placed inside the
   fragment instead of the server-visible query string.
10. The service returns the same generic message whether or not an account
    exists.

Stored in DB:

- Existing password users get one `PasswordResetToken` row with
  `tokenHash`, `userId`, `expiresAt`, and `createdAt`.
- The raw token is not stored.
- No email delivery record is stored.

Returned to frontend:

- HTTP 200.
- JSON `{ message: "If an account exists for this email, a reset link has been sent." }`.
- No reset token is returned.

### Reset Password

Endpoint:

- `POST /api/auth/reset-password`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`.
- Frontend: no reset-completion page is implemented yet.

Steps:

1. The client submits `token` and `newPassword`.
2. `auth.controller.ts` parses the body with `resetPasswordRequestSchema`.
3. The new password is validated with the same current password policy used by
   registration.
4. `auth.service.resetPassword` hashes the raw reset token.
5. The service hashes the new password with `auth.security.hashPassword`.
6. `auth.repository.resetPasswordWithToken` runs a Prisma transaction:
   - Find the reset-token row by `tokenHash`.
   - Reject missing, expired, or already-used tokens.
   - Mark the token `usedAt`.
   - Update the user's `passwordHash`.
   - Delete all existing `Session` rows for that user.
7. The endpoint returns success and does not create a new login session.

Stored in DB:

- The matching `PasswordResetToken.usedAt` is set.
- The user's `passwordHash` is replaced.
- Existing sessions for the user are deleted.

Returned to frontend:

- Success: HTTP 200 with `{ ok: true }`.
- Invalid, expired, or used token: generic HTTP 400 with
  `code: INVALID_RESET_TOKEN`.
- No auth cookie is set.

### Verify Email

Endpoint:

- `POST /api/auth/verify-email`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`.
- Frontend: `VerifyEmailPage.vue`, `authApi.ts`, `useAppRoute.ts`, `App.vue`.

Steps:

1. The frontend verification page reads `token` from the email-link URL.
2. `authApi.verifyEmail` sends `{ token }` to `POST /api/auth/verify-email`
   with CSRF protection and credentials included.
3. The backend validates the request shape with `verifyEmailRequestSchema`.
4. `auth.service.verifyEmail` hashes the raw token with SHA-256.
5. `auth.repository.verifyEmailWithToken` runs a Prisma transaction:
   - Find the verification-token row by `tokenHash`.
   - Reject missing, expired, or already-used tokens.
   - Mark the token `usedAt`.
   - Set `User.emailVerifiedAt` when it is still unset.
   - Mark other outstanding verification tokens for that user as used.
6. The endpoint returns success and does not create a login session.

Stored in DB:

- Matching `EmailVerificationToken.usedAt` is set.
- `User.emailVerifiedAt` is set for newly verified users.

Returned to frontend:

- Success: HTTP 200 with `{ ok: true }`.
- Invalid, expired, or used token: generic HTTP 400 with
  `code: INVALID_VERIFICATION_TOKEN`.
- No auth cookie is set.

### Resend Verification

Endpoint:

- `POST /api/auth/resend-verification`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`,
  `auth.email.ts`, `auth.rateLimit.ts`.
- Frontend: `authApi.ts`.

Steps:

1. A client submits an email address.
2. The backend validates and normalizes the email.
3. The endpoint always returns the same generic response shape.
4. If the email belongs to an existing password user whose email is not yet
   verified, the service creates a new verification token and sends a new
   email.
5. When a new token is created, older unused verification tokens for that user
   are marked used.
6. Missing users and already verified users get the same response without
   creating a token.

Stored in DB:

- Existing unverified users get one new `EmailVerificationToken` row.
- Existing unused verification tokens for that user are consumed.

Returned to frontend:

- HTTP 200.
- JSON `{ message: "If an unverified account exists for this email, a verification link has been sent." }`.
- No verification token is returned.

## 4. Database Tables

### users

Prisma model: `User`.

Important fields:

- `id`: primary key.
- `email`: unique normalized account email.
- `emailVerifiedAt`: nullable timestamp set after email verification.
- `name`: optional display name.
- `passwordHash`: nullable password hash. Password users have a value here.
- `locale`: user locale, default `en`; currently constrained to `en`, `ar`,
  or `de`.
- `createdAt`, `updatedAt`: audit timestamps.

Auth-related relations:

- `sessions`: server-side sessions for the user.
- `passwordResetTokens`: one-time reset-token records for account recovery.
- `emailVerificationTokens`: one-time email-verification records.
- `settings`: account settings created during registration.
- `projectMemberships`: future/project membership relation. No active auth
  role checks use this for login.
- `chats`, `ownedProjects`, `memories`, `usageEvents`, and other relations are
  owner-scoped domain data.

### sessions

Prisma model: `Session`.

Important fields:

- `id`: primary key.
- `userId`: owning user id.
- `tokenHash`: unique SHA-256 hash of the raw cookie token.
- `userAgent`: optional user agent captured at session creation.
- `ipAddress`: optional request IP captured at session creation.
- `expiresAt`: session expiration time.
- `createdAt`, `updatedAt`: audit timestamps.

Indexes:

- `userId`.
- `expiresAt`.

Deletion:

- Sessions cascade-delete when the user is deleted.
- Logout deletes matching sessions by token hash.
- Current-user lookup deletes an expired matching session before rejecting it.

### password reset tokens

Prisma model: `PasswordResetToken`.

Important fields:

- `id`: primary key.
- `userId`: owning user id.
- `tokenHash`: unique SHA-256 hash of the raw reset token.
- `expiresAt`: reset-token expiry.
- `usedAt`: set when the token has been consumed; `null` means unused.
- `createdAt`: creation timestamp.

Indexes:

- Unique index on `tokenHash`.
- Index on `userId, createdAt`.
- Index on `expiresAt`.

Security behavior:

- Raw reset tokens are never stored in the database.
- Tokens are one-time use through `usedAt`.
- Expired, used, and missing tokens return the same generic error.
- Successful reset deletes all existing sessions for the user.

### email verification tokens

Prisma model: `EmailVerificationToken`.

Important fields:

- `id`: primary key.
- `userId`: owning user id.
- `tokenHash`: unique SHA-256 hash of the raw verification token.
- `expiresAt`: verification-token expiry.
- `usedAt`: set when the token has been consumed; `null` means unused.
- `createdAt`: creation timestamp.

Indexes:

- Unique index on `tokenHash`.
- Index on `userId, createdAt`.
- Index on `expiresAt`.

Security behavior:

- Raw verification tokens are never stored in the database.
- Tokens are one-time use through `usedAt`.
- Expired, used, and missing tokens return the same generic error.
- Creating a new resend token consumes older unused verification tokens for the
  same user.
- Successful verification sets `User.emailVerifiedAt` but does not create a
  session.

### Other Related Tables

`UserSettings` is created during registration and stores preferences such as
language, theme, and default model. It is not an auth credential table, but it
is created as part of the register flow. Settings updates keep
`UserSettings.language` and `User.locale` aligned so future account/email
behavior can read one current locale.

`ProjectMember` exists with project/user/role fields, but current project
access is owner-only for the implemented auth/authorization paths. Member-based
authorization is not active yet.

## 5. Cookies & Sessions

- Auth cookie name: `qa_session`.
- `httpOnly`: yes.
- `secure`: defaults to true when `NODE_ENV=production`; configurable through
  `COOKIE_SECURE`.
- `sameSite`: configurable through `COOKIE_SAME_SITE`, default `lax`.
- `domain`: optional through `COOKIE_DOMAIN`.
- Cookie path: `/`.
- Default session duration: 7 days.
- Remember-me session duration: 30 days.
- Raw session token: sent only to the browser cookie.
- Stored session token: SHA-256 hash in `Session.tokenHash`.
- Raw token in DB: no.
- Session lookup: hash cookie token and query `Session.tokenHash`.
- Expired session handling: delete the matching expired session during
  current-user lookup.
- Password reset handling: successful reset deletes all existing sessions for
  the user and does not automatically log the user in.

## 6. Password Handling

Hashing algorithm:

- Node `crypto.scrypt` with a random 16-byte salt.
- Stored hash format: `scrypt-v1$<salt>$<key>`.
- Key length: 64 bytes.
- Salt/key encoding: `base64url`.

Where hashing happens:

- `auth.security.hashPassword`.
- Called from `auth.service.register`.
- Called from `auth.service.resetPassword`.

Where verification happens:

- `auth.security.verifyPassword`.
- Called from `auth.service.login`.
- Verification rejects unknown hash versions and malformed hashes.
- `timingSafeEqual` is used after deriving a same-length test key.

Current password policy:

- 15 characters minimum.
- 128 characters maximum.
- No character-composition requirements; long passphrases are supported.
- A case-insensitive exact-match baseline blocklist rejects common and
  Oddpath/Eluthira-specific choices.
- Register `password` and reset-password `newPassword` use the same creation
  policy.
- Login requires a non-empty password with the same 128-character maximum, but
  does not apply the letter/digit creation policy.

Needs verification:

- Whether this policy should be relaxed or changed to match current
  OWASP/NIST-style guidance.
- Whether common-password or compromised-password checks are needed before
  real-user production.

Password reset token handling:

- Raw reset tokens are generated with `randomBytes(32)`.
- `auth.security.hashPasswordResetToken` stores only a SHA-256 hash.
- Reset tokens expire after `PASSWORD_RESET_TOKEN_TTL_MINUTES`, default 30
  minutes.
- Reset tokens are marked used through `PasswordResetToken.usedAt`.
- Creating a new reset token marks older unused reset tokens for that user as
  used, so only the newest link remains active.

Email verification token handling:

- Raw verification tokens are generated with `randomBytes(32)`.
- `auth.security.hashEmailVerificationToken` stores only a SHA-256 hash.
- Verification tokens expire after `EMAIL_VERIFICATION_TOKEN_TTL_MINUTES`,
  default 60 minutes.
- Verification tokens are marked used through `EmailVerificationToken.usedAt`.

## 7. Backend Authorization

### Middleware

`requireAuth` in `auth.middleware.ts` protects signed-in-only routes:

1. Reads `qa_session` from the request.
2. Rejects missing cookies with `SESSION_REQUIRED`.
3. Loads the current user through `authService.getCurrentUser`.
4. Attaches the public user to `req.authUser`.
5. Lets the route continue.

### Current User Loading

Current-user loading is session-based. The middleware does not trust a user id
from the client body. It derives the user from the cookie-backed session.

### Protected Routes

Known protected route groups:

- `GET /api/auth/me`.
- `/api/chats/*` through `chatHistoryRouter.use(requireAuth)`.
- `/api/memories/*` through `memoryRouter.use(requireAuth)`.
- `/api/projects/*` through `projectsRouter.use(requireAuth)`, including
  project instructions, project memory, and project documents.
- `/api/settings/*` through `settingsRouter.use(requireAuth)`.

Optional-auth routes:

- `POST /api/chat` reads the auth cookie if present, clears it if invalid, and
  otherwise falls back to guest usage identity.
- `GET /api/usage/summary` follows the same optional-auth pattern.

### Role / Permission Checks

There is no global role or admin permission model in active auth today.

Project authorization is currently owner-only:

- Project CRUD uses `ownerId` checks.
- Shared project-related operations use `project-access.service.ts`, which
  verifies that the project exists and `ownerId === req.authUser.id`.
- Chat persistence validates project ownership before assigning a chat to a
  project.

`ProjectMember` and project roles exist in the schema, but member-based
authorization is not active.

## 8. Frontend Vue Auth

### Auth Store / Composable

There is no global Pinia/Vuex auth store. Auth state is managed by
`useAuthSession`:

- `currentUser`: `ref<AuthUser | null>`.
- `loadCurrentUser`: calls `/api/auth/me` and stores the result or `null`.
- `setAuthenticatedUser`: stores the user after verified login.
- `logoutCurrentUser`: optionally runs a pre-logout callback, calls logout,
  and clears `currentUser`.

### Route Guards

There is no Vue Router and no formal route guard layer. The app uses hash
routes from `useAppRoute`.

Signed-in-only UX is handled at page/component level:

- Settings page receives `currentUser` and can prompt sign-in.
- Projects page receives `currentUser` and can prompt sign-in.
- Backend protected routes remain the authoritative enforcement layer.

### Login / Register Pages

`LoginPage.vue`:

- Collects email, password, and remember-me.
- Calls `authApi.login`.
- Emits `authenticated` with the returned user.
- Shows backend error messages through `useAuthRequest`.
- Shows `EMAIL_NOT_VERIFIED` errors from the backend when a password user has
  not completed email verification.
- Shows a disabled Google sign-in button.

`RegisterPage.vue`:

- Loads the non-secret registration policy and fail-closes the form while the
  policy is unavailable or registration is disabled.
- Collects name, email, password, a conditionally required beta invite, and a
  real required Terms/Privacy acceptance checkbox.
- Uses German legal URLs for German UI and English URLs for English/Arabic UI;
  there is no unreviewed Arabic legal translation.
- Sends the current frontend locale from `useI18n()` instead of hardcoding
  `en`.
- Calls `authApi.register`.
- Shows the pending verification message returned by the backend.
- Does not emit `authenticated`, does not create a session, and does not
  trigger guest chat adoption.
- Shows a disabled Google sign-up button.

`VerifyEmailPage.vue`:

- Handles the `verify-email` auth route.
- Reads the verification token from the URL.
- Calls `authApi.verifyEmail`.
- Shows success or generic failure feedback.
- Sends the user to the login page after verification.

### Current User Loading

`App.vue` calls `initializeSession` on mount:

1. `loadCurrentUser` calls `GET /api/auth/me`.
2. If a user is returned, the app sets chat storage owner to the user id.
3. It syncs account chats.
4. It loads account settings.
5. If no user is returned, the app stays in guest mode.

### Logout Handling

`App.vue` calls `logoutCurrentUser`:

1. It clears scheduled chat persistence.
2. If signed in, it persists account chats before logout.
3. It calls `POST /api/auth/logout`.
4. It clears the local current user.
5. It resets account settings, projects, project create modal state, and guest
   limit state.

## 9. Security Strengths

- httpOnly auth cookie prevents direct JavaScript reads of the session token.
- Server-side sessions are stored in PostgreSQL.
- Session tokens are opaque random values.
- Session tokens are hashed before database storage.
- Passwords are hashed with `scrypt` and per-password random salts.
- Password verification uses `timingSafeEqual` after deriving comparable keys.
- Login password validation rejects oversized passwords before `scrypt`
  verification work.
- Login failures use a generic invalid-credentials response for missing users
  and bad passwords.
- Forgot-password response is generic and does not reveal whether an account
  exists.
- Password reset tokens are generated with cryptographically secure random
  bytes and stored only as hashes.
- Password reset tokens have expiry and one-time use semantics.
- Password reset invalidates all existing sessions for the user.
- Registration creates no session until email ownership is verified.
- Login blocks unverified password users after password validation and creates
  no session for them.
- Email verification tokens are generated with cryptographically secure random
  bytes, stored only as hashes, expire, and are one-time use.
- Resend verification responses are generic for missing, verified, and
  unverified accounts.
- Guest chat adoption only runs after verified login.
- Authenticated routes derive the user from the server-side session, not from
  request body user ids.
- Expired sessions are removed when encountered.
- Signed double-submit CSRF protection is enforced for `POST`, `PUT`, `PATCH`,
  and `DELETE` requests, including auth, chat, chat-history, project, memory,
  project-document, and settings mutations.
- Production requires an explicit strong `CSRF_SECRET`.
- Login, register, forgot-password, reset-password, resend-verification, and
  verify-email have initial rate limiting with a route-specific per-IP limiter
  before the 16 KiB auth JSON parser, plus a normalized-email limiter after
  parsing when email is present. Malformed and oversized bodies consume the IP
  budget. Account deletion is limited independently by both user and IP before
  password verification. Rejections include a `Retry-After` header.
- Auth rate-limit rejections emit structured security logs with hashed email
  and IP identifiers; raw emails, passwords, cookies, and session tokens are
  not logged by this path.
- Production startup fails fast for unsafe credentialed CORS/cookie settings
  such as `CORS_ORIGIN=*`, missing explicit production CORS origins, or
  insecure production cookies.
- Frontend uses `credentials: "include"` and does not store auth tokens in
  localStorage or sessionStorage.

## 10. Known Gaps

- Auth route rate limiting is currently in-memory. This is acceptable as a
  first single-process baseline, but multi-instance deployments need a shared
  Redis/Upstash-style store.
- CSRF protection is implemented, but deployed browser behavior still needs
  smoke-test verification over the real HTTPS frontend/API origins.
- CSRF tokens are signed double-submit tokens and are not bound to a specific
  server-side session row. Consider session-bound synchronizer tokens later if
  stricter per-session semantics are needed.
- Password reset and email verification use a durable encrypted database
  outbox with SMTP delivery. Production still needs real SMTP credentials, domain
  verification, DNS, SPF, DKIM, DMARC, and provider smoke testing before real
  users. Delivery failures emit only a structured operation-level event; the
  recipient, token, provider response, and raw error are never logged.
- Missing-user login performs a valid dummy scrypt verification. Registration
  no longer discloses duplicate emails. Forgot-password and resend-verification
  return after a configured response floor and enqueue delivery instead of
  waiting for SMTP, removing the previous network-sized timing distinction.
- The frontend reset-completion page is implemented; deployed email links and
  the complete reset flow still require a staging SMTP smoke test.
- Google OAuth UI is present but disabled and not wired.
- Pending encrypted email jobs depend on the configured encryption secret.
  Rotate `EMAIL_OUTBOX_ENCRYPTION_SECRET` only after the pending queue is empty;
  deployed SMTP behavior and retries still require staging verification.
- Production cookie and CORS combinations have startup guards, but deployed
  browser behavior still needs smoke-test verification over HTTPS.
- No session rotation on login refresh or privilege-sensitive operations.
- No "logout all devices" or per-session management.
- `npm run cleanup:retention` removes expired sessions, old auth tokens, old
  usage records, and old sessionless unverified accounts. The command still
  needs deployment scheduling and alerting.
- Password policy has explicit min/max constants, no composition rules, login
  max-length protection, and a local common-password baseline. A maintained
  breached-password corpus or privacy-preserving lookup is not implemented.
- Basic auth abuse logging exists for rate-limit rejections, but alerting,
  dashboards, and brute-force monitoring rules are not implemented.
- Tests cover important service and API basics, reset-token behavior, rate
  limiting, CSRF behavior, and production cookie config guards, but do not yet
  cover full register/login/reset HTTP success flows against a test database.

## 11. Production Hardening Checklist

### Must Have Before Real Users

- [x] Keep and harden the custom auth module for the initial private beta;
  revisit a maintained auth platform if OAuth, passkeys/MFA, organizations, or
  higher-assurance account recovery enter scope.
- [x] Add rate limiting for login, register, and forgot-password.
- [x] Add rate limiting for reset-password.
- [x] Implement real reset-password tokens with single-use semantics, expiry,
  and hashed token storage.
- [x] Add reset email delivery abstraction.
- [x] Add email verification with hashed, expiring, one-time tokens.
- [x] Wire a production email provider implementation.
- [ ] Configure and smoke-test the production SMTP provider, sender domain,
  SPF, DKIM, and DMARC.
- [x] Add a frontend reset-completion page.
- [x] Invalidate existing sessions after password reset.
- [x] Add CSRF protection for cookie-authenticated state-changing routes.
- [x] Review and document CSRF protection for cookie-authenticated
  state-changing routes.
- [ ] Smoke-test CSRF behavior on the production HTTPS frontend/API domains.
- [ ] Verify production cookie settings over HTTPS.
- [x] Enforce exact production CORS origins for credentialed requests.
- [x] Review and harden registration email-enumeration behavior.
- [x] Add login max password length before password verification.
- [x] Add explicit password policy boundary tests.
- [x] Add auth smoke tests to the staging deployment checklist.

### Should Have Soon

- [x] Add basic auth rate-limit security logging.
- [ ] Add auth monitoring/alerting rules for unusual request volume.
- [x] Add bounded expired-session cleanup and deployment-safe overlap locking.
- [x] Review and harden password policy max-length behavior.
- [x] Review password policy composition/common-password behavior against
  current guidance.
- [x] Add initial tests for production cookie flags and CORS safety.
- [ ] Add "logout all sessions" support for account recovery and security
  incidents.

### Optional Later

- [ ] Add Google OAuth if it becomes active product scope.
- [ ] Add MFA/passkeys if the product needs higher account assurance.
- [ ] Add per-session device management.
- [ ] Add admin-visible auth audit events after an admin role model exists.
- [ ] Add organization/member auth if collaboration becomes active scope.

## 12. Required Tests

Register:

- [x] Valid register creates an unverified `User`, `UserSettings`, and an
  `EmailVerificationToken`.
- [x] Valid register does not create a `Session` or set `qa_session`.
- [ ] Duplicate email returns the documented error.
- [x] Invalid password boundaries return `VALIDATION_ERROR`.
- [ ] Invalid email/name/locale returns `VALIDATION_ERROR`.

Login:

- [ ] Valid login creates a new `Session` and sets the cookie.
- [x] Unverified login returns `EMAIL_NOT_VERIFIED` and creates no session.
- [ ] Remember-me login uses the 30-day expiry.
- [ ] Missing user and bad password return the same invalid-credentials shape.
- [ ] Login does not create a session on invalid credentials.
- [x] Empty login password returns `VALIDATION_ERROR`.
- [x] Oversized login password returns `VALIDATION_ERROR` before verification.

Logout:

- [ ] Logout with a valid cookie deletes the matching session.
- [ ] Logout clears `qa_session`.
- [ ] Logout without a cookie remains safe and returns `{ ok: true }`.

Session validation:

- [ ] Valid `GET /api/auth/me` returns the public user.
- [ ] Missing cookie returns `SESSION_REQUIRED`.
- [ ] Invalid session token returns `SESSION_REQUIRED`.
- [ ] Expired token is deleted and rejected.
- [ ] Malformed or unknown token does not leak internal errors.

Forgot password:

- [x] Existing and missing emails return the same generic response.
- [x] Existing password user creates a hashed reset token.
- [x] Raw reset token is not stored in DB.
- [ ] Invalid email returns `VALIDATION_ERROR`.
- [x] Rate limiting blocks repeated requests.

Reset password:

- [x] Reset token is stored hashed, not raw.
- [x] Valid reset token changes the password.
- [x] Reused reset token is rejected.
- [x] Expired reset token is rejected.
- [x] Used reset token is rejected.
- [x] Password reset invalidates existing sessions.
- [x] Old password fails and new password succeeds after reset.
- [x] Reset-password rate limiting returns 429 after the configured limit.
- [x] Reset-password new password policy boundaries are covered.

Email verification:

- [x] Register creates a hashed verification token and never stores the raw
  token.
- [x] Valid verification token sets `emailVerifiedAt`.
- [x] Expired, used, and missing verification tokens return a generic error.
- [x] Verification tokens are one-time use.
- [x] Resend verification returns a generic response.
- [x] Resend verification creates a token only for existing unverified users.
- [x] Resend verification is rate limited.
- [x] Verify/resend endpoints are protected by CSRF.

Unauthorized API access:

- [ ] Protected chat-history routes reject unauthenticated requests.
- [ ] Protected memory routes reject unauthenticated requests.
- [ ] Protected project routes reject unauthenticated requests.
- [ ] Protected settings routes reject unauthenticated requests.
- [ ] Owner-only project and chat checks reject another user's records.

Frontend:

- [ ] Auth API calls include `credentials: "include"`.
- [ ] `getCurrentUser` maps HTTP 401 to `null`.
- [ ] Login page emits `authenticated` on success.
- [x] Register page shows pending verification and does not emit
  `authenticated`.
- [x] Verify-email route calls the verification API.
- [ ] Logout clears local current-user state even if the request fails.
- [ ] Signed-out users are prompted to sign in for signed-in-only screens.

CSRF:

- [x] `GET /api/auth/csrf` issues a signed token and readable CSRF cookie.
- [x] Missing CSRF token rejects `POST /api/chat`.
- [x] Valid CSRF token allows `POST /api/chat` to reach normal route handling.
- [x] Auth state-changing routes reject missing CSRF tokens.
- [x] Chat-history, project, memory, project-document, and settings mutations
  reject missing CSRF tokens.
- [x] `GET` routes do not require CSRF tokens.
- [x] CORS preflight is not blocked by CSRF middleware.
- [x] Frontend state-changing API clients send `X-CSRF-Token`.
