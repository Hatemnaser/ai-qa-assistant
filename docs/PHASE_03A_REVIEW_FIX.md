# Phase 03A — review fixes

Date: 2026-10-12. **Implemented and verified locally; independent re-review pending.** Public beta stays NO-GO. Saved login (3B) remains deferred until this slice is reviewed.

R3A-1 retains the exact approved ownership verification and checks it with fresh time after the runtime row lock and reload. Real PostgreSQL regressions wait on the actual row lock, expire the injected clock, then require rejection for BEGIN, LOGIN ticket issuance and Runner LOGIN acknowledgement. Existing approval/claim/lease/preparation checks remain authoritative.

R3A-2 makes owner Stop cancel queued/claimed/running managed jobs under the same project/session/request locks as claim, begin and accept. The existing QA cancel path and owner Stop call one shared cancelLockedExecution helper, preserving cancellation history, request/run versions, evidence and idempotency. Runtime records remain until real physical exit. The supervisor registers the reserved allocation with the API before creating Docker resources, so pending creation has a termination record and a cancelled job cannot register later. SQLite stays STARTING until browser service readiness; a bound API row is not physical readiness or Stop confirmation. Tests cover both real PostgreSQL lock orderings, queued cancellation without a runtime, one history event, and rejection/Stop/expiry before Docker start.

R3A-3 distinguishes child about:blank/about:srcdoc documents under an approved ancestor from forbidden top-level/local/data/unapproved navigation. Nested child frames remain permitted; handoff restricts their ancestors to the target. Real Chrome cases keep these frames alive in LOGIN and after READY, retain CDP/capture denial during LOGIN, and execute normal managed navigation/assertion after handoff. Top-level about:blank and chrome://settings still terminate before preparation expiry. No sign-in DOM/content is read by the policy.

## Validation

- Full verify: **1803/1803** (contract34, API1040, Runner33, web639, runtime57).
- Guarded disposable PostgreSQL: **90/90**, 26 migrations, no drift. The normal database was not used or migrated.
- Fresh real Docker suite: **19/19**, including noVNC password/MFA, capture pause, handoff, both iframe regressions, local-navigation denial, watchdogs and Stop cleanup.
- API/Runner/web production builds pass; explicit i18n **8/8**. Web build uses a process-only synthetic HTTPS API origin and keeps its existing nonblocking chunk-size warning.
- **59** source/compiled-module comparisons match the pinned images. Prior image digests and validation ledgers are retained; local phase-02/phase-03a tags reference the newly tested images.
- Runtime containers/networks, test controllers and disposable databases are removed; working PostgreSQL remains healthy. No new migration, deployment, commit/push, paid AI or production activation.

Exact source hashes, image IDs, sanitized browser results, log hashes and cleanup are in evidence/phase-03a/review-fix/validation.json. The earlier 3A implementation ledger and independent review evidence remain historical records. This is a focused repair of three review findings; the accumulated HEAD diff contains earlier owner work and is not an isolated repair patch.

## Review scope

Review apps/api/src/modules/browser-runtime/browser-runtime.repository.ts; apps/api/src/modules/qa-requests/qa-execution.repository.ts; apps/api/tests/qa-targets.postgres.integration.ts; apps/browser-runtime/src/login-policy.mjs, supervisor.mjs and supervisor-main.mjs; tests/login-policy.test.mjs, supervisor.test.mjs and docker.integration.mjs.

The existing session and QA controller remain in place. No live provider account or complete authenticated UI/API/Runner journey is certified; that broader operational journey remains a launch gate. Re-review these fixes before closing 3A or starting saved-login 3B.
