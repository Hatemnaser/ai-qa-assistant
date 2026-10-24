# Stage 3B — encrypted saved browser login

Date: 2026-10-13. Local implementation; verification and independent review gates are recorded in the final evidence ledger. Public activation remains NO-GO.

Follow-up: the independent review's R1–R3 are addressed in `PHASE_03B_REVIEW_FIX.md`
and `evidence/phase-03b/review-fix.json`. The counts below describe the original
implementation; use the repair ledger for subsequent checks. Independent re-review remains pending.

Latest follow-up: RR1/RR2 registration ordering and Unicode truncation are repaired
in `PHASE_03B_REGISTRATION_FIX.md`; current checks are in
`evidence/phase-03b/registration-fix.json`. Independent re-review remains pending.

Subsequent follow-up: the committed-registration timeout is repaired locally in
`PHASE_03B_REGISTRATION_TIMEOUT_FIX.md`; latest checks are in
`evidence/phase-03b/registration-timeout-fix.json`. Re-review remains the next gate.

## Behavior and authority

The owner opts in during the existing manual login controls. After physical input handoff, a privileged runtime operation captures supported cookies/localStorage, filtered to approved target/authentication scope. Filled sign-in DOM is cleared before this operation. No state is placed in chat, project documents, models, evidence, browser localStorage or account/project exports.

The API accepts an authenticated encrypted transfer only for the exact project connection, approved claim/runtime/binding/epoch and live consent. It seals state at rest with AES-256-GCM and a random IV under independently versioned keys outside PostgreSQL. Each immutable UUID/revision 1 identity expires no later than seven days from consent; save retries do not change that date. The existing owner profile approval explicitly chooses that identity before a subsequent run. Supervisor registration discovers compatible saved identities for configured manual targets; stale/changed/missing authority is refused again at dispatch, restore, acceptance and renewal.

The runtime starts with CDP/input unavailable for saved preparation. State is restored in its fresh tmpfs context using Playwright setStorageState, target navigation is revalidated, and READY is acknowledged before execution. No silent manual fallback or refresh extends stored authority. The job/runtime deadline is capped by saved-state expiry, and restarted recipes never resume.

Owners can list/revoke records in the existing session Results view. Revocation cancels reserved/active uses through the current QA lifecycle and requests physical Stop; requested and confirmed remain distinct. Expiry cleanup runs in the existing API reaper, clears ciphertext and records SYSTEM actions. Logout invalidates the Oddpath session even if browser/vault cleanup fails. Account/project deletion holds lifecycle locks, waits for actual exit, and persists permanent external scope tombstones before the relational graph can disappear.

## Persistence and deployment boundary

Migration 20261013000100 is additive (27 total) and is rehearsed only on disposable PostgreSQL. Default QA_SAVED_LOGIN_ENABLED is false, requires the manual/runtime gates and independent keyring/revocation paths, and cannot bypass the existing production-v2 activation prohibition. Working application data/settings are not migrated or enabled.

The signed SQLite issuance/revocation journal is separate from database snapshots. Missing issuance, tampering, unknown keys, expired binding or deleted scope denies restoration. AES storage and transfer key versions are separate; the tenant container receives neither keyring. The supervisor receives only the transfer ring, and sends plaintext state only over the existing private, token-authenticated runtime channel.

This implementation requires a durable local filesystem shared by the API and its API reaper on one host. Independent journals on load-balanced hosts are not a certified deployment. Preserve the newest journal across PostgreSQL restore; restoring an old journal together with an old database defeats any local rollback detector. If latest journal continuity cannot be established, keep dispatch disabled, invalidate old storage keys and require fresh login. A lost journal fails closed for existing records. Actual host backup/restore, key rotation/recovery, monitoring and budget proofs remain launch gates; see BROWSER_VAULT_OPERATIONS.md.

## Supported state and limits

Cookies and localStorage only, up to 256 KiB total, 300 cookies, 21 authentication origins and 250 localStorage entries/origin; names/values have separate limits. Cookie flags are preserved, including legitimate parent-domain cookies applicable to approved HTTPS hosts. Network authority remains the exact reviewed origins under the existing egress enforcement. IndexedDB, sessionStorage, passkey/profile files and arbitrary state import/export are unsupported. At most 20 unexpired records/account are accepted. Expired ciphertext is cleared by the bounded reaper; its operation must be monitored before launch.

## Verification and next gate

The final ledger is `evidence/phase-03b/validation.json`. Fresh local results:

- `npm run verify`: 1,835 tests, 1,834 passed, zero failures and one Windows skip. Contract 38, API 1,045 passed/one skipped, Runner 33, web 642, runtime 76. Types, architecture and syntax checks pass.
- Disposable PostgreSQL: 96/96, all 27 migrations applied and zero drift. Consent/idempotence, restore/revocation, changed bindings, seven-day expiry, actual lock-wait expiry, permanent deletion tombstones and expired ciphertext cleanup are covered.
- Full real Docker suite: 23/23, including fresh-browser saved cookies/Unicode localStorage, noVNC normal/delayed readiness, isolation, human handoff, renderer failure, lease/deadline, Stop and pending-creation/EOF races.
- Live journal replacement: the actual compiled vault passed on Linux. Windows disallows renaming this open SQLite file, so that platform-specific unit case is explicitly skipped rather than reported as passed.
- Actual Vue components/styles: six browser fixtures covering EN/DE/AR at 1,280/390 pixels, keyboard opt-in, saved notice, revoke, scope clearing and overflow. Separate i18n suite 8/8; API/Runner/web production builds pass with a synthetic HTTPS API origin. The existing large-chunk build warning remains non-blocking.

Image/source consistency and final fixture cleanup are included in the ledger. Synthetic fixtures do not certify a third-party SSO account or a deployed unassisted UI/API/Runner journey. Intermediate failed attempts and their corrections remain separate from these final passing logs.

Independent review of 3B is next. Resources/tabs, evidence/export, model/public quotas/auth, release readiness and operational launch remain stages 4–8. Android/Firebase/iOS are deferred. No deployment, publication, paid-provider experiment or commit/push is included.
