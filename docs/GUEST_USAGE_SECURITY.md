# Guest Usage & AI Abuse Protection

Last reviewed: 2026-06-19

This document describes the current guest-mode usage protection and AI-cost
guardrails, including Guest Usage & AI Abuse Protection Slices 1.5A, 1.5B,
1.5C, 1.6, and 1.7.

## 1. Overview

Guest mode lets an unauthenticated visitor use `/api/chat` with limited demo
credits. The backend creates a long-lived httpOnly guest cookie when a visitor
uses chat or opens the usage summary without a valid signed-in session.

The current protection model is server-side:

- Guests are identified by a `qa_guest_id` cookie plus the request IP address.
- Guest IP addresses are HMAC-hashed before being stored in usage records.
- `/api/chat` has an initial in-memory request rate limiter keyed by IP and,
  where available, by guest cookie or signed-in user id.
- Chat credits are reserved before any AI provider call. Slice 1.5B makes
  reservation transactional with PostgreSQL advisory locks so parallel
  requests for the same usage scope cannot normally exceed quota.
- Slice 1.6 adds a global DB-backed `/api/chat` AI usage guard so provider
  calls are also capped across all guests and signed-in users in a configurable
  window.
- Slice 1.7 extends the same global AI operation guard to non-chat provider
  work: conversation summaries, project document embeddings, and semantic RAG
  query embeddings.
- If a guest exceeds the configured credit window, `/api/chat` returns
  `USAGE_LIMIT_REACHED` and the AI provider is not called.
- Guest chats themselves are stored in browser `localStorage`, not in
  PostgreSQL, until the visitor signs in or registers.

The current model is a good portfolio/demo foundation, but it is not complete
bot or spend-abuse protection for a public launch.

## 2. Current Architecture

### Guest Identity

Guest identity is created in `apps/api/src/modules/usage/usage.cookies.ts`.

- Cookie name: `qa_guest_id`.
- Value: `randomBytes(24).toString("base64url")`.
- Existing cookie values are accepted only if they match
  `/^[A-Za-z0-9_-]{24,128}$/`.
- Max age: one year.
- Cookie options reuse `getBaseCookieOptions`, so the cookie is httpOnly,
  path `/`, and uses the configured `sameSite`, `secure`, and optional
  `domain` settings.

The guest cookie is created by:

- `POST /api/chat`, when no valid signed-in session exists.
- `GET /api/usage/summary`, when no valid signed-in session exists.

If a request includes an auth cookie but the session is invalid, the API clears
the stale auth cookie and continues as a guest.

### Cookies / Local State

There are two separate guest concepts:

- Server guest identity: the httpOnly `qa_guest_id` cookie used for credits.
- Browser guest chat storage: `localStorage` under the guest scope in
  `apps/web/src/features/chat/chatStorage.ts`.

The server does not trust `localStorage` for credits or identity. Deleting
local chat state does not reset server-side usage. Deleting the `qa_guest_id`
cookie can create a new guest id, but current usage is still also counted by
hashed IP address.

### Backend Ownership Model

The backend derives identity from server-controlled sources:

- Signed-in user: loaded from the `qa_session` auth cookie through
  `authService.getOptionalCurrentUser`.
- Guest: created/read from the `qa_guest_id` cookie by `getOrCreateGuestId`.
- IP protection: derived from `req.ip` and HMAC-hashed with
  `USAGE_IP_HASH_SALT`.

The `/api/chat` request body does not accept `userId`, `guestId`, or `ownerId`.
The controller passes `userId`, `guestId`, and `ipAddress` to the chat service
from cookies/session/request metadata only.

Signed-in protected resources use `requireAuth` and owner checks. Guest chat
requests do not load account memory, project memory, project documents, or
conversation summaries from server-side storage.

### Usage / Credits Model

Usage is stored in `UsageEvent` records:

- `userId`: set for signed-in user usage.
- `guestId`: set for guest usage when a guest cookie exists.
- `ipHash`: set for guest usage when an IP address exists.
- `action`: `chat_message` for chat requests, plus non-chat AI operation
  actions such as `conversation_summary`, `document_embedding`, and
  `rag_query_embedding`.
- `units`: credit units used for quota counting.
- `status`: `reserved`, `completed`, or `failed`.
- `creditsReserved` / `creditsUsed`: estimated and final credit metadata.
- model/workflow/token/attachment metadata for usage summaries.

Default limits come from `apps/api/src/config/env.ts`:

- `GUEST_DAILY_CREDITS`: default `20`.
- `USER_DAILY_CREDITS`: default `100`.
- `USAGE_WINDOW_HOURS`: default `24`.
- `USAGE_TOKENS_PER_CREDIT`: default `1000`.
- `USAGE_IMAGE_CREDITS`: default `4`.
- `USAGE_TEXT_FILE_CREDITS`: default `1`.
- `USAGE_ROUTER_CREDITS`: default `1`.
- `AI_GLOBAL_USAGE_WINDOW_MS`: default `3600000` (one hour).
- `AI_GLOBAL_REQUEST_LIMIT`: default `1000`.
- `AI_GLOBAL_CREDIT_LIMIT`: default `5000`.
- `AI_GLOBAL_DAILY_REQUEST_LIMIT`: default `2500` (rolling 24 hours).
- `AI_GLOBAL_DAILY_CREDIT_LIMIT`: default `10000` (rolling 24 hours).
- `AI_GLOBAL_MONTHLY_REQUEST_LIMIT`: default `30000` (current UTC calendar month).
- `AI_GLOBAL_MONTHLY_CREDIT_LIMIT`: default `100000` (current UTC calendar month).

For signed-in users, usage is counted by `userId`. For guests, usage is counted
by both `guestId` and `ipHash`; the effective used value is the maximum of the
two counts. This means deleting the guest cookie does not immediately reset the
IP-scoped quota.

### Chat Request Flow

`POST /api/chat` is open to guests and signed-in users.

High-level backend flow:

1. The chat IP limiter runs before Express reads the request body. Chat JSON then
   uses `REQUEST_BODY_LIMIT` (default `25mb`) for the temporary inline-attachment
   compatibility path; other JSON routes use a smaller `5mb` ceiling.
   `25mb`.
2. The controller applies the `/api/chat` per-IP rate limiter.
3. `chatRequestSchema` validates the request:
   - `message` is required and capped by `MAX_MESSAGE_CHARS`, default `3000`.
   - `history` is capped by `MAX_HISTORY_MESSAGES`, default `10`.
   - attachments are capped to four files.
   - inline images and text/data files have type and size checks.
4. The controller reads the auth cookie and loads an optional current user.
5. If signed in, `userId` is passed to the chat service.
6. If not signed in, the API creates/reads `qa_guest_id` and passes `guestId`
   plus `req.ip`.
7. The controller applies the user/guest identity rate limiter.
8. The chat service resolves model/workflow/capability preflight.
9. Signed-in memory/project context is prepared only when `userId` exists.
10. Credits are estimated from message, history, attachments, memory context,
   model, workflow router, and output estimate.
11. `usageService.reserveChatCredits` checks stale reservations, global AI
   usage limits, identity quota, and records a reserved usage event in a
   PostgreSQL transaction before AI provider work.
12. Semantic project-context resolution and workflow router/provider calls run
    only after usage is reserved. Semantic RAG query embedding has its own
    Slice 1.7 operation guard before the embedding provider is called.
13. On success, the usage event is updated with actual token metadata when
    available.
14. On provider failure, the reserved credits are released by marking the
    event failed with zero units when possible.

### Adoption After Login/Register

There is no backend endpoint named "adoption."

Guest chat adoption is a frontend storage migration:

1. A guest uses chats stored in browser `localStorage` under the guest scope.
2. After login/register, `App.vue` calls
   `setChatStorageOwner(user.id, { adoptGuestChats: true })`.
3. `migrateGuestChatsToUser` moves guest chats from the guest localStorage
   scope into `user:<userId>` localStorage scope.
4. `syncAccountChats` fetches server account chats from `/api/chats`.
5. The frontend merges local and server chats by updated time.
6. The merged chats are saved to the signed-in account through protected
   `/api/chats/:chatId`.

The backend does not trust a frontend `userId` for adoption. `/api/chats`
routes require the signed-in session and save chats under `req.authUser.id`.

## 3. Guest Chat Flow

When an unauthenticated visitor sends a chat message:

1. The frontend stores the draft/user message in local chat state.
2. `sendMessageToAI` sends `POST /api/chat` with `credentials: "include"`.
3. The request body includes message, mode, model, bounded history, optional
   chat id, optional project id, and optional attachments.
4. The backend validates the body through `chatRequestSchema`.
5. The backend tries to load a signed-in user from `qa_session`.
6. If no valid user exists, the backend creates or reuses `qa_guest_id`.
7. The backend applies `/api/chat` rate limiting by IP and by server-derived
   user/guest identity when available.
8. The backend builds a usage identity from guest cookie plus `req.ip`.
9. The chat service estimates credits and reserves them.
10. If the guest is over quota, the API returns HTTP 429 with
   `USAGE_LIMIT_REACHED`; the AI provider is not called.
11. If the guest has credits, the provider call is made.
12. The usage event is completed or failed.
13. The frontend receives the assistant reply and public usage summary.
14. If the backend returns `USAGE_LIMIT_REACHED`, the frontend marks
   `guestLimitReached` and can show the guest-limit modal.

Guest conversations remain local until sign-in/register and account sync.

## 4. Credit / Quota Enforcement

### Where Credits Are Calculated

Credits are estimated in `apps/api/src/modules/usage/credit-policy.ts`.
Inputs include:

- current message length,
- bounded history content,
- text attachment content,
- conversation summary,
- memory/context tokens for signed-in users,
- image count,
- workflow router estimate,
- model multiplier,
- expected output tokens by workflow/mode.

Actual token metadata from the AI provider can later reduce or adjust the final
credits through `completeChatCredits`.

### Backend Or Frontend Enforcement

Quota enforcement is backend-side in `usageService.reserveChatCredits`.

The frontend only displays usage and blocks further guest submissions after it
sees `USAGE_LIMIT_REACHED`. That UI state is convenience only and is not the
security boundary.

### When Credits Are Charged

The system uses reservation first:

1. Estimate credits.
2. Count current usage inside the configured window.
3. Reject if `used + requestedCredits > limit`.
4. Record a `reserved` usage event before the provider call.
5. Update to `completed` with actual token usage after provider success.
6. Update to `failed` with zero units if the provider call fails.

Slice 1.5B moves steps 2-4 into a repository-level transaction for chat usage.
The Prisma/PostgreSQL repository takes transaction-scoped advisory locks for
the relevant usage scope before it counts and inserts:

- signed-in users: `userId`;
- guests: `guestId` and `ipHash`, sorted before locking to avoid deadlocks.

This prevents normal parallel requests for the same signed-in user, guest id,
or guest IP hash from all passing the same pre-insert count.

The global AI usage guard runs in the same reservation transaction. Before an
AI reservation is inserted, the repository counts all known AI usage actions
across the configured short window, a rolling 24-hour window, and the current
UTC calendar month. It rejects the request if adding it would exceed the
request or credit limit for any window. Failed and unknown provider attempts
remain visible to the global request guard; fresh reservations are included,
while abandoned reservations are conservatively converted to `unknown`.
Rejected requests return `AI_USAGE_LIMIT_REACHED` and do not call the workflow
router or AI provider.

If completing usage metadata fails after a successful AI response, the chat
response still returns and the reserved usage remains the fallback accounting.

### What Happens When Credits End

If the request exceeds the current identity limit:

- `reserveChatCredits` throws `USAGE_LIMIT_REACHED`.
- HTTP status is 429.
- Guests receive: `Daily demo credit limit reached. Sign in for more credits or try again later.`
- Signed-in users receive: `Daily credit limit reached. Please try again later.`
- The AI provider is not called.

### Browser Tampering

The browser cannot set `userId`, `guestId`, or `ownerId` in the chat body. The
backend ignores those concepts in request payloads and derives identity from
cookies/session/request metadata.

Deleting frontend localStorage does not reset server usage. Deleting or
altering the guest cookie can create a new guest id, but IP-hash counting still
applies. A bot with both cookie resets and IP rotation can still evade the
current guest quota.

## 5. API Endpoints

### `POST /api/chat`

Open to guests and signed-in users.

Responsibilities:

- Validate chat body and attachment limits.
- Resolve signed-in user or guest identity.
- Create `qa_guest_id` for guests.
- Reserve credits before provider calls.
- Return AI response plus public usage summary when available.
- Clear stale auth cookies when an auth cookie is present but invalid.

The endpoint does not accept `userId` or `guestId` from the body.

### `GET /api/usage/summary`

Open to guests and signed-in users.

Responsibilities:

- Resolve signed-in user or guest identity.
- Create `qa_guest_id` for guests.
- Return only the current identity's usage summary.
- For guests, combine/dedupe usage events matching current guest id or current
  IP hash.

### `POST /api/auth/login` and `POST /api/auth/register`

Not guest-usage endpoints, but they start the frontend adoption path. On
success they set `qa_session`; the frontend migrates local guest chats into the
user localStorage scope and then saves merged chats through `/api/chats`.

### `/api/chats`

Signed-in only through `requireAuth`.

Used after login/register to persist locally adopted chats to the account. The
backend saves under the authenticated user id and validates project ownership
when a `projectId` is present.

## 6. Current Protections

- `qa_guest_id` is httpOnly and uses shared cookie security options.
- Guest cookie values are pattern-validated before reuse.
- Guest usage is tracked by both guest cookie and HMAC-hashed IP address.
- Usage limits are enforced in the backend before AI provider calls.
- Chat usage reservation is transactional and uses PostgreSQL advisory locks
  for the current usage scope before counting and inserting the reserved event.
- Usage records store reserved/completed/failed status and credit metadata.
- Stale `reserved` events older than `USAGE_STALE_RESERVED_MINUTES` are marked
  `unknown` without erasing their reserved units. A process can crash after a
  provider accepted work, so treating the outcome as free would undercount
  potentially billed usage.
- The DB-backed global guard enforces short, rolling daily, and calendar-month
  request/credit limits. It rejects with `AI_USAGE_LIMIT_REACHED` before the
  workflow router or AI provider is called.
- Slice 1.7 adds the same DB-backed global AI operation guard for non-chat AI
  operations:
  - `conversation_summary` is reserved before `summarizer.generate`; if the
    guard rejects, the summary refresh is skipped and chat persistence is not
    blocked.
  - `document_embedding` is reserved before document chunk embedding; if the
    guard rejects, embedding is skipped for that chunk and lexical retrieval
    remains available.
  - `rag_query_embedding` is reserved before semantic query embedding; if the
    guard rejects, retrieval falls back to lexical project-document search.
- `REQUEST_BODY_LIMIT` caps JSON body size, default `25mb`.
- `MAX_MESSAGE_CHARS` caps message length, default `3000`.
- `MAX_HISTORY_MESSAGES` caps request history, default `10`.
- Chat service further bounds client history to the latest eight messages.
- Attachments are capped to four per request.
- Inline images and text/data files have size/type checks.
- Signed-in project/memory context is not loaded for guest chats.
- `/api/chat` does not trust frontend `userId`, `guestId`, or `ownerId`.
- Signed-in chat persistence routes require auth and use owner checks.
- Over-quota requests do not call the workflow router or AI provider.
- Global AI usage limit rejections do not call the workflow router or AI
  provider.
- Non-chat global AI operation limit rejections do not call the summarization
  or embedding providers.
- Slice 1.8 adds basic structured security logs for auth/chat rate limits,
  usage-limit rejections, global AI limit rejections, and provider
  quota/model errors. Logs use hashed IP/email/guest identifiers and avoid
  prompt, password, cookie, token, and raw email content.
- Production cookie/CORS safety guards exist from Auth Hardening Slice 1.

Current rate limits:

- Auth endpoints have rate limiting from Auth Hardening Slice 1.
- `/api/chat` has in-memory rate limiting from Slice 1.5A:
  - general per-IP limiter using `CHAT_RATE_LIMIT_MAX`;
  - guest identity limiter using `GUEST_CHAT_RATE_LIMIT_MAX` when
    `qa_guest_id` exists;
  - signed-in user limiter using `CHAT_RATE_LIMIT_MAX` when a user session is
    available;
  - shared window using `CHAT_RATE_LIMIT_WINDOW_MS`.
- The `/api/chat` limiter is a single-process baseline. Multi-instance
  deployments need Redis, Upstash, or another shared counter store.
- `/api/usage/summary` does not have a dedicated rate limiter today.

## 7. Security Strengths

- Credits are enforced on the backend, not only in the UI.
- The backend reserves credits before provider calls, protecting the AI key
  from normal over-quota guest traffic.
- Guest quota uses both cookie identity and IP hash, so deleting only one local
  browser state does not fully reset quota.
- IP addresses are stored as HMAC hashes, not raw IP strings.
- Chat request schema limits message length, history size, attachment count,
  attachment types, and inline attachment sizes.
- Request body size is capped by Express JSON parser config.
- Guests do not load account memory, project memory, project documents, recent
  persisted turns, or conversation summaries.
- Signed-in identity is derived from session cookies and server-side sessions.
- Stale auth cookies are cleared when the API falls back to guest mode.
- Public usage summaries omit internal usage event ids.

## 8. Known Gaps / Abuse Risks

- Bot abuse: `/api/chat` now has a basic in-memory rate limiter, but it is not
  enough against distributed bots, multi-instance deployments, or IP rotation.
- Cookie reset abuse: deleting `qa_guest_id` creates a new guest id, although
  IP-hash quota still helps.
- IP rotation: a bot that rotates IPs and deletes cookies can bypass current
  guest quota.
- Proxy accuracy: `req.ip` depends on correct deployment/proxy configuration.
  Needs verification before relying on IP quotas in production.
- Identity quotas use the rolling `USAGE_WINDOW_HOURS` window (24 hours by
  default). Separately, the global guard has short, rolling daily, and monthly
  windows.
- A DB-backed global AI usage guard now covers chat plus known non-chat AI
  operations, but no provider-budget circuit breaker, billing dashboard, or
  provider-side budget integration exists.
- Basic structured abuse logs now exist for key rejection/provider events, but
  there is still no alerting, dashboard, bot-monitoring pipeline, or active
  detection.
- Atomic reservation depends on the PostgreSQL database and advisory locks.
  It protects normal multi-process API deployments that share the same
  database, but still needs load testing under realistic hosting/proxy
  conditions.
- Underestimated usage: actual provider token usage can be higher than the
  reservation estimate, so final usage may exceed the pre-call estimate after
  the provider has already been called.
- AI provider fallback can protect UX, but there is no provider-integrated
  global guard that stops fallback traffic when provider quota/cost is
  unhealthy.
- Frontend local guest chats can be edited before adoption. This is not a
  cross-user ownership issue by itself, but adopted chat content should be
  treated as user-controlled input.
- Long prompt limit exists through `MAX_MESSAGE_CHARS`, history caps, and
  attachment caps. Needs verification that combined prompt/context limits are
  conservative enough for public abuse and cost control.
- `/api/usage/summary` creates a guest cookie and exposes current-identity
  usage. It does not appear to leak other identities, but it is not
  rate-limited.
- If the API process crashes after reserving usage but before completion/fail
  update, the next reservation for that scope converts the stale row to
  `unknown` after `USAGE_STALE_RESERVED_MINUTES` and keeps its conservative
  units. The scheduled retention job later purges old usage records according
  to `USAGE_RECORD_RETENTION_DAYS`, which is kept at 32 days or more so a
  31-day calendar month is not partially removed before its cap resets.
- Slice 1.7 guards the known non-chat AI operations reviewed in this codebase:
  conversation summaries, document embeddings, and semantic RAG query
  embeddings. Any new future AI operation must be wired through
  `usageService.reserveAiOperation` before calling a provider.

### Slice 1.7: Non-Chat AI Operation Guard

Implemented.

- Central guard: `usageService.reserveAiOperation` records a reserved
  `UsageEvent` through `UsageRepository.reserveUsage`, enforcing the configured
  short, rolling daily, and UTC calendar-month request/credit windows.
- Global counting is shared across chat and non-chat actions:
  `chat_message`, `conversation_summary`, `document_embedding`, and
  `rag_query_embedding`.
- Conversation summaries: guarded in
  `conversation-summary-refresh.service.ts` before `summarizer.generate`.
  `AI_USAGE_LIMIT_REACHED` skips the background summary refresh.
- Project document embeddings: guarded in
  `project-document-embedding.service.ts` before each chunk embedding call.
  `AI_USAGE_LIMIT_REACHED` skips embedding work and leaves lexical retrieval
  available.
- RAG query embeddings: guarded in
  `project-document-hybrid-retrieval.ts` before query embedding. If the guard
  rejects, retrieval falls back to lexical results.
- This is not a billing system, provider-side budget, or admin dashboard. It
  is a DB-backed application guard based on usage events.
- The manual retrieval evaluation script is not a production API path. It now
  requires `ALLOW_REAL_AI_EVALS=true` before it can call the real embedding
  provider.

## 9. Slice 1.5 Proposed Tasks

### Must Have Before Public Demo

- [x] Add a dedicated `/api/chat` rate limiter keyed by IP and guest id for
  guests, and by user id/IP for signed-in users where appropriate.
- [ ] Add a stricter short-window burst limiter for `/api/chat` to stop rapid
  provider-call bursts.
- [x] Add tests proving that request body `userId`, `guestId`, and `ownerId`
  are ignored.
- [x] Add tests proving that deleting/changing frontend localStorage does not
  reset server quota through guest-cookie/IP server-side accounting.
- [x] Add tests proving that guest usage is still limited by IP hash after
  guest-cookie rotation.
- [x] Add an over-quota route/service test proving the AI provider is not
  called.
- [x] Slice 1.5C: clean stale reserved chat usage events after crash/failure
  gaps.
- [x] Slice 1.6: add a DB-backed global `/api/chat` AI usage guard before
  workflow router/provider calls.
- [x] Slice 1.7: guard conversation summaries, document embeddings, and RAG
  query embeddings before non-chat provider calls.
- [x] Add long prompt and oversized attachment tests for `/api/chat` request
  validation.
- [ ] Decide and document deployment `trust proxy` settings so `req.ip` is
  reliable behind the selected host/proxy.
- [x] Add basic abuse logging for `/api/chat` quota/rate-limit rejections.

### Should Have Before Real Users

- [x] Make quota reservation concurrency-safe with a transaction, lock, or
  atomic counter strategy.
- [ ] Move burst/rate-limit counters to Redis, Upstash, or another shared store
  for multi-instance deployments.
- [x] Add a first-pass global provider spend/call guard for `/api/chat`.
- [x] Extend the global AI guard to known non-chat AI operations.
- [ ] Add provider-side budget integration or a stronger circuit breaker.
- [x] Add basic structured logs for `USAGE_LIMIT_REACHED`, provider quota
  errors, global AI limits, and rate-limit rejections.
- [ ] Add monitoring and alerts for `USAGE_LIMIT_REACHED`, provider quota
  errors, high request volume, and unusual guest/IP patterns.
- [x] Slice 1.5B: add atomic quota reservation for chat usage.
- [ ] Add Redis/Upstash-backed rate limiting, scheduled stale-reservation
  cleanup, monitoring/alerts, provider-side budget checks, and optional bot
  challenge only if abuse appears.
- [ ] Review the credit estimate against real provider token/cost behavior and
  tune defaults.
- [ ] Add separate hourly and daily quota controls if the public demo needs
  both burst and daily protection.
- [ ] Add admin-only usage/abuse dashboards after admin roles exist.

### Optional Later

- [ ] Add bot challenge/CAPTCHA only if the public demo receives abuse.
- [ ] Add privacy-conscious device or browser signals if IP/cookie controls are
  insufficient.
- [ ] Add per-model or per-workflow guest caps.
- [ ] Add automated temporary blocks for abusive IPs or guest ids.
- [ ] Add provider-key rotation and budget-aware provider routing.

## 10. Required Tests

- [x] Guest gets limited credits.
- [x] Guest cannot exceed credits.
- [x] Concurrent guest reservations cannot exceed guest quota.
- [x] Stale reserved chat usage is released by marking old reservations failed
  with zero units.
- [x] Deleting or altering frontend state does not reset server quota.
- [x] Guest-cookie rotation does not bypass the IP-hash quota.
- [x] `/api/chat` rejects over-quota guest requests.
- [x] `/api/chat` does not call the AI provider after quota rejection.
- [x] `/api/chat` does not call the workflow router or AI provider after global
  AI usage rejection.
- [x] Conversation summary generation does not call the summarizer after global
  AI usage rejection.
- [x] Project document embedding does not call the embedding provider after
  global AI usage rejection.
- [x] RAG query embedding does not call the embedding provider after global AI
  usage rejection and falls back to lexical retrieval.
- [x] `/api/chat` rate limit works.
- [x] Long prompt is rejected.
- [x] Oversized request body is rejected.
- [x] Oversized inline image is rejected.
- [x] Unsupported or oversized text/data file attachment is rejected.
- [x] Logged-in user adoption preserves guest chat safely in local chat
  storage.
- [ ] User cannot adopt another user's server-side chat.
- [ ] Adopted local guest chats are saved only under the authenticated user.
- [x] Usage summary does not leak another guest's or user's data.
- [x] Backend does not trust `userId`, `guestId`, or `ownerId` from the body.
- [ ] Invalid auth cookie is cleared and request falls back to guest identity.
- [ ] Signed-in `/api/chat` uses user quota and not guest quota.
- [ ] Guest `/api/chat` does not load account/project memory or persisted
  conversation summaries.
