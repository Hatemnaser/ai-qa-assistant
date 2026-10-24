# Stage 3A — manual login and bounded handoff

Date: 2026-10-12; local closeout accepted 2026-10-13 in PHASE_03A_CLOSEOUT.md. The owner
selected manual login/MFA first, then encrypted saved login after review. Stage
2 is closed locally in `PHASE_02_CLOSEOUT.md`. Public beta remains **NO-GO**.

## Implemented scope

MANUAL is an immutable, secret-free authentication identity. The API grants
only owner/CSRF input requests tied to the exact project/request/approval,
target revision/proof, claim, lease, preparation deadline and control epoch.
The Runner acknowledges the requested physical mode; it cannot grant itself
human input or accept before READY. Target-lock expiry and owner Stop races
are fenced with fresh checks. Ordinary execution/evidence remains unavailable
while the job is CLAIMED.

The container blocks ordinary CDP/capture through preparation/login/handoff.
Its private policy client enforces navigation/download boundaries without
reading login content. noVNC provides human keyboard/mouse input only in LOGIN.
x11vnc mode change plus query is synchronous: a successful submitted X11
command alone is insufficient. Handoff closes human connections, disables
physical input and clears filled login/MFA DOM by reloading the target before
CDP can reopen. Login remains in the fresh tmpfs browser profile only.

Preparation is bounded to five minutes, execution to ten and allocation to
fifteen. Execution starts its own immutable clock; lease renewal/start retries
do not extend it. Started recipes and human input cannot resume after restart
or lease loss. Existing physical Stop/reaper/no-replay semantics are preserved.
Logout requests owner Stop; account/project deletion waits for confirmation
and retains the runtime record until then.

The localized control component lives in the existing SessionPage and emits
Stop to the existing QA controller. Account/project/execution/navigation guards
discard delayed status/tickets. No tickets are stored in chat, localStorage,
exports or models. The v2 approval reader preserves target/auth/limits instead
of rebuilding an incomplete v1 manifest.

## Files to review

- Shared `target.ts`, `v2.ts`, `runtime.ts`: MANUAL identity, approval time and grants/acknowledgements.
- API browser-runtime module, QA execution/Runner compatibility, feature flags;
  auth logout, account/project service/deletion guards; additive migration
  `20261012000100_add_manual_browser_login` and Prisma runtime fields.
- Runtime `login-boundary.mjs`, `login-policy.mjs`, `human-preparation.mjs`,
  supervisor/main, journal, gateway/grants, Dockerfile and config.
- Runner execution/client; SessionPage, BrowserLoginControls/browserLoginApi,
  QA manifest reader/types, EN/DE/AR catalogs and workspace dependency binding.
- Contract/Runner/API/real-PG/frontend/runtime/Docker regressions. Source hashes,
  image IDs and final counts are in `evidence/phase-03a/validation.json`.

The checkout includes pre-existing stage-0/1/2 changes. This checkpoint's source
snapshot does not turn the accumulated HEAD diff into an isolated 3A patch;
preserve the earlier review ledgers and owner work.

## Validation and review gate

Original implementation handoff validation: **1796/1796** repository tests, **86/86** real
PostgreSQL tests (26 migrations, zero drift), **17/17** real Docker cases,
**8/8** explicit i18n checks and **3/3** real-component browser UI cases.
API/Runner/web production builds pass; the web build uses a synthetic exact
HTTPS API origin and retains its nonblocking bundle-size warning. **59**
source/compiled-module comparisons match the pinned images. Final fixture
cleanup is recorded in the ledger; working PostgreSQL remains healthy.

Use the final sanitized ledger for complete results, not intermediate failed
fixture runs. Required checks include full verify, production builds/i18n,
fresh guarded PostgreSQL migration/drift/lifecycle, all real Docker cases,
source/image consistency and fixture cleanup.

The maintained human-input test delivers synthetic password/MFA via the real
noVNC framebuffer, checks CDP/VIEW/wrong-epoch denial, then proves cookies survive
only in the current attempt while filled DOM/input/socket are revoked before
execution. It clicks known fixture pixels rather than estimating Chrome's
toolbar offsets. No real credentials/sign-in screenshots are recorded.
Additional real-browser checks exercise approved SSO-origin navigation,
resource-origin rejection, browser-local termination and a separate execution
deadline. URL metadata probes are privileged, credential-free fixtures.

Frontend scope-guard tests use the actual compiled SFC; a disposable Vite/browser
fixture checks the unmodified component, production locales/styles, keyboard,
EN/DE desktop and AR mobile RTL, handoff/link clearing and emitted Stop. Its API
is synthetic. It is **not** a full authenticated end-to-end UI/API/Runner journey
with a third-party account. That broader operational journey remains a launch
gate; no working QA approval was used as a test fixture.

Independent review should reproduce owner/CSRF/Runner/epoch boundaries, capture
pause, delayed acknowledgements/heartbeat/Stop, exact navigation and time limits,
no-replay, actual input/view-only handoff, deletion proof and current-session
scope guards. Do not enable working/production flags merely to perform review.

## Deferred and activation boundary

Historical 3A boundary (superseded by the authorized 3B implementation): optional encrypted storageState, explicit consent,
independently versioned AES-256-GCM keys, seven-day maximum, revocation/deletion
of active use and restore tombstones all remain mandatory. SAVED_STATE is
rejected. Real provider-specific SSO/MFA accounts are not certified by the
synthetic origin/input fixture; unsupported redirects need new reviewed origins.

Product resource tabs and full browser viewer integration remain stage 4;
evidence/export, public routing/quotas/model choices, readiness GO/NO-GO and
operational hosting/restore/budget proofs remain stages 5-8. Android APK/Firebase
and iOS remain deferred. Closing/hiding a view is not physical Stop.

`QA_MANUAL_LOGIN_ENABLED` and runtime/v2 flags stay disabled by default. Only
the disposable database received the new migration; working application data,
secrets and activation settings remain unchanged. No deployment, commit/push,
paid AI or hosting change was performed. Drain/confirm allocations before flag
disable/schema downgrade. Review 3A before authorizing the saved-login slice.

## Review fixes (2026-10-12)

The three independent-review findings are repaired and verified locally.
First repair handoff validation was 1803 repository tests, 90 PostgreSQL tests and
19 real Docker cases; API/Runner/web builds, 8 i18n checks and 59 image/source
comparisons pass. Owner Stop now cancels pending managed jobs through the
existing QA cancel helper; API allocation registration precedes Docker creation.
The exact proof is checked after all locks, and approved blank/srcdoc child
frames survive while top-level local navigation remains blocked.
See `PHASE_03A_REVIEW_FIX.md` and `evidence/phase-03a/review-fix/validation.json`.
Independent re-review is pending; this does not close 3A or authorize 3B.


## Pending-creation Stop repair (2026-10-12)

The subsequent independent re-review found premature Stop confirmation during physical creation. The repair now retains a durable creator fence, refuses LIVE promotion after Stop/expiry, and requires settlement plus fresh cleanup before confirmation. Full verify 1809, disposable PostgreSQL 90 and complete real Docker 21 pass; the combined real-API reproduction verifies the corrected ordering. See PHASE_03A_CREATION_STOP_FIX.md and evidence/phase-03a/creation-stop-fix/validation.json for proof, retained ambiguous-operation recovery limits and deployment drain requirements. Independent re-review remains pending; 3A is not closed and 3B/public beta are not authorized.


## Docker EOF settlement repair (2026-10-12)

The follow-up P1 is repaired: every failed mutating Docker CLI command retains its creator fence, including code=1/plain EOF. Full verify 1818, disposable PostgreSQL 90, combined Stop regressions 2 and clean full Docker 22 pass; 59 image comparisons match. See PHASE_03A_DOCKER_EOF_FIX.md and evidence/phase-03a/docker-eof-fix/validation.json, including the initial Docker timeout/rerun and conservative operator-recovery limit. Independent re-review remains pending; this does not close 3A or authorize 3B/public beta.
