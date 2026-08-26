# Deploy/Auth Readiness

Last reviewed: 2026-08-12

This review focuses on production/deploy readiness for auth, cookies, CSRF,
CORS, SMTP, and IP-dependent abuse controls. It is documentation only and does
not change runtime behavior.

## 1. Required Production Env

### Core API

Required for production:

```text
NODE_ENV=production
PORT=5000
DATABASE_URL=postgresql://...
APP_ORIGIN=https://your-web-origin.example
CORS_ORIGIN=https://your-web-origin.example
REQUEST_BODY_LIMIT=25mb
```

Notes:

- `DATABASE_URL` must point to the managed production PostgreSQL database, not
  the local Docker database.
- `APP_ORIGIN` is used to build password reset and email verification links.
  It should be the public frontend origin users open in the browser.
- `CORS_ORIGIN` must list exact allowed frontend origins. It can be a
  comma-separated list when staging and production have separate frontend
  origins.
- `CORS_ORIGIN=*` is rejected in production with credentialed requests.

Frontend build env:

```text
VITE_API_BASE_URL=https://your-api-origin.example
```

The value is embedded at web build time, so the web app must be rebuilt when it
changes.

### Cookies

Required for production:

```text
COOKIE_SECURE=true
COOKIE_SAME_SITE=lax
COOKIE_DOMAIN=
```

Use `COOKIE_SAME_SITE=none` only when the frontend and API are cross-site.
`COOKIE_SECURE=true` is required in production and is also required whenever
`COOKIE_SAME_SITE=none`.

`COOKIE_DOMAIN` is optional. Leave it empty unless there is a deliberate need
to share cookies across subdomains of the same parent domain.

### CSRF

Required for production:

```text
CSRF_SECRET=at-least-32-random-characters
CSRF_COOKIE_NAME=qa_csrf
CSRF_HEADER_NAME=X-CSRF-Token
```

Notes:

- `CSRF_SECRET` must be explicit in production and at least 32 characters.
- The default development CSRF secret is rejected in production.
- `GET /api/auth/csrf` issues the signed double-submit token and readable CSRF
  cookie.
- `POST`, `PUT`, `PATCH`, and `DELETE` requests must send the CSRF header and
  matching cookie.

### Auth Email And SMTP

Required for production:

```text
EMAIL_PROVIDER=smtp
EMAIL_FROM="Oddpath <no-reply@eluthira.com>"
SMTP_HOST=smtp.your-provider.example
SMTP_PORT=587
SMTP_USER=...
SMTP_PASS=...
SMTP_SECURE=false
EMAIL_OUTBOX_ENCRYPTION_SECRET=separate_random_secret_at_least_32_characters
EMAIL_OUTBOX_POLL_INTERVAL_MS=5000
EMAIL_OUTBOX_BATCH_SIZE=10
EMAIL_OUTBOX_MAX_ATTEMPTS=5
AUTH_EMAIL_RESPONSE_FLOOR_MS=350
PASSWORD_RESET_PATH=/#/reset-password
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
EMAIL_VERIFICATION_PATH=/#/verify-email
EMAIL_VERIFICATION_TOKEN_TTL_MINUTES=60
```

Notes:

- Production startup fails if `EMAIL_PROVIDER` is missing or `noop`.
- Production startup fails if `EMAIL_FROM`, `SMTP_HOST`, `SMTP_PORT`,
  `SMTP_USER`, or `SMTP_PASS` is missing.
- `SMTP_SECURE=false` is typical for port `587` with STARTTLS.
  `SMTP_SECURE=true` is typical for implicit TLS on port `465`.
- SMTP delivery uses an encrypted database outbox. Keep its encryption secret
  separate from CSRF and other secrets, and rotate it only after the pending
  queue is empty.
- Hash routes are recommended for reset/verification links so raw tokens stay
  after `#`, reducing exposure in server, proxy, and hosting logs.
- Full reset/verification URLs should appear only in the email body sent to the
  provider, not in application logs or security events.

### Private-Beta Registration And Terms Audit

Production registration fails closed. With no explicit value,
`REGISTRATION_MODE` resolves to `disabled` in production (`public` is only a
development/test default), and production rejects `REGISTRATION_MODE=public`.

Keep this configuration until the legal pages have final operator-approved
content:

```text
REGISTRATION_MODE=disabled
```

To open the reviewed private beta:

```text
REGISTRATION_MODE=invite
CURRENT_TERMS_VERSION=2026-08-26-v1
REGISTRATION_INVITE_CODE_HASHES=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true
```

- The date-based version and digest above demonstrate the accepted formats;
  replace both with the identifier of the archived reviewed text and the real
  digest of a newly generated invite code. No raw invite code for the example
  digest is supplied.
- Generate high-entropy invite codes in a password manager or cryptographic
  random generator. Give invitees the raw code, but put only its 64-character
  SHA-256 hex digest in Render. Never commit or log raw invite codes.
- `GET /api/auth/registration-config` exposes only the mode, active terms
  version, and Oddpath-specific localized legal URLs under
  `eluthira.com/oddpath/*` and `eluthira.com/de/oddpath/*`. It never exposes
  hashes or raw codes. Those routes must exist with reviewed product-specific
  text before setting the publication acknowledgement.
- Registration requires `termsAccepted: true` and the exact server-advertised
  `termsVersion`. The new `User` row records `acceptedTermsVersion` and
  `acceptedTermsAt`; existing pre-migration accounts remain null.
- Change `CURRENT_TERMS_VERSION` whenever the accepted documents materially
  change. A tab holding an older version receives `TERMS_VERSION_OUTDATED` and
  must fetch/review the current documents again.
- Never reuse a version identifier for changed text. Archive the exact reviewed
  Terms/Privacy documents and their publication date for every version; a
  database version/time pair is not meaningful without that operator record.
- The configured hashes are reusable beta access codes, not single-use
  invitations. Use separate codes and rotate/remove a digest if a code leaks.
- Arabic currently links to the English legal documents because no reviewed
  Arabic legal route exists. Do not invent or silently publish an unreviewed
  Arabic legal translation.

This is an auditable consent mechanism, not legal approval. Eluthira's current
legal pages still contain explicit draft/operator placeholders; keep
registration disabled until those pages and the version value are reviewed.
Production refuses to boot with registration enabled unless
`LEGAL_DOCUMENTS_PUBLISHED_CONFIRMED=true`. That flag is an explicit operator
acknowledgement only; it does not perform or replace legal review. The committed
Render Blueprint intentionally keeps it `false`.

### Auth And Chat Rate Limits

Important production-tunable auth values:

```text
AUTH_RATE_LIMIT_WINDOW_MS=900000
AUTH_LOGIN_RATE_LIMIT_MAX=10
AUTH_REGISTER_RATE_LIMIT_MAX=5
AUTH_FORGOT_PASSWORD_RATE_LIMIT_MAX=5
AUTH_RESET_PASSWORD_RATE_LIMIT_MAX=5
AUTH_RESEND_VERIFICATION_RATE_LIMIT_MAX=5
AUTH_VERIFY_EMAIL_RATE_LIMIT_MAX=20
```

Important public chat/guest values:

```text
CHAT_RATE_LIMIT_WINDOW_MS=60000
CHAT_RATE_LIMIT_MAX=60
GUEST_CHAT_RATE_LIMIT_MAX=30
GUEST_DAILY_CREDITS=20
USER_DAILY_CREDITS=100
USAGE_WINDOW_HOURS=24
USAGE_IP_HASH_SALT=long-random-production-secret
AI_GLOBAL_USAGE_WINDOW_MS=3600000
AI_GLOBAL_REQUEST_LIMIT=100
AI_GLOBAL_CREDIT_LIMIT=500
AI_GLOBAL_DAILY_REQUEST_LIMIT=500
AI_GLOBAL_DAILY_CREDIT_LIMIT=2500
AI_GLOBAL_MONTHLY_REQUEST_LIMIT=5000
AI_GLOBAL_MONTHLY_CREDIT_LIMIT=25000
```

Those values are a conservative private-beta deployment profile, not provider
currency limits. Keep provider billing alerts and a provider-side budget in
place, and leave `AI_ENABLED=false` until the paid EEA-capable provider project
has been verified.

Current application rate limiters are in-memory. They are acceptable for a
single API process baseline, but multi-instance deployments need Redis,
Upstash, or another shared counter store.

### AI Provider

The auth smoke tests do not require real AI responses, but a usable production
app still needs AI provider configuration:

```text
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

## 2. Cookie Deployment Matrix

### Frontend And Backend On The Same Origin

Example:

- `https://app.example.com`
- API served under the same origin, such as `https://app.example.com/api`

Recommended settings:

```text
COOKIE_SAME_SITE=lax
COOKIE_SECURE=true
COOKIE_DOMAIN=
CORS_ORIGIN=https://app.example.com
```

This is the simplest cookie shape. Host-only cookies are enough, and
`COOKIE_DOMAIN` should stay empty.

### Frontend And Backend On Sibling Subdomains

Example:

- Frontend: `https://app.example.com`
- API: `https://api.example.com`

Recommended settings:

```text
COOKIE_SAME_SITE=lax
COOKIE_SECURE=true
COOKIE_DOMAIN=
CORS_ORIGIN=https://app.example.com
```

Although this is cross-origin, it is usually same-site because both origins
share the same registrable domain. Host-only API cookies are still enough for
API requests to `api.example.com`.

Set `COOKIE_DOMAIN=.example.com` only if there is a deliberate need to share a
cookie across sibling subdomains. Avoid it by default.

### Frontend And Backend On Different Sites

Example:

- Frontend: `https://app-host.example`
- API: `https://api-host.example.net`

Recommended settings:

```text
COOKIE_SAME_SITE=none
COOKIE_SECURE=true
COOKIE_DOMAIN=
CORS_ORIGIN=https://app-host.example
```

Use `SameSite=None` only when the browser would otherwise treat the frontend
and backend as cross-site. `COOKIE_SECURE=true` is mandatory.

### COOKIE_DOMAIN Risks

Broad cookie domains increase blast radius:

- Any trusted or compromised sibling subdomain may receive shared cookies.
- Same-site sibling subdomain attacks become more relevant.
- Debugging cookie behavior is harder during staging and production smoke
  tests.

Use host-only cookies unless there is a clear deployment reason to share
cookies across subdomains. The current env guard rejects protocols, ports,
paths, and wildcards in `COOKIE_DOMAIN`, but it cannot decide whether a broad
domain is operationally safe.

## 3. Trust Proxy / IP Correctness

`apps/api/src/app.ts` does not currently configure Express `trust proxy`.

This matters because the backend uses `req.ip` for:

- auth rate limiting;
- chat rate limiting;
- guest quota/IP protection;
- security event IP hashing.

Without a correct proxy setting, deployed traffic may appear to come from the
reverse proxy instead of the real client. That can make rate limits too broad
or too weak, and it can reduce the value of guest IP quota protection.

Recommended approach:

- Localhost: keep the default unless a local reverse proxy is being tested.
- Render/Railway/managed Node hosts: follow the provider's documented proxy
  guidance and verify what `req.ip` resolves to in staging.
- Cloudflare in front of a host: trust only the known proxy path. Do not accept
  spoofed `X-Forwarded-For` from arbitrary direct clients.
- Nginx: trust the local/private Nginx hop or exact proxy subnet, and ensure
  direct access to the Node process is blocked.

Do not set `trust proxy=true` blindly while the API is directly reachable.
The value should be chosen after the hosting topology is known, then verified
with a staging request from a known client IP.

Recommendation for this project: decide and implement `trust proxy` before a
public deploy that relies on app-level IP rate limits. If hosting is still
undecided, keep it as a deploy-specific task rather than guessing now.

## 4. CORS / CSRF Production Check

Current implementation:

- CORS uses `credentials: true`.
- `CORS_ORIGIN` must be explicit in production.
- `CORS_ORIGIN=*` is rejected in production.
- Missing `Origin` is allowed for non-browser/server-to-server requests.
- CSRF middleware runs before JSON parsing and API routers.
- CSRF skips `GET`, `HEAD`, and `OPTIONS`.
- CSRF protects `POST`, `PUT`, `PATCH`, and `DELETE`.
- Origin validation is performed for state-changing requests when an `Origin`
  header is present.
- `GET /api/auth/csrf` returns the token and sets the readable `qa_csrf`
  cookie.

Production checks:

- Confirm `CORS_ORIGIN` exactly matches the deployed frontend origin.
- Confirm state-changing browser requests use `credentials: "include"`.
- Confirm the browser receives `qa_csrf`.
- Confirm the frontend sends `X-CSRF-Token`.
- Confirm unknown origins fail.
- Confirm `OPTIONS` preflight succeeds.
- Confirm `COOKIE_SECURE=true` over HTTPS.
- Confirm `COOKIE_SAME_SITE` matches the deploy matrix above.

## 5. SMTP Production Check

Current implementation:

- Production requires `EMAIL_PROVIDER=smtp`.
- Production fails fast when SMTP config is incomplete.
- Password reset and email verification use SMTP text emails.
- Register does not create a session until email verification is complete.
- Login blocks unverified password users.

Production checks:

- Use a real transactional SMTP provider or trusted SMTP relay.
- Configure `EMAIL_FROM` with a sender identity approved by the provider.
- Publish and verify SPF, DKIM, and DMARC records.
- Confirm `APP_ORIGIN` is the public frontend origin.
- Prefer:
  - `PASSWORD_RESET_PATH=/#/reset-password`
  - `EMAIL_VERIFICATION_PATH=/#/verify-email`
- Confirm email links open the frontend and not the API host.
- Confirm reset and verification tokens are not printed in app logs.

Known readiness note: the backend reset-password endpoint exists, but
`docs/AUTH.md` currently lists the frontend reset-completion page as missing.
Password reset should not be considered deploy-complete until the user can
complete the reset from the emailed link in the browser.

## 6. Smoke Test Checklist

Run these checks after staging or production deploy:

- [ ] `GET /api/health` works on the deployed API.
- [ ] `GET /api/auth/csrf` returns a CSRF token and sets `qa_csrf`.
- [ ] `GET /api/auth/registration-config` exposes no invite hash or secret.
- [ ] Registration is blocked with `REGISTRATION_DISABLED` in closed mode.
- [ ] Private-beta registration rejects missing/wrong codes and an outdated
  terms version, then accepts a valid code with the current version.
- [ ] The created `User` stores the expected terms version and acceptance time.
- [ ] Register creates an unverified account and sends a verification email.
- [ ] Register response does not set `qa_session`.
- [ ] Verification email link opens the frontend route.
- [ ] `POST /api/auth/verify-email` verifies the account.
- [ ] Login before verification returns `EMAIL_NOT_VERIFIED`.
- [ ] Login after verification succeeds and sets `qa_session`.
- [ ] `GET /api/auth/me` returns the logged-in user.
- [ ] Forgot-password sends a reset email.
- [ ] Reset-password link opens the frontend route.
- [ ] Reset-password changes the password and invalidates old sessions.
- [ ] Login with the old password fails.
- [ ] Login with the new password succeeds.
- [ ] `POST /api/chat` works with CSRF.
- [ ] `POST /api/chat` without CSRF fails with `CSRF_TOKEN_INVALID`.
- [ ] Logout clears `qa_session`.
- [ ] Browser devtools show `qa_session` as `HttpOnly`.
- [ ] Browser devtools show production cookies as `Secure`.
- [ ] Browser devtools show the expected `SameSite` value.
- [ ] CORS allows only the configured frontend origin.
- [ ] Unknown browser origins cannot make credentialed state-changing requests.
- [ ] `OPTIONS` preflight succeeds for state-changing API calls.
- [ ] Rate-limit behavior is reasonable from multiple client IPs.
- [ ] App logs do not contain passwords, session tokens, reset tokens,
  verification tokens, raw cookies, or full reset/verification URLs.

## 7. Remaining Risks

Before real users:

- Configure and verify a real SMTP provider, sender domain, SPF, DKIM, and
  DMARC.
- Add or confirm a frontend reset-completion page.
- Decide deployment-specific `trust proxy` settings and verify `req.ip` in
  staging.
- Smoke-test HTTPS cookies, CORS, CSRF, register, verification, login, logout,
  forgot-password, and reset-password.
- Review registration email-enumeration behavior.
- Review `npm audit` findings from dependency installation.
- Add host/proxy-level public API rate limiting.

Should have soon:

- Move in-memory app rate limit counters to Redis, Upstash, or another shared
  store before multi-instance deployment.
- Add monitoring and alerts for auth rate limits, chat abuse, SMTP failures,
  provider quota failures, and unusual usage spikes.
- Add expired-session and expired-token cleanup jobs.
- Add end-to-end auth smoke tests against a staging database.

Optional later:

- Add a bot challenge for suspicious public traffic.
- Add common-password or breached-password checks.
- Add session management, logout-all-devices, and session rotation.
- Consider session-bound CSRF tokens if stricter per-session CSRF semantics are
  needed.
- Revisit Better Auth/Auth.js only as a deliberate auth workstream if product
  scope expands toward OAuth, passkeys, organizations, MFA, or managed auth
  features.

## Readiness Summary

The auth foundation is close to deploy-ready from an application-code
perspective, but not ready for real users until deployment-specific checks are
completed.

Current code-level strengths:

- Production env guards exist for cookies, CORS, CSRF, and SMTP.
- Auth sessions use httpOnly cookies and hashed server-side session tokens.
- State-changing routes are protected by signed double-submit CSRF.
- Password reset and email verification use hashed, expiring, one-time tokens.
- Production cannot boot with `EMAIL_PROVIDER=noop`.

Deployment blockers remain:

- Real SMTP provider and DNS deliverability setup.
- HTTPS cookie/CORS/CSRF smoke testing on the real frontend/API origins.
- `trust proxy` decision for the selected host.
- Frontend reset-completion path verification or implementation.
- Host/proxy-level public traffic rate limiting.
- Monitoring/alerting and dependency audit review.
