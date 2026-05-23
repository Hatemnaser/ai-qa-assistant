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
| User says `thanks` or `waw` while Visual Review is selected but no new image is attached | Reply conversationally, do not ask for another image just because older context involved one. |
| User gives a tiny artifact request like `login` | Ask focused clarification questions before inventing details. |

## Rules

- The latest user message is stronger than the selected mode.
- Chat history can provide context, but it must not override the latest user intent.
- Prompt changes should add or update evals when they change user-visible behavior.
- Provider-specific failures, quota messages, and backend errors are not valid AI history context.
