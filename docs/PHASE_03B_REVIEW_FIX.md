# Phase 3B — selected review repairs

Date: 2026-10-13. Repairs to R1–R3 from the independent 3B review. The existing session, QA controller and backend consent/approval lifecycle are retained. Independent re-review is the next gate; public activation remains NO-GO.

Subsequent RR1/RR2 repairs are in `PHASE_03B_REGISTRATION_FIX.md` and
`evidence/phase-03b/registration-fix.json`. Counts and image tags below refer to
this first repair, not the subsequent registration follow-up.

## R1 — consent withdrawal must settle before completion

`BrowserLoginControls.vue` restores the native checkbox immediately to the last confirmed server choice. A separate pending choice blocks both the Complete button and its handler. A failed or ambiguous POST keeps this block across status polls, including when the write succeeded but its response was lost. The owner can retry the same choice or stop the attempt. Only an acknowledged response for this execution and control epoch, with the requested consent value, resolves it. Scope changes discard pending operations and stale responses.

Polling may show a newer confirmed value, but cannot silently cancel the owner's unresolved request. No optimistic checkbox state or generic refresh is interpreted as permission to save.

## R2 — bounded saved profiles and last usable registration

`project-registration.mjs` derives a stable 64-character key from the full base profile key and saved identity, rather than concatenating or truncating an ambiguous base prefix. Generated labels reserve their suffix within the 120-character contract. The existing target matching, revocation/expiry filtering and 20-profile cap remain in place.

The whole candidate is parsed using the shared v2 registration schema. The supervisor replaces its cached registration only after registration succeeds with the expected project binding. Validation, transport or project-binding failure leaves the previous registration available for claims, including manual runs. Generated manifest hashes cover the final bounded fields.

Generated saved profile keys and hashes change from the earlier local 3B implementation. Existing approvals are not rewritten or rebound. A subsequent saved run must select and approve the current generated profile. Manual profile keys and hashes are unchanged.

## R3 — copy follows confirmed consent

EN/DE/AR distinguish temporary manual login, confirmed opt-in, unresolved preference, saved-state restoration and completed preparation. Confirmed opt-in explains that Oddpath will try to save the login for later approved tests for up to seven days; it does not promise persistence before capture succeeds. LOGIN and FINISH_REQUESTED no longer show a temporary-login guarantee when consent is true.

## Reproduction and verification

Run from the repository root with Node 24 and installed workspace dependencies:

```text
node --import tsx --test apps/web/tests/browserLoginControls.test.ts apps/browser-runtime/tests/fixtures/registration-contract.mts
node --test apps/web/tests/browserLoginControls.browser.mjs
npm run verify
npm run test:i18n
npm run build:web
```

The separate browser regression requires installed Playwright Chromium. It starts a temporary loopback Vite server with the actual component, production CSS and locale catalogs, and a synthetic API. Fifteen cases cover EN/DE/AR at desktop/mobile widths, native keyboard interaction, rejected and ambiguously applied withdrawal, two subsequent polls, guarded completion, acknowledged retry, finish/READY/restoration copy and no horizontal overflow. Seven component tests also cover scope and stale-response boundaries. Eight registration fixture cases use the real service/client for success and project binding, plus injected failures for last-good-cache checks. The runtime suite invokes this fixture as one outer test.

The focused real Docker saved-state test uses `ODDPATH_BROWSER_DOCKER_TESTS=1` and `ODDPATH_SUPERVISOR_TEST_IMAGE=oddpath/browser-supervisor:phase-03b-review-fix` with the existing `captures consent-bound` test-name filter. This optional image override preserves the default test tag and avoids changing existing aliases. The new supervisor image is separately tagged; image/source hashes are checked.

Final counts, image identities, source hashes and cleanup are recorded in `evidence/phase-03b/review-fix.json`. The old implementation/review evidence remains historical and unchanged. This repair does not change API/DB source, schema, migrations, gates or vault/runtime authority; disposable PostgreSQL and the full 23-case Docker suite are not rerun for this patch. Their previous dated results do not represent new checks. The focused Docker check and separate UI/service fixtures do not certify a deployed third-party sign-in journey.
