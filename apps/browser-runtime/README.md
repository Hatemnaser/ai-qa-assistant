# Oddpath managed browser foundation

2026-10-18 status: stages 3B/4/5/06/07 now have their bounded local closeouts.
Read [Phase 08A inventory](../../docs/PHASE_08A_READINESS_INVENTORY.md) before
deployment work. The dated stage-2/3A descriptions below are history; later
saved-state support is described at the end of this file and in the vault
runbook. Production v2/assets enablement is still rejected. The 2026-10-20
opt-in managed discovery adapter below removes the static project list for
verified owners/targets; its local implementation awaits independent review.
Local queue/quota acceptance does not close the HTTPS proxy, host, durability
and recovery rehearsals.

Stages 2 and 3A provide reusable runtime infrastructure and ephemeral manual
login. Both are disabled by default and do not authorize deployment/public beta.
Read `docs/PHASE_02_CLOSEOUT.md` and `docs/PHASE_03A_CHECKPOINT.md`.
The existing session, QA controller, approval services and recipe interpreter
remain the product boundary.

## Runtime and trust boundaries

- Linux **amd64** is required for the official Chrome Stable package. The
  browser image contains Chrome, Xvfb, x11vnc, noVNC/websockify and a bounded
  lifecycle process. It runs as UID/GID 10001 with a read-only root, dropped
  capabilities, namespace/seccomp sandbox, memory/CPU/PID limits and fresh
  profile/tmpfs. Browser/egress have no host bind mounts, application secrets,
  database/API credentials or published host ports. Raw CDP/VNC bind loopback.
- A separate, trusted supervisor/reaper has the Docker socket and scoped
  operator-configured project Runner connections. This is an administrative
  host boundary, not a tenant browser privilege. Its durable SQLite journal
  allows one active allocation and one start per execution across restarts.
  Recovery kills retained attempts; it does not resume recipes.
- Each browser has its own internal bridge with **isolated gateway mode**;
  there is no host address on that bridge. Docker Engine 28+ is required and
  checked before allocation. Only its egress proxy has an
  external route. The proxy accepts exact approved HTTPS CONNECT hostnames on
  port 443, validates every DNS address, rejects private/reserved/metadata/mixed
  answers, and connects to a pinned public IPv4 literal. Public dual-stack DNS
  works; IPv6-only transport currently fails closed. Redirects and new origins
  still require the exact target/dependency policy. Top-level automation stays
  on the target origin; downloads and popups are denied.
- The runtime watchdog checks its lease and immutable deadline every 200 ms;
  renewal also checks the existing lease/closing state synchronously. Expired
  authority cannot be revived between watchdog ticks or across supervisor awaits.
  Child failure terminates the allocation. The separate runtime reaper checks
  every two seconds, kills unknown containers/networks and retries exit reports.
  The separate API reaper terminalizes interrupted v2 jobs and requests Stop.
  Docker inspection failure is never confirmed Stop. Requests become unconfirmed
  after fifteen seconds without an exit observation.
- The ordinary standalone noVNC gateway is view-only. The owner's sixty-second signed
  fragment ticket is exchanged once for an HttpOnly/Secure/SameSite=Strict
  runtime-path cookie. Both HTTP assets and WebSocket upgrades recheck exact
  project/execution/runtime/binding and live lease; streams close on Stop/expiry.
  CSP permits same-origin/data images for noVNC framebuffer decoding while
  retaining the existing nonce-based script/style and same-origin connections.
  No CDP route reaches the viewer. MANUAL login separately requires a LOGIN
  grant and current input epoch. Product resource tabs remain stage 4; stage 3A
  has localized login controls within the existing SessionPage/QA controller.
- Allocation waits for Chrome's authenticated CDP version, the noVNC `rfb.js`
  module and a WebSocket carrying the actual x11vnc RFB greeting before the
  driver returns and the supervisor marks the attempt LIVE. Probes run from
  the trusted supervisor on the private network and send no browser input.
  The readiness deadline is the earliest of fifteen seconds, the existing
  lease and the immutable execution deadline. Expiry is checked after awaits;
  unsuccessful startup uses the existing physical Stop path. See
  `docs/PHASE_02_VIEWER_STARTUP_FIX.md` for the controlled startup regression.

## Build and configuration

From the repository root: `npm --prefix apps/browser-runtime run build:images`.
The supervisor image builds the existing Runner/shared contract and installs
the official Docker CLI using its signed repository. The browser image installs
Chrome Stable from Google's signed repository. Freeze built image digests for
an approved release; changing a tag never changes an allocation's pinned ID.

Operator configuration is a secret file, not a tracked `.env` or browser mount.
`deploy/browser-runtime.compose.yml` contains the supervisor/reaper topology;
it intentionally supplies no public proxy, database or production activation.
Only a configured HTTPS reverse proxy may expose the viewer's port 8081.

The config contains `instanceId`, `supervisorContainer` (matching the actual
supervisor container name), `chromeImage`/`egressImage` (`sha256:<64 hex>`),
`publicOrigin` (exact HTTPS), optional booleans `allowProduction`/`allowManualLogin`, and `projects`.
Each project has its exact `projectId`, HTTPS API `serverUrl`, scoped Runner
`token`, and a strict v2 `registration` with explicit protocol `[2]`, immutable
target/profile manifests, executor `playwright`, `authentication: {kind: "NONE"}` (or explicitly enabled MANUAL),
no value references and reviewed limits. Profile hashes are derived/checked on
load. Supply actual owner-reviewed target revision snapshots from the API;
the worker cannot prove/approve its own targets or recipes.

Provide `ODDPATH_SUPERVISOR_CONFIG_FILE` and `ODDPATH_VIEWER_KEY_FILE` to compose.
The dedicated viewer key is 32 random bytes encoded as 64 lowercase hex;
the API's `QA_BROWSER_VIEWER_SIGNING_KEY` must match. It must not be an existing
CSRF/auth key. The API also requires exact `QA_BROWSER_VIEWER_ORIGIN`,
`QA_BROWSER_RUNTIME_ENABLED`, and v2 enablement in an isolated controlled
environment. Production startup deliberately rejects enablement until later
launch gates are implemented/reviewed. Do not use test NODE_ENV to bypass this.

The legacy project/profile catalog is operator-provisioned (maximum 20 projects).
The optional discovery mode below uses the existing durable queue/account
reservations. Current global capacity is one per durable
journal/host, not a distributed capacity guarantee. A second independent
journal/host is outside this stage's topology and requires coordinated quotas.

### 2026-10-20 — optional managed project discovery (local implementation)

Instead of `projects`, configure `discovery: { serverUrl: "https://<exact-api-origin>",
keyFile: "/run/secrets/managed_routing_key" }`. The supervisor and independent
reaper receive the dedicated routing key; only the API receives the separate
`QA_MANAGED_PROJECT_KEY`. Set `QA_MANAGED_HOST_ID` to one stable host identity.
All routing/runtime flags default off; the existing production v2 block remains.
Never use test NODE_ENV as production activation.

Only verified owners and current, owner-authorized, unexpired target proofs enter
the bounded catalog. Each project gets one persistent, revocable connection;
each target gets its own registration under that connection. Registration IDs
remain within contract limits even for long target IDs. No owner/session cookies
or project key reach Chrome. A new project needs no operator token/config edit.
The catalog registers capabilities, never approval or permission to execute.
The existing immutable recipe approval, reservations, claim/lease, target checks
and physical Stop remain authoritative.

Snapshots scan at most fifty 20-target pages (at most 1000 admitted target
entries) with a 60-second maximum cache life. Later targets await capacity;
overflow does not invalidate the admitted prefix. This is a bounded single-host
beta limit, not unlimited public-host capacity. Discovery refreshes/registers every ten seconds;
queue hints prevent idle per-project claim polling. Transport/schema/cursor failure during discovery
stops new claims. Registration/claim share stable per-target queues and retain
the prior ambiguous-publication acknowledgement behavior. The authenticated host
has a separate bounded 12000-request/window integration budget; ordinary public
IP/token limits remain. That header is sent only to the exact API v2 Runner path,
never object-storage uploads. The project bearer and all scopes are still checked.

The machine adapter exposes catalog and status/Stop/exit only. The reaper can
report actual physical exit after a project token is revoked; this does not
permit claim, Accept, results, human input or evidence writes through the host
key. Revocation cancels pending project work and requests Stop. An allocated
reservation stays held until actual exit is confirmed. Account deletion still
waits for Stop and removes its bindings. Historical/manual connections retain
their existing protocol and nullable routing metadata.

Revoked bindings are deliberately never auto-created/revived. Routing/project
key changes fail closed. Disabling routing stops dispatch; authenticated
status/Stop/exit remain available while the runtime and host key remain configured.
Drain/confirm current work before disabling the runtime or removing/changing keys.
Owner-driven reconnect/rekey UX is not supplied
by this slice and remains a launch follow-up; do not repair this by clearing a
revocation or rewriting token hashes manually. Public target onboarding UX,
deployed HTTPS, native ARM/capacity and complete host/vault/proxy topology still
require their Phase 08 gates. This feature is not public-release authorization.

Docker acceptance must use a freshly built supervisor image from this source.
The maintained harness now checks every supervisor source file before allocation
and rejects stale cached images; select an independently named current build
with `ODDPATH_SUPERVISOR_TEST_IMAGE`. Historical `:phase-02` tags are not proof
that their contents include later viewer/registration repairs.

## Manual preparation (stage 3A)

API `QA_MANUAL_LOGIN_ENABLED=false` and supervisor `allowManualLogin` must
both be explicitly enabled in an isolated controlled environment. Production v2
enablement remains rejected. No credential/state is sent in registration or
login API payloads. MANUAL is part of the immutable owner-approved profile and
authorization hash. SAVED_STATE/value references remain unsupported.

The job stays CLAIMED throughout preparation, so Runner result/evidence writes
are rejected. The API uses WAITING -> ENTER_REQUESTED -> LOGIN ->
FINISH_REQUESTED -> READY; only the owner can request input or handoff, and the
scoped Runner can only acknowledge the requested transition. API target/proof,
request, owner, approval, lease, epoch and preparation time are rechecked after
locks. Owner Stop races serialize on the runtime row. Registration binds the
same exact preparation deadline as the physical container.

The container's PREPARING/LOGIN/HANDOFF states reject capture/ordinary CDP and
ordinary viewer input. Only the readiness version metadata is allowed while
PREPARING. The in-container Playwright policy client reads navigation metadata,
enforces exact target/authentication origins and denies downloads; it does not
read sign-in DOM/storage/body or produce screenshots. Browser-local/data URL
navigation is also fenced. Resource origins are never login destinations.
Prepared-login pages may include an approved authentication-origin popup.

The owner types credentials/MFA directly into the remote Chrome through noVNC.
The VNC server acknowledges physical input mode before any successful mode
transition. Handoff revokes human streams/input, closes extra pages and reloads
the target while capture remains blocked. Only then does ordinary CDP reopen;
cookies remain in that attempt's tmpfs profile. Entering human mode again after
handoff is forbidden; a new run/approval is required. No storageState or vault
is exported/saved, and restarting a supervisor stops rather than resumes it.

Preparation is at most five minutes, execution at most ten, total at most
fifteen. A separate execution clock starts at handoff to the executor and cannot
be extended by retries or lease renewal. Expiry, Stop, crash and lost authority
use physical cleanup, never a fabricated Stop receipt. Logout requests Stop;
account/project deletion waits for physical confirmation and rechecks inside
the deletion transaction. Drain and confirm every allocation before disabling
the runtime flag or downgrading its schema.

Encrypted saved login, seven-day/key/restore-tombstone lifecycle and broad real
third-party SSO/MFA compatibility testing are separate 3B/launch gates. Mobile
resource-viewer/control integration is still stage 4. The 3A test fixture uses
synthetic credentials only and proves the boundaries without a live account.

## Manual preparation (stage 3A)

API `QA_MANUAL_LOGIN_ENABLED=false` and supervisor `allowManualLogin` must
both be explicitly enabled in an isolated controlled environment. Production v2
enablement remains rejected. No credential/state is sent in registration or
login API payloads. MANUAL is part of the immutable owner-approved profile and
authorization hash. SAVED_STATE/value references remain unsupported.

The job stays CLAIMED throughout preparation, so Runner result/evidence writes
are rejected. The API uses WAITING -> ENTER_REQUESTED -> LOGIN ->
FINISH_REQUESTED -> READY; only the owner can request input or handoff, and the
scoped Runner can only acknowledge the requested transition. API target/proof,
request, owner, approval, lease, epoch and preparation time are rechecked after
locks. Owner Stop races serialize on the runtime row. Registration binds the
same exact preparation deadline as the physical container.

The container's PREPARING/LOGIN/HANDOFF states reject capture/ordinary CDP and
ordinary viewer input. Only the readiness version metadata is allowed while
PREPARING. The in-container Playwright policy client reads navigation metadata,
enforces exact target/authentication origins and denies downloads; it does not
read sign-in DOM/storage/body or produce screenshots. Browser-local/data URL
navigation is also fenced. Resource origins are never login destinations.
Prepared-login pages may include an approved authentication-origin popup.

The owner types credentials/MFA directly into the remote Chrome through noVNC.
The VNC server acknowledges physical input mode before any successful mode
transition. Handoff revokes human streams/input, closes extra pages and reloads
the target while capture remains blocked. Only then does ordinary CDP reopen;
cookies remain in that attempt's tmpfs profile. Entering human mode again after
handoff is forbidden; a new run/approval is required. No storageState or vault
is exported/saved, and restarting a supervisor stops rather than resumes it.

Preparation is at most five minutes, execution at most ten, total at most
fifteen. A separate execution clock starts at handoff to the executor and cannot
be extended by retries or lease renewal. Expiry, Stop, crash and lost authority
use physical cleanup, never a fabricated Stop receipt. Logout requests Stop;
account/project deletion waits for physical confirmation and rechecks inside
the deletion transaction. Drain and confirm every allocation before disabling
the runtime flag or downgrading its schema.

Encrypted saved login, seven-day/key/restore-tombstone lifecycle and broad real
third-party SSO/MFA compatibility testing are separate 3B/launch gates. Mobile
resource-viewer/control integration is still stage 4. The 3A test fixture uses
synthetic credentials only and proves the boundaries without a live account.

## Protocol transition and operators

1. Turn off new legacy dispatch on **every API instance** with
   `QA_LEGACY_RUNNER_DISPATCH_ENABLED=false`; keep v2 disabled. Allow existing
   runs to complete or cancel them through the existing owner QA service.
2. Run `npm --prefix apps/api run browser:transition` after API build. With no
   flags it reads counts only; it does not rewrite approvals or start work.
3. After active runs are drained, the explicitly requested operator option
   `--invalidate-queued-legacy` retires at most twenty queued legacy jobs per
   transaction. Repeat while queuedLegacy is nonzero. It preserves historical
   approvals, recipes, runs and events and records renewal-required failure.
   Both dispatch modes must remain disabled during this operation. No such
   operation was performed on the working database during implementation.
4. Managed start/claim fail closed while pending legacy jobs exist. Configure
   controlled v2/runtime gates, start the separately supervised API reaper,
   runtime supervisor and runtime reaper, and review new exact owner approvals.
   This is a test/transition recipe, not public activation authorization.

Operational Stop uses Docker kill/wait/fresh inspection of Chrome and egress,
then owned network removal. Reaper/shutdown races are retried safely; no missed
daemon is converted to proof. Monitor both reapers/daemon/journal and kill
allocations if a reaper cannot operate. Backup/restore, quotas, capacity/budget,
public HTTPS proxy, login/vault, deletion/revocation, evidence retention/export
and product first-user journeys remain launch blockers, not implicit claims.

## Verification

`npm run verify` includes runtime syntax/unit tests, strict owner tickets,
gateway HTTP/WebSocket Stop, durable single-start/restart, resource configuration
and DNS rebinding policy. Guarded disposable PostgreSQL integration verifies
runtime binding/owner isolation, requested vs confirmed Stop, no v2 reclaim,
protocol drain and additive migration/physical-exit constraints.

Set `ODDPATH_BROWSER_DOCKER_TESTS=1` explicitly before
`npm run test:browser-runtime:docker`. Requires Docker Desktop Linux or a Linux
amd64 Docker host, the three built images, Node 24 and an installed Playwright
Chromium viewer (`npx playwright install chromium` on an isolated test machine).
The suite uses unique labels and temporary synthetic allocations; a trusted
test controller alone gets Docker socket access and a loopback-only temporary
viewer mapping. No tenant CDP/VNC port is published. Fixtures are removed by
verified identities. Explicit watchdog tests omit all lease renewals.
The suite also derives a disposable image from the pinned Chrome image that
delays websockify by eight seconds. Both normal and delayed startup must render
1440x900 and disconnect after physical Stop, within the unchanged viewer timeout.
Each viewer case removes its own gateway before the next ticket exchange.

Primary references: [Chrome Linux sandbox](https://chromium.googlesource.com/chromium/src.git/+/master/sandbox/linux),
[Playwright container sandbox guidance](https://playwright.dev/docs/docker),
[websockify](https://github.com/novnc/websockify),
[Docker signed Debian repository](https://docs.docker.com/engine/install/debian/).
The [isolated gateway mode](https://docs.docker.com/engine/network/port-publishing/#gateway-modes)
also denies the host-service path left by an ordinary internal bridge.
The vendored seccomp policy derives from Playwright v1.62.1; its unconditional
clone/setns/unshare/chroot allowance supports Chrome's unprivileged user-namespace
sandbox while the container still drops all capabilities and prevents privilege
escalation. Validate sandbox status again on the selected deployment kernel.


## Pending creation and Stop confirmation

The journal retains an allocationOwner fence from reservation/API registration through physical startup. Stop cleans best-effort but stays unconfirmed until the creator settles and a fresh physical observation proves absence. It cannot release this fence on lease expiry, restart or current Docker absence. Ambiguous mutation failures and creator crashes intentionally require operator investigation before recovery; the automated reset path is not certified. Drain allocations and upgrade supervisor/reaper together. See ../../docs/PHASE_03A_CREATION_STOP_FIX.md for the repair, tests and operational limits.


## Failed Docker mutations and EOF

Every failed resource-mutating CLI command retains the creation fence, including plain EOF with numeric exit code 1. Exit codes and diagnostic text do not prove that Docker settled the accepted request. Cleanup continues best-effort, but no confirmation or automatic capacity recovery is allowed for that unresolved fence. Read-only preflight failures and normally settled paths still clean and confirm. See ../../docs/PHASE_03A_DOCKER_EOF_FIX.md for regression evidence and the required operator-recovery launch gate.

## Saved browser login (stage 3B)

Saved login is disabled by default. It requires the existing manual/runtime gates and `QA_SAVED_LOGIN_ENABLED`, an API-only storage/transfer keyring and an independent durable revocation journal. The supervisor additionally requires `allowSavedLogin: true` and an absolute `vaultTransferKeyFile` containing only the matching transfer keyring. Neither keyring is mounted in tenant Chrome containers. See `../../docs/BROWSER_VAULT_OPERATIONS.md` for key separation, rotation, journal continuity and recovery prerequisites.

After explicit owner consent and physical manual-input handoff, supported cookies/localStorage are captured through the private runtime channel and transported encrypted. A later owner-approved saved identity is restored into a fresh temporary browser; input and CDP remain unavailable until READY. Expired/revoked state is refused, active uses request Stop, and no retry extends its seven-day maximum lifetime. There is no silent manual fallback. The existing API reaper clears expired ciphertext using the same durable journal as the API.

Real Docker tests cover capture denial before READY, cookies and Unicode localStorage restored in a fresh browser, and physical cleanup. PostgreSQL authority and actual Vue controls are validated separately; this does not certify a deployed third-party sign-in journey. Independent 3B review and deployment rehearsals remain required before activation.
