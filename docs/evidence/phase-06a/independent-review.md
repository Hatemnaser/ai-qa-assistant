# Oddpath Phase 06A — independent review

Date: 2026-10-14. Result: **two P2 findings; repair and re-review before accepting this slice**. Public activation remains NO_GO. No maintained source, tests, configuration, or repository documentation was modified.

## Findings

### F1 — Do not display an inferred default as the actual historical model

Location: `apps/web/src/features/chat/components/ChatMessages.vue:58`.

The new “Model used” label treats every nonempty `message.model` as recorded execution information. Existing `parseImportedChatJson` fills missing message models with `normalizeModel(undefined)`, which returns `gemini-3.1-flash-lite`. Local storage loading similarly substitutes the chat selection/default when the message model is absent. Consequently a valid imported historical assistant message with no model metadata now claims that Gemini 3.1 Flash Lite produced it, although no generation occurred and the original model is unknown.

Reproduced using the actual importer and Vue/Chromium renderer with `{title:'Legacy export',messages:[{role:'assistant',content:'History without recorded model'}]}`. The parsed message acquired the default, and the rendered text was `Model used: gemini-3.1-flash-lite`. The app's existing Import Chat flow uses this importer; this is not merely an invalid DTO supplied to the component.

Required correction: distinguish the draft's default/selection from historical recorded model metadata. Preserve unknown model information through import/storage and suppress the actual-model label, or explicitly label it unknown. Retain concrete models on successful replies and preserve known historical model strings. Add coverage for missing-model legacy imports/reloads as well as known-model replies.

Evidence: `work/phase-06a-review-20261014/history-model.browser.mjs`, `history-model-result.json`, `history-model.log`, and `history-model.png` in the repository.

### F2 — Classify model-specific NOT_FOUND so Auto can use a compatible fallback

Location: `apps/api/src/modules/ai/model-fallback.ts:29` (interaction with `gemini.errors.ts`).

When a registered policy model is unavailable through the provider's generateContent endpoint and Gemini returns a model-specific HTTP 404/NOT_FOUND response, `normalizeGeminiError` maps it to `AI_PROVIDER_REQUEST_REJECTED`. The Auto gate consequently rejects the request after the first model and never tries the available registered fallback. The new Auto availability contract therefore works for temporary 503 unavailability, but not for the provider rejecting the configured model as missing/unsupported.

Reproduced through the real ChatService, registry, Gemini adapter and installed GoogleGenAI SDK, with global fetch fully replaced before imports. Synthetic response: HTTP 404 with NOT_FOUND and `models/gemini-3.1-flash-lite is not found for API version v1beta, or is not supported for generateContent.` Result for `model:'auto'`: one call to `gemini-3.1-flash-lite`, then `AI_PROVIDER_REQUEST_REJECTED`. The fake endpoint was ready to return success on the fallback, but it was never called. Equivalent 429 and 503 cases correctly used `gemini-2.5-flash-lite`; explicit requests and 403 permission errors correctly stopped after one model.

Required correction: normalize narrowly identified model-availability errors into a fallback-eligible classification. Preserve exact-model-or-error behavior for explicit choices and keep authentication, invalid-input and other non-availability failures ineligible. Cover raw provider/SDK errors, rather than only preconstructed `AppError('MODEL_UNAVAILABLE')` test doubles. This finding makes no claim about current live Gemini availability and requires no model catalog/pricing refresh.

Evidence: `work/phase-06a-review-20261014/provider-wire.test.ts`, `provider-wire-final.log`, and `provider-wire-results.json`.

## Fresh validation and limits

- Source and retained implementation-log hashes matched before and after review: **1,085 files unchanged**, including the session/QA/runtime foundations. Implementation ledger hash: `4ffbba8f63aed611a8da55b2ca6b2326f7dc49ccd2240a85b7fd0e7f74492aa6`.
- **80** focused maintained API/web tests passed.
- **108** guarded real PostgreSQL integration cases passed on a new labeled disposable Docker database; migration deploy and dump/restore passed; the container was removed.
- **7** maintained model journeys and **19** resource/viewer/consent/CSP cases passed in actual Vue/Chromium. The first resource run passed 17 and skipped the two production-CSP cases because their opt-in flag was absent; those two were subsequently run with the required flag and passed. No product changes were involved.
- **214 distinct maintained tests passed** in this review. Eight additional raw SDK/provider scenarios and one importer/render scenario characterized behavior and reproduced the findings; they are not acceptance tests proving the two contracts correct.
- The first scratch SDK probe failed to start because its scratch folder lacked ESM configuration. Adding a scratch-only `package.json` corrected the harness. Both logs are retained.
- Full `npm run verify` and production builds were **not rerun** in this review. Their previous successful logs were hash-verified, not represented as fresh runs.
- AI transport, UI API and viewer responses were synthetic. There were no paid provider calls, working-database migrations, deployment, public activation, new Docker Chrome/noVNC proof or R2 operating checks.
- Final cleanup evidence confirms no review-owned database container, test Node process or fixture listener remains.

Only scratch review files and these external review artifacts were added. Repair the two findings and review the fixes before proceeding to Phase 06B durable quotas/browser reservations.
