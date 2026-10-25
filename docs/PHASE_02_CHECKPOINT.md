# Oddpath stage 2 checkpoint

Date: 2026-10-11. Status: **IMPLEMENTED, PENDING INDEPENDENT REVIEW**.
The four selected stage-2 findings are repaired locally and await independent
re-review. Read `PHASE_02_REVIEW_FIX.md` and
`evidence/phase-02/review-fix.json` for the newer source snapshot and validation;
the original validation ledger below remains dated implementation evidence.
Authorization: stage 2 after the owner-approved plan and independent closure of
stage 1's R1/P2 expiry finding. Stages 3-8, deployment, publication and paid AI
calls are not included. Changes are local in
`C:\Users\hatem\Documents\Codex\oddpath-foundation-phase-01`, branch
`codex/oddpath-foundation-phase-01`, base `08ae650`. Stage 1 changes remain in
this worktree too; no commit/reset/push was made.

## Implemented boundary

The managed runtime now reuses the existing QA services, request/run controller,
strict v2 approvals and recipe interpreter. There is still one product session
and one QA controller. No frontend session/controller was replaced.

- A separate trusted supervisor provisions official Chrome Stable/Xvfb/VNC/
  noVNC/websockify per allocation. Browser containers run non-root with namespace
  and seccomp sandbox, all capabilities dropped, privilege escalation denied,
  read-only root and resource/PID/profile/tmpfs limits. No tenant application
  secrets, host bind mounts or published CDP/VNC/control ports are added.
- Internal Docker bridges use isolated gateway mode to remove the ordinary
  internal-bridge host-service path. Docker Engine 28+ is checked before start.
  Only a separate egress proxy routes outside. Exact HTTPS CONNECT origins,
  public DNS address validation, mixed/private/metadata rejection and literal
  IPv4 pinning prevent a second DNS lookup/rebinding at TCP connect. Chrome
  disables direct QUIC/WebRTC routing and refuses cross-origin top-level flow,
  popups and downloads. IPv6-only transport currently fails closed.
- The supervisor has a durable FULL/WAL SQLite journal. Only a physically
  stopped allocation frees its single-host/global slot; a started/allocated
  execution can never be allocated or started again. Journal upgrade/restart
  preserves these fences. Lease/deadline/crash recovery kills attempts rather
  than replaying steps. Exit-report retries are bounded and fairly paginated.
- Child failure and a 200 ms in-container lease/deadline watchdog terminate
  Chrome independently of the API/worker. Separate runtime and API reapers
  remove unknown allocations/orphan networks, preserve interruption history,
  and retry exit reporting after supervisor failure. Reaper lease decisions and
  API lease mutations re-read state/time after QA locks; an expired lease cannot
  be renewed after waiting, and a freshly renewed lease is not killed from a
  stale pre-lock scan.
- `QaBrowserRuntime` binds one runtime/image digest to the exact v2 claim before
  accept. Status distinguishes LIVE, STOP_REQUESTED, STOP_UNCONFIRMED and
  STOP_CONFIRMED. Stop confirmation requires a fresh executor observation of
  **both Chrome and proxy process exit** after the Stop request. SQL rejects
  confirmation without exit time. Docker outage/cancellation/timeout is no proof.
- Owner-scoped view tickets are strict, signed, expire after sixty seconds and
  can be exchanged once. The gateway strips the fragment and uses an HttpOnly,
  Secure, SameSite=Strict cookie scoped to that runtime path. Asset and WebSocket
  access recheck project/execution/runtime/approval and live lease. The gateway
  exposes no CDP or input control. Viewer streams end on Stop/lease/deadline.
- Explicit v2 Runner methods reuse existing accept/heartbeat/results/evidence/
  finish/fail services. Canonical target/profile/recipe/approval hashes are
  checked before accept; a durable start fence precedes browser steps. Runtime
  loss is checked before recording interpreted assertion results. Already
  submitted partial results remain; no synthetic application FAIL is submitted
  solely because a browser connection crashed.
- Legacy dispatch remains compatible by default while staged transition is
  off. Managed mode requires legacy dispatch disabled, active jobs drained and
  queued legacy approvals retired. The operator transition is read-only without
  its explicit mutation option; bounded retirement preserves authorization and
  QA history and requires a new reviewed managed recipe/owner approval.

## Files and contracts

| Boundary | Changed files/modules |
| --- | --- |
| Runtime | New `apps/browser-runtime/` images, driver, supervisor, journal, egress, watcher/reaper, viewer and tests |
| Shared | `packages/qa-execution-contract/src/runtime.ts` and shared index |
| API | New `modules/browser-runtime/`; existing QA execution repository/Runner adapters and project routes; environment guards |
| Durability | Prisma `QaBrowserRuntime` and additive `20261011000100_add_browser_runtime_supervision` migration |
| Operators | API `browser-reaper.ts` and `browser-transition.ts`; `deploy/browser-runtime.compose.yml`; runtime README |
| Executor | Existing Runner client/execution/Playwright adapter and focused v2 regressions; default local CLI remains v1 |
| Documentation | Accepted plan, current handoff/next steps, control-plane/harness and this checkpoint |

The API owner GET/runtime viewer endpoints and scoped Runner begin/status/Stop/
exit adapters are documented in `QA_CONTROL_PLANE.md`. The existing owner QA
cancellation service is the Stop decision boundary; closing/hiding a future
product view must not cancel a run. Static operator project/profile provisioning
is currently capped at twenty projects; public routing/reservations are later
work, not an already implemented public onboarding path.

## Verification ledger

See sanitized `docs/evidence/phase-02/validation.json` for final test totals,
Chrome/sandbox/image/framebuffer proof and source hashes. Raw process logs stay
in ignored `work/`; they are not publishable customer evidence.

- Full regression/types/architecture checks include shared contract, API,
  Runner, web and runtime; final totals are recorded in the evidence ledger.
- Guarded real PostgreSQL: **81/81 PASS**, including v2 exact runtime binding,
  owner/project isolation, requested vs confirmed Stop, no reclaim after
  allocation/start, independent reaping, legacy drain/renewal, real lock waits
  for runtime renewal/expiry, and additive migration/physical-exit constraints.
- Real Docker Chrome suite verifies allocation **from the trusted supervisor
  image itself**, Chrome namespace/PID/network/seccomp sandbox, public HTTPS
  navigation/assertion/screenshot, real noVNC RFB/WebSocket and a **1440x900
  framebuffer rendered in a browser**, unauthorized control denial, raw TCP
  host/metadata/Internet blocking, two-tenant cookies/storage/files/network
  isolation, hard deadline, API-independent lease watchdog, real Chrome crash,
  physical Stop and orphan network removal. Final totals are in the ledger.
- API/Runner production builds pass; web builds with a synthetic exact HTTPS
  API origin (validation only, not a release/deployment artifact). Production
  npm dependency audit reports zero vulnerabilities. Docker images build;
  immutable IDs and observed Chrome version are in the ledger.
- No working database migration, owner-approved QA mutation, live AI call,
  deployment, Git publication or synced-project file edit was performed.
  Disposable test database and runtime fixtures are removed by verified labels.

During development, checks found/fixed a sandbox syscall requirement, Docker
missing-network/Stop races, stale lease checks, fairness of undeliverable exit
reports and host paths on ordinary internal bridges. Sandbox remained enabled.
One earlier timing run timed out; passing final runs supersede it. Initial
loopback checks were denied by the tool sandbox and rerun with local-network
permission. A synthetic web build origin is supplied explicitly rather than
weakening the production origin guard.

## Remaining gates and next review

**Public beta/deployment: NO-GO.** API v2/runtime flags default off; production
startup rejects v2 enablement. Current proof is on Docker Desktop Linux amd64,
not the selected cloud host. The implementation is reusable runtime foundation,
not proof of an affordable/public operating service. Budget remains EUR 10/month
infrastructure, excluding domain/API; capacity/cost have not been measured.

Before beta, complete the already accepted stages: manual login/MFA and human
input ownership/logout/revocation/vault (3), localized resource/browser views
and responsive owner Stop journeys (4), evidence provenance/retention/export
(5), public project routing plus durable per-account/global queues/quotas and
model/auth gates (6), readiness GO/NO-GO with deployment proof (7), then actual
host isolation/restore/proxy/health/kill-switch/first-user/capacity/budget gates
(8). Android APK/Firebase import, iOS, extra browser engines/providers and
autonomous replanning remain later workstreams. No unsupported engine is exposed.

Independent stage-2 review should focus on immutable no-replay/lease boundaries,
Stop receipt trust and actual Docker proof, isolated network/DNS policy, journal
restart/fairness, viewer scoping/WebSocket termination, operator protocol drain
and preservation of existing session/QA services. Stage 1's R1 closure is scoped
to that prior repair; it is not an independent approval of stage 2.
