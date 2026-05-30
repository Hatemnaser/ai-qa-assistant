# AI QA Assistant Next Steps

This file is the working roadmap for what is done, what is still foundation work, and what should come next. Use it as the reference when asking "what is next?" or "what still needs cleanup?"

Last reviewed: 2026-05-30

For a short fresh-chat context, start with `docs/AI_HANDOFF.md`.

## Current Health

- [x] Monorepo structure is in place: `apps/web` and `apps/api`.
- [x] Legacy vanilla app was migrated to Vue + TypeScript.
- [x] Backend is modular Express + TypeScript + Prisma.
- [x] PostgreSQL schema is established for users, sessions, chats, projects, memory, usage events, and settings.
- [x] `npm run verify` passes:
  - API tests passing.
  - Web tests passing.
  - API and web TypeScript checks passing.
- [x] Latest pushed baseline was clean before the current project assignment work.

## What Is Complete Enough For The Current Foundation

- [x] Chat workspace with sidebar, composer, messages, export/import, copy, and delete flow.
- [x] Password auth foundation: register, login, logout, current session.
- [x] Optional guest mode for portfolio/demo use.
- [x] Guest and user credit limits before AI calls.
- [x] Credit tracking with token-based completion updates when provider usage metadata is available.
- [x] `My Usage` page for the current identity only.
- [x] Project CRUD API foundation with owner-only authorization.
- [x] Project list/create/edit/delete UI for signed-in users.
- [x] Project assignment UI for signed-in chats.
- [x] Sidebar Projects navigation for opening the project management page.
- [x] Chat persistence for signed-in users, including optional project links with ownership checks.
- [x] Guest chats can be adopted into the signed-in user scope during login/register.
- [x] Chat ownership checks prevent another user from updating/deleting a chat they do not own.
- [x] Gemini provider adapter and model catalog are behind a provider registry.
- [x] Model routing and fallback are implemented.
- [x] AI workflow routing exists for intent detection beyond fixed quick-action buttons.
- [x] Attachments support images plus text/data files:
  - Images: `png`, `jpg`, `jpeg`, `webp`
  - Text/data: `txt`, `md`, `log`, `csv`, `json`
- [x] Composer supports picker, multiple files, drag/drop, and paste.
- [x] Design tokens and SCSS organization exist.

## Not Complete Yet

- [ ] Google OAuth is not wired. The UI button is intentionally disabled.
- [ ] Forgot password only returns a safe generic response. It does not send reset emails yet.
- [x] Settings page/API is implemented for language, theme, and default model.
- [x] Project assignment controls are implemented for signed-in chat workspaces.
- [ ] Memory and project memory are schema-level foundations only.
- [ ] Admin usage dashboard does not exist. Current `My Usage` is personal only.
- [ ] Credits are configured through environment variables, not plans/entitlements from the database.
- [ ] Billing/subscriptions are not implemented.
- [ ] PDF/video/large file upload is not implemented.
- [ ] Provider Files API is not implemented.
- [ ] Full i18n is not implemented. Current multilingual behavior is AI/workflow oriented only.

## Immediate Cleanup Tasks

These should happen before large new product features.

- [x] Update `docs/ARCHITECTURE.md`
  - Add `#/usage`.
  - Add `GET /api/usage/summary`.
  - Mention credit-based usage, model routing, fallback, and attachment behavior.
- [x] Update `docs/NON_FUNCTIONAL_REQUIREMENTS.md`
  - Add provider abstraction requirements.
  - Add personal usage privacy rules.
  - Add credit/entitlement direction.
- [ ] Keep this file updated after each meaningful feature or refactor.
- [x] Split `apps/api/src/modules/usage/usage.service.ts` responsibilities:
  - `usage.service.ts` for reserve/complete/fail.
  - `usage-insights.ts` for `My Usage` summaries.
  - `usage.scope.ts` for identity scope/window helpers.
- [x] Split `apps/web/src/features/chat/composables/useChatController.ts` responsibilities:
  - [x] `useChatSubmit`
  - [x] `useChatAttachments`
  - [x] `useChatExportImport`
- [x] Review error UX copy and backend error codes.
  - Added shared frontend backend-error parsing.
  - Added clearer local setup guidance for database/provider/upload failures.
  - Added Prisma `P1001` handling for unavailable PostgreSQL.
- [x] Add deployment cookie configuration.
  - Added configurable `COOKIE_SAME_SITE`, `COOKIE_SECURE`, and `COOKIE_DOMAIN`.
  - Documented same-site versus split web/API deployment behavior.
- [x] Consider unifying attachment policy between web and API.
  - Current runtime duplication is intentionally small and covered by policy tests.
  - Web text-file limits now match the API inline text limit.
  - Longer-term, expose backend capabilities or move shared constants into a package.

## Product Roadmap Checklist

### Phase 1: Foundation Hardening

- [x] Clean migration from legacy app.
- [x] Auth foundation.
- [x] Chat persistence and ownership.
- [x] Usage credits and guest protection.
- [x] Personal usage view.
- [x] AI workflow routing foundation.
- [x] Update docs after latest features.
- [x] Review error UX copy and backend error codes.
- [x] Confirm production env checklist.
- [x] Decide first deploy target.

### Phase 2: Settings

- [x] Build settings route/page.
- [x] Add API for user settings.
- [x] Persist theme preference server-side for signed-in users.
- [x] Persist preferred language.
- [x] Persist default model.
- [x] Add tests for settings service and API.

### Phase 3: Projects

- [x] Build project list and management page.
- [x] Build sidebar navigation to the project management page.
- [x] Add project CRUD API.
- [x] Add chat-to-project persistence contract and ownership guard.
- [x] Add project assignment UI for chats.
- [x] Add owner-only project authorization.
- [ ] Add project member authorization.
- [x] Add tests for project ownership.

### Phase 4: Memory

- [ ] Add user memory service/API.
- [ ] Add project memory service/API.
- [ ] Decide what memory is manually saved versus AI-extracted.
- [ ] Add memory controls in UI.
- [ ] Add tests for memory isolation by user/project.

### Phase 5: Credits, Plans, And Admin

- [ ] Move credit limits from env-only config toward plan/entitlement records.
- [ ] Add user plan field or entitlement table.
- [ ] Add admin role/permission model before exposing global usage.
- [ ] Build admin usage dashboard only after roles exist.
- [ ] Add per-model usage analytics for admins.
- [ ] Prepare billing module structure, but do not add Stripe until product limits are stable.

### Phase 6: Attachments V2

- [x] Inline images and text/data files.
- [ ] Add provider file upload path for large files.
- [ ] Add PDF support.
- [ ] Add video support only when the provider path is clear.
- [ ] Add file persistence if users should reopen old attachments.
- [ ] Keep exports from embedding large base64 content unless explicitly requested.

### Phase 7: Deployment And Portfolio Readiness

- [x] Add production deployment guide.
- [x] Add `.env` production checklist.
- [x] Add rate limit/proxy notes.
- [x] Add demo-safe defaults.
- [x] Add short architecture section to README.
- [x] Document first deployment target shape.
- [ ] Add screenshots/GIFs to README.

## Gemini / Google AI Studio Model Strategy

This section is based on the model screenshots shared in the chat. Availability and quotas can change, so verify in Google AI Studio before production decisions.

### Current Practical Models

- `Gemini 3.1 Flash Lite`
  - Best current default for high-volume text QA.
  - Screenshot showed higher daily room than some older models.
  - Good for general QA, routing-compatible answers, checklist/test-case generation, and cost-conscious usage.

- `Gemini 2.5 Flash Lite`
  - Good fallback for fast text tasks.
  - Useful when the main default model is unavailable or near quota.
  - Keep as a fallback/general text option.

- `Gemini 2.5 Flash`
  - Better for deeper reasoning and visual review.
  - More expensive in our credit policy because it should be treated as a stronger model.
  - Good for image/visual QA review, harder QA analysis, and more complex outputs.

### Possible Later Models / Capabilities

- TTS models
  - Useful only if the app adds spoken summaries, voice QA coaching, or accessibility/audio output.
  - Not needed for current chat foundation.

- Imagen / image generation models
  - Not needed for QA assistant core.
  - Could be useful later for generating mock screenshots, test data visuals, or design examples, but that is a separate product direction.

- Embedding models
  - Important later for memory and semantic search.
  - Best use cases:
    - user memory retrieval
    - project memory retrieval
    - similar bug/test-case search
    - requirement chunk retrieval
  - Do not add until memory/project docs are actually implemented.

- Search grounding / tool-capable models
  - Useful later if QA answers need current external documentation.
  - Should be treated carefully because it changes privacy, cost, and reliability assumptions.

- Live/audio models
  - Future feature only.
  - Could support real-time QA coaching, but not needed for the current product foundation.

### Model Routing Policy Direction

- General text QA:
  - Prefer `Gemini 3.1 Flash Lite`.
- Fast fallback:
  - Use `Gemini 2.5 Flash Lite`.
- Visual/image QA:
  - Prefer `Gemini 2.5 Flash` if quota allows.
- Workflow router:
  - Use a cheap/fast model with low output and low temperature.
  - It should classify intent only, not answer the user.
- Future memory retrieval:
  - Use embeddings instead of asking the chat model to remember everything.

### Credit Policy Direction

- Keep credits model-agnostic enough to support multiple providers later.
- Count by estimated prompt/output/attachment cost before calling the provider.
- Update with actual token metadata after provider response.
- Charge extra for:
  - image attachments
  - text/data file attachments
  - workflow router calls
  - stronger models
- Keep user-facing credits simple.
- Keep admin-facing usage more detailed later.

## Architectural Rules To Keep

- Do not expose global usage data until admin roles/permissions exist.
- Do not let selected UI mode override the latest user message.
- Do not let older attachment context force future replies into visual/file review.
- Do not store base64 image content in chat history exports or database metadata unless file persistence is explicitly added.
- Do not add large SCSS blocks for each new page if a shared UI component or Bootstrap utility can handle it.
- Do not add new providers directly inside chat service. Add providers through the adapter/registry pattern.
- Do not add billing before plan/credit rules are stable.
- Do not add projects/memory UI without authorization tests.

## Next-Step Decision Guide

When asking "what is next?", choose the first unfinished item that matches the current goal:

1. If the goal is foundation quality:
   - Finish reviewing the current uncommitted settings work, apply the database migration locally, then commit/push the batch.
2. If the goal is user product value:
   - Continue Projects: member authorization and project UX polish.
3. If the goal is portfolio/demo polish:
   - Add README screenshots/GIFs and run a portfolio demo pass.
4. If the goal is SaaS direction:
   - Build plans/entitlements before Stripe.
5. If the goal is AI quality:
   - Expand AI behavior evals and tune workflow routing.
6. If the goal is long-term intelligence:
   - Build memory with embeddings, not just prompt history.
