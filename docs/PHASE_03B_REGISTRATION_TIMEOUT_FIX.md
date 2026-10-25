# Phase 3B — reconcile unacknowledged registration publication

Date: 2026-10-13. Repairs the latest independent registration review's R3. This is local work; independent review remains the gate before stage 4. Earlier ledgers and counterexamples remain historical.

## Behavior

A registration response can time out after the API has committed its profiles. Keeping only the previous acknowledged cache allowed the next claim to republish that older list and fail a newly approved saved-profile job with `QA_PROFILE_MANIFEST_CHANGED`.

The configured project now retains the exact candidate before sending publication. Renewal and claim use one publication helper under the existing shared queue. Only a successful receipt bound to the configured project replaces the confirmed `project.registration` and clears the unconfirmed candidate. A subsequent claim republishes that candidate, confirms it and then requests claim. A subsequent renewal confirms it before discovering or publishing a newer list.

Repeated rejection or a project-binding mismatch leaves the confirmed cache intact and retains the candidate. No claim request is sent until registration is acknowledged with the correct project. A generic rejection is treated conservatively because the HTTP client may already have committed an earlier retry. Discovery or local schema validation failure before publication still leaves no unconfirmed candidate and permits the previous manual registration to be claimed. The queue is released on failure, so other projects and subsequent recovery attempts remain available.

This preserves the existing claim, approval, target, saved-state revocation, lease, Stop and preparation authority. It changes no API contract, database source, schema, migration or frontend flow. The unconfirmed candidate is process-local, tied to the existing configured project object; it introduces neither a cross-process publication protocol nor restart persistence. Existing single-publisher operating boundaries remain applicable. It does not resume interrupted browser executions.

## Regression checks

```text
node --test apps/browser-runtime/tests/project-registration.test.mjs apps/browser-runtime/tests/registration.test.mjs
node --import tsx --test --test-timeout=20000 apps/browser-runtime/tests/fixtures/registration-timeout.mts
npm run verify
```

The direct runtime tests cover repeated failure through claim and renewal, no additional discovery while reconciliation fails, eventual recovery, and reconciliation before a newer renewal. Existing successful-delay, queue ordering, independent-project and Unicode tests remain.

The new HTTP fixture uses default fetch over a temporary loopback server and the real helpers/client/registration service/claim repository, with injected storage and valid authority rows. Four attempts commit the saved-profile list while their responses time out; the subsequent claim must acknowledge that same list and return the approved saved task as CLAIMED. A second case drops eight responses, proves that the failed claim leaves the job QUEUED with no terminal update, then proves successful recovery. These are transport and service/repository integration tests, not the full migrated PostgreSQL lifecycle.

All three registration wrappers now remove inherited `NODE_TEST_CONTEXT`, use explicit TAP output and require the expected test/pass counts (10, 1 and 2). An initial verification attempt exposed that a nested runner could exit zero without executing its fixture; the repaired wrappers reject that outcome. Earlier outer-wrapper counts alone do not establish that their nested cases ran. The final logs below are fresh checks of all three actual fixtures.

The prior five real-PostgreSQL Unicode cases are rerun in a separately guarded disposable tmpfs database. The supervisor image is separately tagged `oddpath/browser-supervisor:phase-03b-registration-timeout-fix`; its source hashes and runtime regressions are checked. The focused Chrome capture/restore/Stop test uses that image. Earlier image aliases remain available.

Final check counts, source preservation, image identities and cleanup are recorded in `evidence/phase-03b/registration-timeout-fix.json`. The complete 23-case Docker and migrated-PostgreSQL lifecycle suites are not rerun for this local publication repair. Their earlier results remain dated evidence. No feature activation, working-database change, deployment, paid API call, commit or push is included. Public activation remains NO-GO pending the existing launch gates.
