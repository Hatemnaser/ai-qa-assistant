# Migration Notes

The project is moving in phases from the legacy vanilla app to the new TypeScript product structure.

## Current State

- API: `apps/api/`
- Frontend: `apps/web/`
- Styling source: `apps/web/src/styles/`
- Vite compiles the app SCSS directly from `apps/web/src/main.ts`.
- Legacy frontend files have been removed.
- Legacy backend source has been removed.

## What We Keep

Keep new product code inside `apps/`, documentation inside `docs/`, and repository-level tooling at the root.

## Removed After Parity Pass

- root `index.html`
- root `js/`
- root `css/`
- root `scss/`
- old backend source files
- legacy-only scripts in the root `package.json`

See `docs/LEGACY_CLEANUP.md` for the cleanup sequence.

## Migration Order

1. Keep the new API green with `check`, `build`, and `db:validate`.
2. Add PostgreSQL locally and run the first migration.
3. Keep `/api/chat` compatible with the legacy frontend contract.
4. Add the Vue app shell.
5. Move the chat screen to Vue.
6. Move export/import behavior.
7. Delete legacy code only after manual parity testing. Done.

Use `docs/PARITY_CHECKLIST.md` as the migration tracker before removing legacy files.

## Active Code Rule

Future ideas belong in docs until the feature is close. Avoid adding active services or modules for auth, billing, integrations, advanced memory search, or team permissions before the current app is migrated cleanly.

For the current migration phase, avoid adding new product features. The active goal is to move the existing chat behavior into the new `apps/api` and planned `apps/web` structure with cleaner boundaries.

If the current work is not a feature, prefer cleanup, parity checks, documentation, and verification. See `docs/DEVELOPMENT_GUIDE.md` for the day-to-day coding rules.

## Local Database

The local PostgreSQL database runs through Docker Compose:

```bash
npm run db:up
npm run db:migrate
```

The default development connection string is:

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public
```
