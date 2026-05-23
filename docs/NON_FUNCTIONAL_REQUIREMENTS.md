# Non-Functional Requirements

This project should stay easy to extend while it grows from a portfolio demo into a real product. These rules are the baseline for future work.

## Maintainability

- Keep `App.vue` as composition glue only. Feature state and side effects should live in composables or feature modules.
- Prefer small feature modules: API client, storage, controller, sync, and UI components should stay separate.
- Add new SCSS only when Bootstrap utilities or existing design tokens cannot express the UI cleanly.
- Shared UI behavior should become reusable components before being duplicated across pages.

## Data Ownership

- Guest chats belong to the browser only until the user signs in or registers.
- Signed-in chats belong to the authenticated `userId` and are persisted in the database.
- LocalStorage is a cache for signed-in users, not the source of truth.
- Guest chats may be adopted into a user account only during an explicit sign-in/register flow.

## Reliability

- Chat persistence must not block the main chat interaction.
- Failed chat sync should warn in the console and keep the local copy available.
- The app should merge local and database chats by `updatedAt`, keeping the newest copy per chat id.
- Delete operations should remove the local chat immediately and then attempt the account delete.

## AI Behavior

- The latest user message must take priority over the selected mode and older chat context.
- Conversational follow-ups, thanks, language changes, and clarification questions must not be forced into QA artifact templates.
- Attachments should provide context, not permanently lock the conversation into an attachment-review mode.
- Composer state should use generic attachment naming; provider-specific payloads such as image data should be built at the API boundary.
- When a user uploads an image without a clear task, the assistant should briefly describe it and offer next-step QA options.
- QA artifact responses should include assumptions when details are missing instead of pretending requirements are complete.
- Underspecified artifact requests should ask a few focused questions before generating a large answer.

## Privacy

- Chats from different users must never share the same localStorage scope.
- Authenticated account data must be scoped by `user:<userId>`.
- System errors such as quota or backend failures must not be sent back to the AI as conversation history.

## Usage Protection

- Guest usage is limited by guest cookie and IP hash fallback.
- Signed-in usage is limited by `userId`.
- When guest usage is exhausted, the composer is blocked and the user can sign in, register, export the chat, or close the modal.

## Performance

- Chat DB persistence should be debounced instead of saving on every reactive micro-change.
- Chat history sent to the AI should remain capped by backend validation.
- Large attachments should keep using backend request body limits and client-side validation.

## Testing Expectations

- Critical logic needs unit tests: storage scoping, import/export, prompt mode behavior, usage limits, and API error parsing.
- API route/controller changes need validation tests or service-level tests before feature work continues.
- Builds and type checks must pass before merging.
