# Legacy Cleanup Notes

The Vue app and TypeScript API cover the current legacy chat behavior. The legacy app files have been removed, and styling now lives with the Vue app.

## Current Legacy Pieces

| Path | Status | Reason |
| --- | --- | --- |
| `index.html` | Removed | Legacy vanilla frontend entrypoint. Vue app now lives in `apps/web`. |
| `js/` | Removed | Legacy vanilla frontend modules. Behavior has been migrated to Vue feature files. |
| `backend/` source files | Removed | Legacy CommonJS backend. New API lives in `apps/api`. |
| `backend/.env` | Removed after migration | Needed values belong in ignored `apps/api/.env`. |
| `imgs/` | Removed | Code did not reference `imgs/andrea.jpg`. |
| `css/bootstrap.min.css` | Removed | Vue imports Bootstrap from `node_modules`. |
| `js/bootstrap.bundle.min.js` | Removed | Vue imports Bootstrap JS from `node_modules`. |
| `scss/` | Moved | SCSS source now lives in `apps/web/src/styles`. |
| `css/main.css` and `css/main.css.map` | Removed | Vite compiles SCSS directly for the Vue app. |

## Package Script Cleanup

Root scripts now point at the new stack:

| Script | Current | Proposed |
| --- | --- | --- |
| `dev` | `npm run dev:web` | Opens the Vue dev server. |
| `dev:api` | `npm --prefix apps/api run dev` | Keep. |
| `dev:web` | `npm --prefix apps/web run dev` | Keep. |

For now, run the new stack in two terminals:

```bash
npm run dev:api
npm run dev:web
```

## Cleanup Order

1. Run `npm run verify`.
2. Run `npm run build:api` and `npm run build:web`.
3. Open the Vue app and do a final visual pass for chat, menus, theme, import/export, and image upload.
4. Delete `index.html`, `js/`, legacy backend source, and unused `imgs/`. Done.
5. Remove root legacy scripts from `package.json`. Done.
6. Update `README.md` to describe the new Vue/API stack only. Done.
7. Run `npm install` if `package-lock.json` needs to drop old workspace/package references.
8. Run `npm run verify` and `npm run build:web` again.

## Styling Location

The app SCSS lives under `apps/web/src/styles` and is imported from `apps/web/src/main.ts`. Keep generic layout work in Bootstrap classes when practical, and reserve SCSS for product-specific chat UI.
