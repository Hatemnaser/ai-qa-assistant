# Development Guide

This project is currently in foundation and migration mode. Do not add new product features unless the current task explicitly asks for one.

## Working Style

- Prefer Vue templates and Bootstrap classes for UI work.
- Keep TypeScript light and local. Put shared shapes in `types.ts`, but avoid clever generics or type-heavy abstractions.
- Use Bootstrap utilities first for generic layout and controls.
- Keep custom styling in `apps/web/src/styles`. Vite compiles SCSS directly; there is no root CSS build step.
- Do not create new ad hoc CSS files such as `apps/web/src/styles.css`.
- Legacy files have been removed after parity. Use the docs and tests as the migration reference.

## Before Changing Code

1. Check whether the change is a feature, a migration cleanup, or a bug fix.
2. If it is a future feature like auth, settings, projects, memory, billing, or integrations, document it instead of adding active code.
3. If it touches UI styling, look for the matching SCSS partial first.
4. If it touches existing chat behavior, keep localStorage keys and API contracts compatible.

## Frontend Pattern

Use this shape for new or migrated frontend code:

```text
apps/web/src/features/<feature>/
  components/
  composables/
  <feature>Api.ts
  <feature>Storage.ts
  <feature>Messages.ts
  types.ts
```

Do not create every file up front. Add a file only when it removes real weight from another file.

Vue components should stay mostly template + small event handlers. If a component starts carrying business logic, move that logic into a helper or composable.

## Backend Pattern

Use this shape when a backend module has enough behavior:

```text
apps/api/src/modules/<feature>/
  <feature>.routes.ts
  <feature>.controller.ts
  <feature>.service.ts
  <feature>.schema.ts
  <feature>.types.ts
```

Keep routes thin. Put validation in schemas, orchestration in services, and provider-specific code behind provider files.

## Verification

Run this before considering a cleanup done:

```bash
npm run verify
```

For local development, run the app through Vite:

```bash
npm run dev:web
```

Do not use VS Code Live Server for the app. It serves static files from the repository root and bypasses the Vite setup.

Run this after frontend styling or Vue changes when you want a production build check:

```bash
npm run build:web
```

Run this after API changes when you want a production API build check:

```bash
npm run build:api
```

## Current Priorities

1. Keep the migrated chat app stable.
2. Keep TypeScript readable for a Bootstrap-first workflow.
3. Preserve migrated chat behavior with tests and manual checks.
4. Reduce file weight when a file becomes hard to scan.
5. Avoid adding future feature code during the migration phase.
