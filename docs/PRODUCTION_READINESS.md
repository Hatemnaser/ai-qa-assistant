# Production And Demo Readiness

Use this checklist before sharing the app as a portfolio demo or deploying it outside local development.

## Required Checks

- Run `npm run verify`.
- Run `npm run build:api`.
- Run `npm run build:web`.
- Confirm PostgreSQL is reachable.
- Run `npm run db:migrate` against the target database.
- Check `GET /api/health` after deployment.
- Confirm the web app talks to the API through the deployed `VITE_API_BASE_URL`.

## API Environment

Required or strongly recommended for deployed API environments:

```text
NODE_ENV=production
PORT=5000
CORS_ORIGIN=https://your-web-origin.example
DATABASE_URL=postgresql://...
GEMINI_API_KEY=...
USAGE_IP_HASH_SALT=long_random_secret
```

Model and routing configuration:

```text
AI_PROVIDER=gemini
AI_WORKFLOW_ROUTER_ENABLED=true
AI_WORKFLOW_ROUTER_MODEL=gemini-3.1-flash-lite
AI_MODEL_ROUTER_ENABLED=true
AI_GENERAL_MODEL=gemini-3.1-flash-lite
AI_VISUAL_MODEL=gemini-2.5-flash
AI_FALLBACK_MODEL=gemini-2.5-flash-lite
AI_TIMEOUT_MS=55000
AI_MAX_OUTPUT_TOKENS=2048

# Keep false until semantic retrieval and embedding cost controls are intentionally enabled.
PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false
EMBEDDING_PROVIDER=gemini
GEMINI_EMBEDDING_MODEL=gemini-embedding-2
EMBEDDING_DIMENSIONS=768
EMBEDDING_TIMEOUT_MS=15000
```

Demo-safe credit defaults:

```text
GUEST_DAILY_CREDITS=20
USER_DAILY_CREDITS=100
USAGE_TOKENS_PER_CREDIT=1000
USAGE_IMAGE_CREDITS=4
USAGE_TEXT_FILE_CREDITS=1
USAGE_ROUTER_CREDITS=1
USAGE_WINDOW_HOURS=24
```

Keep guest credits conservative while the Gemini API key is shared by the demo. Increase user credits only when there is enough quota or a paid plan.

## Semantic Retrieval Release Gate

Keep `PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false` in shared environments until:

- The target database has the Project Document chunk-index migration.
- Hybrid retrieval passes the lexical baseline cases in `docs/RAG_RETRIEVAL_EVALS.md`.
- Only current vectors with compatible hashes, model, and dimensions are read.
- Missing, stale, disabled, or failed embeddings fall back to lexical retrieval.
- Project authorization and prompt-budget tests pass.
- Provider latency and embedding cost are reviewed for the target environment.
- A smoke test confirms that provider failure does not block document CRUD or project chat.

The controlled `gemini-embedding-2` fixture evaluation passed on 2026-06-13
with Hybrid Hit@1 `6/6`, mean provider latency `304.23 ms`, and P95
`519.01 ms`. This approves controlled opt-in use. Keep the shared default off
until quota, expected traffic, and the target environment's operating policy
are intentionally selected.

Enable embeddings first in a controlled environment. This release gate applies
only to Project Document retrieval; it does not approve memory embeddings or
automatic memory extraction.

## Web Environment

For local development:

```text
VITE_API_BASE_URL=http://127.0.0.1:5000
```

For production, set it to the public API origin:

```text
VITE_API_BASE_URL=https://your-api-origin.example
```

## First Deploy Target

The first portfolio deployment should optimize for reliability and low operational work, not custom infrastructure.

Recommended first target:

- Static web host for `apps/web/dist`.
- Managed Node API host for `apps/api/dist/server.js`.
- Managed PostgreSQL database.
- Exact HTTPS origins for both web and API.

This keeps the architecture close to the local monorepo while avoiding server maintenance. It also lets the API stay stateful enough for httpOnly cookies and Prisma while the frontend remains a simple static build.

Good candidates to evaluate:

- Web: Vercel static/Vite deployment or any static host that can serve `apps/web/dist`.
- API and PostgreSQL: Render, Railway, Fly.io, or another Node-capable host with managed Postgres.

Before choosing, verify current pricing, sleep limits, database backups, region availability, and environment variable support. Provider free tiers change often.

Avoid for the first deploy:

- A pure static-only host for the whole app. The API needs Node, PostgreSQL, cookies, and server-side Gemini key protection.
- A serverless-only API if it makes Prisma connection management or long AI requests painful.
- A public Prisma Studio instance.

## Error UX Contract

The API returns JSON errors with `code` and `error`. The web app maps infrastructure/provider codes into clearer user-facing messages.

Important codes:

- `VALIDATION_ERROR`: request shape is invalid.
- `PAYLOAD_TOO_LARGE`: upload/request body exceeded the configured API limit.
- `DATABASE_UNAVAILABLE`: PostgreSQL is not reachable.
- `DATABASE_SCHEMA_OUT_OF_DATE`: migrations are missing.
- `USAGE_LIMIT_REACHED`: guest or signed-in credit window is exhausted.
- `QUOTA_EXCEEDED`: selected provider/model quota is exhausted.
- `MODEL_UNAVAILABLE`: selected provider/model is temporarily unavailable.
- `UNSUPPORTED_MODEL`: requested model is not in the backend catalog.
- `SESSION_REQUIRED`: the endpoint needs an authenticated session.

Do not expose raw provider stack traces or Prisma internals to users.

## Deployment Notes

- Serve the web app through Vite build output from `apps/web/dist`.
- Run the API from `apps/api/dist/server.js` after `npm run build:api`.
- Put the API behind HTTPS before sharing auth flows publicly.
- Keep `CORS_ORIGIN` exact. Do not use `*` with cookie-based auth.
- If web and API are on the same site, keep `COOKIE_SAME_SITE=lax`.
- If web and API are on different HTTPS sites, set `COOKIE_SAME_SITE=none` and `COOKIE_SECURE=true`.
- Set `COOKIE_DOMAIN` only when intentionally sharing cookies across subdomains of the same parent domain.
- Keep Prisma Studio local-only. Do not expose it on a public host.
- Add host-level rate limiting before serious public sharing; app credits protect Gemini usage, but proxy limits still protect the API process.

Reference docs to check when choosing a host:

- Vite static deployment: https://vite.dev/guide/static-deploy
- Vercel Vite deployment: https://vercel.com/docs/frameworks/vite
- Render Node/Express deployment: https://render.com/docs/deploy-node-express-app
- Render PostgreSQL: https://render.com/docs/postgresql-creating-connecting
- Railway Node deployment: https://docs.railway.com/guides/node
- Railway PostgreSQL: https://docs.railway.com/guides/postgresql

## Current Intentional Gaps

- Google OAuth button is disabled until OAuth is implemented.
- Forgot password returns a safe generic response but does not send email yet.
- Admin dashboards and global usage views should wait for roles/permissions.
- Billing should wait until credit plans/entitlements are modeled in the database.
