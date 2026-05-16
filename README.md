# AI QA Assistant

AI QA Assistant is a QA-focused chat workspace for test cases, bug reports, edge cases, checklist generation, screenshot review, and chat export/import.

## Stack

- Frontend: Vue 3, TypeScript, Vite, Bootstrap
- Backend: Node.js, Express, TypeScript
- Database: PostgreSQL
- ORM: Prisma
- AI provider: Gemini
- Styling: Bootstrap plus app SCSS under `apps/web/src/styles`

## Project Structure

```text
apps/
  api/        TypeScript Express API
  web/        Vue 3 web app
    src/
      styles/ App SCSS partials imported by Vite

docs/         Architecture, migration, cleanup, and development notes
docker-compose.yml
```

## Development

Install dependencies:

```bash
npm install
```

Run the API and web app in separate terminals:

```bash
npm run dev:api
npm run dev:web
```

In VS Code, use the included tasks `dev:api` and `dev:web` from **Terminal > Run Task**. Do not use Live Server for this app; it only serves static root files and will not run the Vite app correctly.

The web app runs on:

```text
http://127.0.0.1:5173
```

The API runs on:

```text
http://127.0.0.1:5000
```

## Environment

Create `apps/api/.env` from `apps/api/.env.example`.

## Verification

```bash
npm run verify
npm run build:api
npm run build:web
```

## Styling

Edit SCSS under `apps/web/src/styles/`. Vite compiles it directly from `apps/web/src/main.ts`, so there is no separate root CSS build step.

Prefer Bootstrap utilities for generic spacing, display, and controls. Keep custom SCSS for product-specific surfaces like the sidebar, chat bubbles, composer, markdown output, modals, and themes.
