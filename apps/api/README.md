# AI QA Assistant API

This is the TypeScript API for AI QA Assistant. The legacy backend source has been removed after parity migration.

## Commands

```bash
npm --prefix apps/api run dev
npm --prefix apps/api run check
npm --prefix apps/api run build
npm --prefix apps/api run db:validate
npm --prefix apps/api run db:generate
npm --prefix apps/api run db:migrate
npm --prefix apps/api run db:studio
```

From the repository root, these shortcuts are also available:

```bash
npm run dev:api
npm run dev:web
npm run check:api
npm run check:web
npm run build:api
npm run build:web
npm run db:up
npm run db:down
npm run db:migrate
npm run db:studio
```

## Environment

Create `apps/api/.env` from `apps/api/.env.example`.

Required later for real database work:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public
```

Start the local database from the repository root:

```bash
npm run db:up
npm run db:migrate
```

Required for live AI requests:

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

Keep local secrets in ignored `apps/api/.env`.

## Routes

```text
GET  /api/health
POST /api/auth/register
POST /api/auth/login
POST /api/auth/forgot-password
GET  /api/auth/me
POST /api/auth/logout
POST /api/chat
```

Auth uses password hashes, server-side session rows, and an httpOnly `qa_session` cookie. Google OAuth and reset email delivery are intentionally not wired yet.

## Usage Limits

`POST /api/chat` stays available to guests for portfolio demos, but usage is reserved before Gemini is called. Successful chat responses include a `usage` summary so the frontend can show the remaining daily messages.

Defaults:

```env
GUEST_DAILY_MESSAGES=3
USER_DAILY_MESSAGES=10
USAGE_WINDOW_HOURS=24
MAX_MESSAGE_CHARS=3000
MAX_HISTORY_MESSAGES=10
```

Guests are tracked with an httpOnly `qa_guest_id` cookie plus a hashed IP fallback. Signed-in users are tracked by `userId`.
