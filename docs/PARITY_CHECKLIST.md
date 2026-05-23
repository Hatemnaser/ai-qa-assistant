# Legacy Parity Checklist

The current goal is not to add new product features. The goal is to keep the migrated chat behavior stable in `apps/web` and `apps/api` with cleaner code.

## Already Migrated

- [x] Chat layout shell with sidebar, topbar, messages, and composer.
- [x] Recent chats stored in `localStorage`.
- [x] Active chat id stored in `localStorage`.
- [x] New chat flow.
- [x] Model and mode selectors.
- [x] `/api/chat` request flow with history.
- [x] Attachment preview with image payload support.
- [x] Markdown rendering for assistant replies.
- [x] Copy and export actions on assistant messages.
- [x] Sidebar export menu for saved chats.
- [x] Chat import from JSON.
- [x] Export formats: MD, TXT, CSV, JSON.
- [x] Quick action buttons.
- [x] API and web tests for core chat, storage, and export behavior.

## Parity Gaps

- [x] Theme toggle from the legacy app.
  - Legacy stores `ai_qa_assistant_theme`.
  - Legacy applies `html[data-theme]`.
  - Existing SCSS already contains dark theme styles, so Vue should reuse them.

- [x] Composer placeholder by selected mode.
  - Legacy changes the placeholder for test cases, bug reports, edge cases, checklist, and visual review.
  - Vue currently uses one generic placeholder.

- [x] Composer textarea auto-resize.
  - Legacy grows and shrinks the textarea while typing.
  - Vue should match that behavior without adding complicated code.

- [x] Drag-over visual state for image upload.
  - Legacy adds a visual drag state when files are dragged over the composer.
  - Vue accepts dropped files, but the visual feedback still needs parity.

- [x] Delete confirmation modal.
  - Legacy confirms before deleting a chat.
  - Vue currently deletes directly from the sidebar menu.

- [x] Inline rename.
  - Legacy renames directly inside the sidebar item.
  - Vue currently uses a browser prompt.

- [x] Attachment menu parity.
  - The composer keeps a plus-button dropup menu.
  - The UI and API use attachment naming, while the active provider path supports image data only.

- [x] Empty welcome state parity.
  - Legacy shows a welcome message with starter actions.
  - Vue should be checked manually and matched if the empty state still feels different.

- [x] Copy feedback parity.
  - Legacy gives temporary copied feedback.
  - Vue copy currently works, but feedback is lighter.

- [x] Model helper behavior.
  - Legacy has model normalization, image-support checks, and select hints.
  - Vue has the basic options, but not all helper hints.

## Styling Rules

- Use Bootstrap utilities first for generic layout and controls.
- Keep app SCSS in `apps/web/src/styles`; Vite compiles it directly.
- Do not add new ad hoc CSS files in `apps/web/src`.
- Keep Vue components focused on structure and behavior, not large style blocks.
- Keep TypeScript simple: small helpers, readable types, no clever generic-heavy patterns.

## Suggested Order

1. Restore theme toggle in Vue using the existing `html[data-theme]` behavior.
2. Match composer behavior: placeholder by mode, auto-resize, and drag-over class.
3. Add delete confirmation modal.
4. Replace prompt rename with inline rename.
5. Match attachment menu behavior.
6. Check empty welcome state and copy feedback.
7. Run manual regression testing against the migrated Vue app.
8. Keep this checklist as the regression list for future cleanup.

## Manual Test Pass

Before considering chat cleanup done, test these flows:

- Start a new chat.
- Send a text prompt in each mode.
- Upload or drop an image.
- Switch model and mode.
- Rename a chat.
- Delete a chat.
- Export a single answer.
- Export a saved chat as MD, TXT, CSV, and JSON.
- Import a JSON chat.
- Toggle theme and refresh the page.
- Refresh the page and confirm the active chat is restored.
