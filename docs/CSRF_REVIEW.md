# CSRF Review

Last reviewed: 2026-06-20

This document reviews CSRF risk for the cookie-authenticated API and documents
the Slice 3B protection now implemented in code.

## Current Cookie/CORS Setup

### Cookies

Shared cookie options come from `apps/api/src/config/cookies.ts`:

- `httpOnly`: `true` for auth and guest cookies.
- `secure`: from `COOKIE_SECURE`; defaults to `true` when
  `NODE_ENV=production`.
- `sameSite`: from `COOKIE_SAME_SITE`; default is `lax`.
- `path`: `/`.
- `domain`: optional through `COOKIE_DOMAIN`; omitted when not configured.

Auth cookie:

- Name: `qa_session`.
- Contains the raw opaque session token.
- Database stores only `Session.tokenHash`.
- Uses an explicit `expires` value based on session lifetime.

Guest cookie:

- Name: `qa_guest_id`.
- Uses the same shared cookie options, including `httpOnly`.
- Uses `maxAge` of 365 days.

CSRF cookie:

- Default name: `qa_csrf`; configurable through `CSRF_COOKIE_NAME`.
- Set by `GET /api/auth/csrf`.
- `httpOnly`: `false`, intentionally, so the frontend can pair the token with
  the `X-CSRF-Token` header.
- Inherits `secure`, `sameSite`, `path`, and optional `domain` from the shared
  cookie options.
- Contains a signed CSRF token, not a session token or application secret.

Production env guards in `env.ts`:

- `COOKIE_SECURE` must be `true` in production.
- `COOKIE_SAME_SITE=none` requires `COOKIE_SECURE=true`.
- `COOKIE_DOMAIN` must be a plain domain without protocol, port, path, or
  wildcard.
- `CSRF_SECRET` must be explicitly configured in production and must be at
  least 32 characters.
- `CSRF_COOKIE_NAME` and `CSRF_HEADER_NAME` must be syntactically safe.

### CORS

CORS is configured in `apps/api/src/config/cors.ts`:

- `credentials: true`.
- Missing `Origin` is allowed for non-browser/server-to-server style requests.
- Requests are allowed when the origin is in `CORS_ORIGIN`.
- Non-production can allow `CORS_ORIGIN=*`.
- Production rejects wildcard CORS with credentialed requests.
- Production requires `CORS_ORIGIN` to be explicitly configured.
- Production requires every configured origin to be an explicit `http` or
  `https` origin.

Frontend API calls keep `credentials: "include"`. State-changing frontend calls
go through `csrfFetch`, which obtains a token from `GET /api/auth/csrf` and
sends it in the configured CSRF header.

## State-Changing Routes

The CSRF middleware is registered globally before the API routers and protects
all `POST`, `PUT`, `PATCH`, and `DELETE` requests. It skips `GET`, `HEAD`, and
`OPTIONS`, so read routes and CORS preflight are not blocked by CSRF checks.

Protected auth routes:

- `POST /api/auth/register`.
- `POST /api/auth/login`.
- `POST /api/auth/forgot-password`.
- `POST /api/auth/reset-password`.
- `POST /api/auth/logout`.

Protected chat and usage routes:

- `POST /api/chat`.

Protected chat-history routes:

- `PUT /api/chats/:chatId`.
- `DELETE /api/chats/:chatId`.

Protected memory routes:

- `POST /api/memories`.
- `PUT /api/memories/:memoryId`.
- `DELETE /api/memories/:memoryId`.

Protected project routes:

- `POST /api/projects`.
- `PUT /api/projects/:projectId`.
- `DELETE /api/projects/:projectId`.
- `PUT /api/projects/:projectId/instructions`.
- `PUT /api/projects/:projectId/memory`.
- `POST /api/projects/:projectId/documents`.
- `POST /api/projects/:projectId/documents/import`.
- `PUT /api/projects/:projectId/documents/:documentId`.
- `DELETE /api/projects/:projectId/documents/:documentId`.

Protected settings routes:

- `PUT /api/settings`.

Protected data-portability routes:

- `POST /api/portability/account/export`.
- `POST /api/portability/account/import/preview`.
- `POST /api/portability/account/import/commit`.
- `POST /api/portability/projects/:projectId/export`.
- `POST /api/portability/projects/import/preview`.
- `POST /api/portability/projects/import/commit`.

Unprotected safe/read routes include `GET /api/auth/csrf`, `GET /api/auth/me`,
`GET /api/usage/summary`, `GET /api/ai/models`, health checks, and other
read-only `GET` routes.

No `GET` route was found that intentionally changes user-owned application
data. Known stateful `GET` side effects remain documented:

- `GET /api/auth/me` can delete the presented expired session.
- `GET /api/usage/summary` can create a guest cookie and can clear an invalid
  auth cookie.

## Current Risk Assessment

Overall risk after Slice 3B: **low-to-medium**, still deployment-dependent.

Current strengths:

- Auth and guest cookies default to `SameSite=Lax`.
- Production requires secure cookies.
- Production rejects wildcard `CORS_ORIGIN` with credentials.
- Production requires explicit CORS origins.
- State-changing routes use POST, PUT, PATCH, or DELETE rather than GET.
- State-changing routes require a signed CSRF token in both a readable CSRF
  cookie and a custom request header.
- The CSRF token is HMAC-signed with `CSRF_SECRET` and does not contain
  session data, passwords, reset tokens, prompts, or other sensitive content.
- `OPTIONS` preflight is skipped by CSRF middleware and handled by CORS.
- Requests with an `Origin` header must come from the configured allowed
  origins.

Remaining risks:

- The CSRF token is not stored server-side and is not bound to a specific
  session record. It is a signed double-submit token, not a synchronizer-token
  implementation.
- Broad `COOKIE_DOMAIN` settings can increase same-site sibling-subdomain risk.
- Browser behavior still needs staging smoke tests over the real HTTPS
  deployment shape.
- Rotating `CSRF_SECRET` invalidates existing CSRF tokens and requires clients
  to fetch a new token.

## Is SameSite=Lax Enough?

`SameSite=Lax` is still a good baseline, but it is no longer the only CSRF
control. The implemented CSRF header/cookie check should remain enabled for
real users, especially because the API uses httpOnly cookie sessions and has
state-changing routes that can consume credits or modify account data.

`SameSite=Lax` plus CSRF protection is appropriate for the expected early
deployment when:

- Frontend and backend are same-site or exact allowed origins are configured.
- Cookies are secure in production.
- CORS allows only exact trusted origins.
- No untrusted sibling subdomain can run attacker-controlled pages under the
  same registrable site.

If `COOKIE_SAME_SITE=none` is required for a cross-site deployment, the CSRF
token remains required and `COOKIE_SECURE=true` is enforced by startup guards.

## When CSRF Token Is Required

The CSRF token is required for every API request using these methods:

- `POST`.
- `PUT`.
- `PATCH`.
- `DELETE`.

The frontend obtains the token from:

- `GET /api/auth/csrf`.

The request must include:

- CSRF cookie: default `qa_csrf`.
- CSRF header: default `X-CSRF-Token`.

Missing cookie, missing header, mismatched token, malformed token, invalid
signature, or unknown `Origin` causes:

- HTTP 403.
- `code: CSRF_TOKEN_INVALID` for token failures.
- `code: CORS_FORBIDDEN` when rejected by the CORS layer.

## Recommended Slice 3B Implementation Plan

Slice 3B is implemented:

1. Central CSRF middleware was added in
   `apps/api/src/middleware/csrf.middleware.ts`.
2. The strategy is signed double-submit token using HMAC-SHA256 and
   `CSRF_SECRET`.
3. `GET /api/auth/csrf` issues a readable CSRF cookie and returns the same
   signed token to the frontend.
4. The middleware protects all state-changing methods globally before route
   handlers run.
5. Frontend state-changing API calls use `apps/web/src/api/csrf.ts` to fetch
   and send the token with `credentials: "include"`.
6. `env.ts` validates CSRF cookie/header names and requires a strong explicit
   `CSRF_SECRET` in production.

Future hardening options:

- Add a client retry path that refreshes the CSRF token once after a
  `CSRF_TOKEN_INVALID` response.
- Consider session-bound synchronizer tokens if the app later needs stricter
  per-session CSRF semantics.
- Add deployment smoke tests for the real frontend/API domains and cookie
  domain settings.

## Required Tests

Implemented coverage:

- `GET /api/auth/csrf` issues a signed token and readable CSRF cookie.
- Missing token rejects `POST /api/chat`.
- Valid token allows `POST /api/chat` to reach normal route validation.
- Missing cookie rejects state-changing requests.
- Missing header rejects state-changing requests.
- Invalid token rejects state-changing requests.
- Auth state-changing routes are protected.
- Chat-history, project, project-document, memory, and settings mutations are
  protected.
- `GET` routes do not require a CSRF token.
- CORS preflight is not broken.
- Unknown origins are rejected.
- Production env validation requires explicit strong `CSRF_SECRET`.
- Frontend state-changing API tests assert `X-CSRF-Token` is sent.

Still useful later:

- End-to-end browser smoke test on the deployed HTTPS domains.
- CSRF token refresh/retry behavior if stale-token UX becomes visible.
- Explicit tests for broad `COOKIE_DOMAIN` deployment rules if that is ever
  enabled.
