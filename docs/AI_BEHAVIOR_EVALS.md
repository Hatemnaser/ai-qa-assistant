# AI Behavior Evals

These evals protect the assistant behavior that matters most for the product: useful QA output without forcing every message into a rigid template.

The automated contract lives in:

```text
apps/api/tests/ai-behavior.test.ts
```

Run it through the normal API test command:

```bash
npm run test:api
```

## Behavior Contract

| Scenario | Expected behavior |
| --- | --- |
| User says `thanks` after a QA artifact | Reply conversationally, no new checklist or report. |
| User asks for Arabic or English | Change language conversationally, no artifact template. |
| User asks a clarification question | Explain or clarify, no artifact template. |
| User asks for test cases from General mode | Infer `test_cases` and build a test case artifact. |
| User asks for a bug report from General mode | Infer `bug_report` and build a bug report artifact. |
| User asks for edge cases from General mode | Infer `edge_cases` and build an edge case artifact. |
| User asks for a checklist from General mode | Infer `checklist` and build a checklist artifact. |
| User uploads an image and asks for review | Use visual review behavior. |
| User uploads an image and asks for test cases | Use the image as context and build test cases instead of forcing visual review. |
| User uploads an image without a specific task | Briefly describe the image and offer QA workflow options. |
| User uploads a new image with a short note like `waw` | Treat the new image as the latest context, briefly describe it, and offer QA options. |
| User uploads a new image with `can you explain this?` | Use visual context instead of treating it as a text-only clarification. |
| User uploads text/data files without a specific task | Briefly summarize the attached file context and offer QA workflow options. |
| User uploads text/data files with a short note like `thanks` | Treat the new files as the latest context, summarize them, and offer QA options. |
| User uploads text/data files with `can you explain this?` | Use file context instead of treating it as a text-only clarification. |
| User uploads text/data files while an artifact mode is selected | Use the file content as context for that artifact mode, except Visual Review should not ask for a screenshot. |
| User says `thanks` or `waw` while Visual Review is selected but no new image is attached | Reply conversationally, do not ask for another image just because older context involved one. |
| Older image/file context exists in history but no new attachment is sent | Let the latest text intent win; do not ask for a new image/file unless the latest message asks for it. |
| User gives a tiny artifact request like `login` | Ask focused clarification questions before inventing details. |

## Workflow Routing

The backend uses a two-step workflow decision:

1. Local rules handle high-confidence cases such as clear QA artifact requests, new attachments, and obvious follow-ups.
2. The AI workflow router can classify ambiguous cases, especially multilingual requests or selected-mode follow-ups like `شكرااااا` while Bug Report is selected.

The router returns JSON only. It does not write the final assistant answer. The final answer still goes through the normal prompt templates and provider flow.

Local workflow rules intentionally avoid Arabic phrase lists. Arabic, mixed-language, German, and other multilingual intent detection should go through the router when the local rules cannot confidently classify the latest message.

## Model Routing

After workflow routing, the backend chooses a target model by policy:

| Workload | Default model |
| --- | --- |
| General QA, quick actions, conversational follow-ups, and text/data files | `gemini-3.1-flash-lite` |
| Image attachments, visual context, and screenshot review | `gemini-2.5-flash` |
| Policy fallback | `gemini-2.5-flash-lite` |

The model selected in the UI is treated as the requested model. The backend can still route to a better model for the effective workflow, and returns `modelRouting` metadata for debugging.

Relevant environment settings:

```bash
AI_MODEL_ROUTER_ENABLED=true
AI_GENERAL_MODEL=gemini-3.1-flash-lite
AI_VISUAL_MODEL=gemini-2.5-flash
AI_FALLBACK_MODEL=gemini-2.5-flash-lite
```

## Selected Mode vs Effective Mode

`selectedMode` is the mode the user chose in the UI, either from the topbar or a quick action.

`effectiveMode` is the mode the backend actually uses after workflow routing.

Examples:

```text
selectedMode: general
latest message: create test cases for checkout
effectiveMode: test_cases

selectedMode: bug_report
latest message: thanks
effectiveMode: general

selectedMode: general
latest message: Erstelle bitte einen Fehlerbericht
effectiveMode: bug_report
```

Quick actions should act as a one-message hint. After the response, the UI can return to General QA while the backend still uses chat history and routing to understand follow-ups like `make it shorter`.

Relevant environment settings:

```bash
AI_WORKFLOW_ROUTER_ENABLED=true
AI_WORKFLOW_ROUTER_MODEL=gemini-3.1-flash-lite
AI_WORKFLOW_ROUTER_MIN_CONFIDENCE=0.72
AI_WORKFLOW_ROUTER_TIMEOUT_MS=8000
```

## Rules

- The latest user message is stronger than the selected mode.
- Chat history can provide context, but it must not override the latest user intent.
- Prompt changes should add or update evals when they change user-visible behavior.
- Provider-specific failures, quota messages, and backend errors are not valid AI history context.
