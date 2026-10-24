# Phase 3B — registration ordering and Unicode repair

Date: 2026-10-13. Addresses RR1/RR2 from the independent re-review of the first 3B fixes. Local implementation; independent re-review remains the next gate before stage 4. The earlier review ledgers and probes remain historical.

## Publication and claim ordering

The existing supervisor's configured project object now has one shared registration queue. Renewal enters the queue before saved-state discovery and holds it through validation, remote registration, project-binding confirmation and local cache replacement. `claimManagedExecution` uses the same queue through its registration and claim request. It reads its registration snapshot only after entering the queue.

Consequently a renewal committed remotely but still awaiting its response cannot be overwritten by a claim using the old local list. A renewal also waits for an in-flight registration/claim pair. Multiple renewals serialize discovery and publication; distinct project objects proceed independently. Rejection releases the queue and retains the last acknowledged registration. This is coordination within the single supervisor process; it adds no API/DB/wire contract or cross-process registration lock. Deploy one publisher for each configured registration identity under the existing single-host operating boundary.

The queue is released after claim returns, so browser preparation and test execution retain their existing lifecycle, expiry and Stop checks. No approval, Runner profile identity, target or saved-state revocation authority is rewritten.

## Unicode-safe bounded labels

Saved labels reserve the identity suffix within the 120-UTF-16-unit shared contract. The prefix is built from complete Unicode code points, counting each point's UTF-16 width before adding it. An emoji that crosses the remaining limit is omitted intact rather than split into a lone surrogate. Manifest hashes are computed from the final label. Manual profiles are unchanged.

A generated label whose old truncation was malformed has a new manifest hash. Any subsequent saved execution selects and approves the current profile; existing approvals are not rebound.

## Regression commands and scope

```text
node --test apps/browser-runtime/tests/project-registration.test.mjs apps/browser-runtime/tests/registration.test.mjs
npm run verify
```

Ten runtime regressions cover delayed acknowledgement, renewal behind registration/claim, two simultaneous renewals, failure releasing a queued manual claim, independent projects, and five Unicode boundary cases. The two registration wrappers also run ten service/client contract cases and one complete successful claim case through the real execution repository, using injected storage and authority fixtures. The latter recreates the review's delayed-publication ordering and proves the newly approved saved profile remains CLAIMED, without terminal failure or divergence between local and remote profiles.

The real-PostgreSQL fixture is separate because it requires an explicitly disposable target:

```text
node --import tsx --test apps/browser-runtime/tests/fixtures/registration-postgres.mts
```

It requires `ODDPATH_REGISTRATION_DB_TESTS=1` and `ODDPATH_REGISTRATION_DB_URL` pointing to a loopback port and database `oddpath_phase03b_registration_test`. The validation runner creates a unique PostgreSQL container with tmpfs, AutoRemove and a checked test label, then removes it in finally. Five cases send real client/service registrations into a temporary PostgreSQL JSONB table and reach claim. This proves Unicode persistence, not the full migrated application lifecycle.

The fixed supervisor image is separately tagged `oddpath/browser-supervisor:phase-03b-registration-fix`. Its source hashes are compared with the local tree, and the ten runtime regressions run inside it with read-only storage and no network. The focused real Chrome saved-state test uses this tag through `ODDPATH_SUPERVISOR_TEST_IMAGE`; existing image aliases remain available.

Final counts, image identities, source preservation and cleanup are recorded in `evidence/phase-03b/registration-fix.json`. No frontend/API/DB source or migration changes are included. The full PostgreSQL migration/lifecycle suite and full 23-case Docker suite are not rerun for these local registration fixes; prior results remain dated evidence. Working data, feature activation and publication are unchanged. Public activation remains NO-GO pending the launch gates.
