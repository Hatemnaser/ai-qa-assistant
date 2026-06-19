# Auth Documentation

Last reviewed: 2026-06-19

This document describes the authentication system that exists in the codebase
today. It is documentation only. It does not approve the current system as a
complete real-user production auth implementation.

## 1. Overview

AI QA Assistant currently uses a custom email/password authentication
foundation. The backend stores users and server-side sessions in PostgreSQL
through Prisma. The browser receives an opaque session token in an httpOnly
cookie named `qa_session`; the database stores only a SHA-256 hash of that
token.

The implemented auth surface supports:

- Register with email, password, optional name, and locale.
- Login with email, password, and optional remember-me session length.
- Logout by deleting the current session and clearing the cookie.
- Current-user lookup through the session cookie.
- Forgot-password request with a generic response.

Reset-password completion is not implemented yet. Google OAuth buttons exist
in the UI but are disabled and not wired to backend routes.

Auth Hardening Slice 1 is implemented: login, register, and forgot-password
have initial in-memory rate limiting, and production cookie/CORS env guards
fail fast on unsafe deployment settings. The rate limiter is suitable as a
single-process baseline; multi-instance deployments should move the counters
to Redis, Upstash, or another shared store. Because the limiter keys off
Express `req.ip`, deployments behind a proxy must configure `trust proxy`
correctly so the API sees the real client IP instead of the proxy address.

## 2. Current Architecture

### Backend Auth Structure

The backend auth module lives in `apps/api/src/modules/auth`:

- `auth.routes.ts`: Express routes under `/api/auth`.
- `auth.controller.ts`: request parsing, cookie setting/clearing, response
  shaping.
- `auth.service.ts`: register, login, logout, current-user, optional-current
  user, session creation, and forgot-password request behavior.
- `auth.repository.ts`: Prisma reads/writes for `User` and `Session`.
- `auth.schema.ts`: Zod schemas for register, login, and forgot-password
  payloads.
- `auth.security.ts`: password hashing/verification and session-token hashing.
- `auth.cookies.ts`: auth cookie name and cookie helpers.
- `auth.rateLimit.ts`: in-memory per-IP plus IP/email auth rate limiting for
  login, register, and forgot-password.
- `auth.middleware.ts`: `requireAuth` middleware and `req.authUser` loading.
- `auth.types.ts`: request/response/service record types.

Related config:

- `apps/api/src/config/cookies.ts`: shared cookie options.
- `apps/api/src/config/env.ts`: `COOKIE_DOMAIN`, `COOKIE_SAME_SITE`,
  `COOKIE_SECURE`, `CORS_ORIGIN`, auth rate-limit settings, production
  safety guards, and other runtime config.
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

`apps/web/src/App.vue` wires auth state into the application shell. The app uses
a small hash-route helper in `apps/web/src/router/useAppRoute.ts`; there is no
Vue Router guard layer today.

### PostgreSQL Usage

Auth uses Prisma models from `apps/api/prisma/schema.prisma`:

- `User`: account identity and password hash.
- `Session`: server-side session records keyed by `tokenHash`.
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

## 3. Auth Flows

### Register

Endpoint:

- `POST /api/auth/register`

Responsible files:

- Backend: `auth.routes.ts`, `auth.controller.ts`, `auth.schema.ts`,
  `auth.service.ts`, `auth.repository.ts`, `auth.security.ts`,
  `auth.cookies.ts`.
- Frontend: `RegisterPage.vue`, `authApi.ts`, `useAuthRequest.ts`,
  `useAuthSession.ts`, `App.vue`.

Steps:

1. `RegisterPage.vue` submits email, name, locale, and password through
   `authApi.register`.
2. `authApi.ts` sends a JSON `POST` request with `credentials: "include"`.
3. `auth.controller.ts` parses the body with `registerRequestSchema`.
4. `auth.schema.ts` trims and lowercases email, validates locale/name, and
   applies the current password policy.
5. `auth.service.ts` checks for an existing user by email.
6. If the email already exists, the service returns
   `EMAIL_ALREADY_REGISTERED` with HTTP 409.
7. The password is hashed in `auth.security.ts`.
8. `auth.repository.ts` creates a `User` and a related `UserSettings` record.
9. `auth.service.ts` creates a new session token, hashes it, and stores a
   `Session` record.
10. `auth.controller.ts` sets the `qa_session` cookie.
11. The frontend receives the public user and session expiry, then `App.vue`
    stores the current user and adopts local guest chats into the signed-in
    storage owner.

Stored in DB:

- `User.email`, `User.name`, `User.locale`, `User.passwordHash`.
- `UserSettings` row with language set to the registration locale.
- `Session.userId`, `Session.tokenHash`, `Session.expiresAt`,
  optional `ipAddress`, optional `userAgent`.

Returned to frontend:

- HTTP 201.
- JSON `{ user, session: { expiresAt } }`.
- `Set-Cookie: qa_session=<raw session token>; ...`.

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
8. The service creates a new server-side session. Remember-me uses 30 days;
   otherwise the session lasts 7 days.
9. `auth.controller.ts` sets the `qa_session` cookie.
10. `App.vue` stores the current user, switches chat storage to the user owner,
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
  `auth.service.ts`, `auth.repository.ts`.
- Frontend: `ForgotPasswordPage.vue`, `authApi.ts`, `useAuthRequest.ts`.

Steps:

1. `ForgotPasswordPage.vue` submits the email through
   `authApi.forgotPassword`.
2. `authApi.ts` sends a JSON `POST` request with credentials included.
3. `auth.controller.ts` parses the body with `forgotPasswordRequestSchema`.
4. `auth.service.requestPasswordReset` calls `findUserByEmail`.
5. The result is intentionally ignored.
6. The service returns the same generic message whether or not an account
   exists.

Stored in DB:

- Nothing is created or updated.
- No reset token is stored.
- No email delivery record is stored.

Returned to frontend:

- HTTP 200.
- JSON `{ message: "If an account exists for that email, password reset instructions will be sent." }`.

### Reset Password

Endpoint:

- Not implemented.

Responsible files:

- No backend route, controller, schema, service method, repository method, or
  frontend page exists for completing a password reset.

Current behavior:

1. The UI can request a reset email through the forgot-password flow.
2. The backend returns a generic message.
3. No reset token is created.
4. No reset email is sent.
5. No user password can be changed through a reset flow.
6. Existing sessions are not invalidated because there is no reset-completion
   flow.

Stored in DB:

- Nothing.

Returned to frontend:

- No reset-completion response exists.

## 4. Database Tables

### users

Prisma model: `User`.

Important fields:

- `id`: primary key.
- `email`: unique normalized account email.
- `name`: optional display name.
- `passwordHash`: nullable password hash. Password users have a value here.
- `locale`: user locale, default `en`.
- `createdAt`, `updatedAt`: audit timestamps.

Auth-related relations:

- `sessions`: server-side sessions for the user.
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

No password reset token table exists today.

### Other Related Tables

`UserSettings` is created during registration and stores preferences such as
language, theme, and default model. It is not an auth credential table, but it
is created as part of the register flow.

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

## 6. Password Handling

Hashing algorithm:

- Node `crypto.scrypt` with a random 16-byte salt.
- Stored hash format: `scrypt-v1$<salt>$<key>`.
- Key length: 64 bytes.
- Salt/key encoding: `base64url`.

Where hashing happens:

- `auth.security.hashPassword`.
- Called from `auth.service.register`.

Where verification happens:

- `auth.security.verifyPassword`.
- Called from `auth.service.login`.
- Verification rejects unknown hash versions and malformed hashes.
- `timingSafeEqual` is used after deriving a same-length test key.

Current password policy:

- 8 characters minimum.
- 128 characters maximum.
- Must include at least one ASCII letter.
- Must include at least one digit.

Needs verification:

- Whether this policy should be relaxed or changed to match current
  OWASP/NIST-style guidance.
- Whether compromised-password checks are needed before real-user production.

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
- `setAuthenticatedUser`: stores the user after login/register.
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
- Shows a disabled Google sign-in button.

`RegisterPage.vue`:

- Collects name, email, password, and a required terms checkbox.
- Sends locale `en`.
- Calls `authApi.register`.
- Emits `authenticated` with the returned user.
- Shows a disabled Google sign-up button.

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
- Login failures use a generic invalid-credentials response for missing users
  and bad passwords.
- Forgot-password response is generic and does not reveal whether an account
  exists.
- Authenticated routes derive the user from the server-side session, not from
  request body user ids.
- Expired sessions are removed when encountered.
- Login, register, and forgot-password have initial rate limiting with a
  general per-IP limiter plus an IP/normalized-email limiter when email is
  present.
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
- CSRF risk for cookie-authenticated state-changing routes needs review.
- Reset-password completion is not implemented.
- Password reset tokens do not exist yet.
- Reset email delivery is not implemented.
- Session invalidation after password reset is not implemented because reset
  completion is not implemented.
- Email verification is not implemented.
- Google OAuth UI is present but disabled and not wired.
- Registration returns `EMAIL_ALREADY_REGISTERED`, which can reveal whether an
  email exists. This may be acceptable for a portfolio demo but should be
  reviewed before real users.
- Production cookie and CORS combinations have startup guards, but deployed
  browser behavior still needs smoke-test verification over HTTPS.
- No session rotation on login refresh or privilege-sensitive operations.
- No "logout all devices" or per-session management.
- No periodic expired-session cleanup job. Expired sessions are removed only
  when the matching token is presented.
- Password policy exists, but alignment with current OWASP/NIST guidance needs
  verification.
- Basic auth abuse logging exists for rate-limit rejections, but alerting,
  dashboards, and brute-force monitoring rules are not implemented.
- Tests cover important service and API basics, but do not yet cover full
  register/login HTTP success flows against a test database, CSRF behavior,
  rate limiting, reset tokens, or production cookie config guards.

## 11. Production Hardening Checklist

### Must Have Before Real Users

- [ ] Decide whether to keep and harden the custom auth module or migrate in a
  dedicated auth workstream.
- [x] Add rate limiting for login, register, and forgot-password.
- [ ] Implement real reset-password tokens with single-use semantics, expiry,
  and hashed token storage.
- [ ] Implement reset email delivery.
- [ ] Invalidate existing sessions after password reset.
- [ ] Review and document CSRF protection for cookie-authenticated
  state-changing routes.
- [ ] Verify production cookie settings over HTTPS.
- [x] Enforce exact production CORS origins for credentialed requests.
- [ ] Review registration email-enumeration behavior.
- [ ] Add auth smoke tests to the staging deployment checklist.

### Should Have Soon

- [ ] Add email verification before broadly enabling real accounts.
- [x] Add basic auth rate-limit security logging.
- [ ] Add auth monitoring/alerting rules for unusual request volume.
- [ ] Add expired-session cleanup.
- [ ] Review password policy against current guidance.
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

- [ ] Valid register creates `User`, `UserSettings`, and `Session`.
- [ ] Valid register sets `qa_session` with expected cookie flags.
- [ ] Duplicate email returns the documented error.
- [ ] Invalid email/password/name/locale returns `VALIDATION_ERROR`.

Login:

- [ ] Valid login creates a new `Session` and sets the cookie.
- [ ] Remember-me login uses the 30-day expiry.
- [ ] Missing user and bad password return the same invalid-credentials shape.
- [ ] Login does not create a session on invalid credentials.

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

- [ ] Existing and missing emails return the same generic response.
- [ ] Invalid email returns `VALIDATION_ERROR`.
- [ ] Rate limiting blocks repeated requests after the future limiter exists.

Reset password:

- [ ] Reset token is stored hashed, not raw, after the feature exists.
- [ ] Valid reset token changes the password.
- [ ] Reused reset token is rejected.
- [ ] Expired reset token is rejected.
- [ ] Password reset invalidates existing sessions.

Unauthorized API access:

- [ ] Protected chat-history routes reject unauthenticated requests.
- [ ] Protected memory routes reject unauthenticated requests.
- [ ] Protected project routes reject unauthenticated requests.
- [ ] Protected settings routes reject unauthenticated requests.
- [ ] Owner-only project and chat checks reject another user's records.

Frontend:

- [ ] Auth API calls include `credentials: "include"`.
- [ ] `getCurrentUser` maps HTTP 401 to `null`.
- [ ] Login/register pages emit `authenticated` on success.
- [ ] Logout clears local current-user state even if the request fails.
- [ ] Signed-out users are prompted to sign in for signed-in-only screens.
