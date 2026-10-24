# Oddpath public beta implementation plan

Accepted 2026-10-10. This replaces the historical invite-only/provider-specific
launch scope. Stages 0-2 are locally accepted after independent review.
On 2026-10-12 the owner authorized the next local slice and explicitly chose
manual login/MFA first (3A), then encrypted saved login (3B) after review.
Deployment, paid AI calls and production activation remain outside this slice.

Current checkpoint (2026-10-18): phases 06B, 06C and 07 have bounded local
acceptance GO; see `PHASE_07_CLOSEOUT.md` for the final R1 review and limits.
The owner subsequently authorized bounded local Phase 08 implementation without
additional hosting spend. `PHASE_08A_READINESS_INVENTORY.md` records closed API/PG
packaging, architecture selection and the local release test manifest, pending
independent review. Production activation, automatic public browser project
binding, full topology, operational recovery and live proofs remain open.
Public activation and Phase 08 launch acceptance remain NO_GO.

Historical checkpoint (2026-10-14): stages 0-5 and Phase 06A are reviewed locally;
see their closeout documents, including `PHASE_06A_CLOSEOUT.md`. The owner
authorized Phase 06B durable quotas/browser reservations. Its independent
review precedes the public-auth/email/abuse slice. See `PHASE_06B_CHECKPOINT.md`.
Public activation remains NO-GO.

## Fixed decisions

- One managed session, one QA controller and common Web/REST/MCP services.
  Scope confirmation, exact run approval, QA record review, readiness and release
  authorization are different decisions. Agents cannot approve for the owner.
- Public registration uses verified email, a queue and quotas. Guest AI/browser
  execution are disabled in the beta deployment. Disabled registration remains
  the default until mail, abuse protection and legal-publication gates pass.
- Remote Chrome Stable with Playwright and noVNC; no installation for website
  users. Desktop manual control first, responsive mobile viewing/status/Stop.
  Keep the advanced local Runner during the staged protocol transition.
- Immutable reviewed recipes first. TEST/STAGING support approved flows;
  PRODUCTION automation initially allows navigation/assertions, not form/data
  mutation. This policy does not guarantee that HTTP reads have no effects.
- Original infrastructure ceiling: EUR 10/month. The owner's later instruction
  is no additional hosting spend now; no paid service is authorized. Domain and
  AI/API charges are separate.
  Hosting selection is external to the product contracts. Missing isolation,
  durability or budget blocks deployment rather than weakening the safeguards.
- Initial limits: one active browser globally, one active/queued allocation per
  account, three allocations/account/day, queue ten, maximum wait ten minutes.
  Each allocation lasts at most fifteen minutes (five preparation/login,
  ten execution). Server settings and user-visible limits change only after
  measured capacity/cost review.

## Approval and compatibility

Project-owned targets have immutable revisions containing normalized HTTPS URL,
environment, exact resource/authentication origins, optional declared deployment
identity and a canonical hash. DNS TXT or HTTPS-file proof establishes domain
control; acknowledgement of test authority is separate. Dependencies do not
become test targets. Recheck target/proof before dispatch.

Approval binds request/checklist version, recipe/hash, profile/hash, target
revision/hash, authentication identity and execution limits/deadlines. Changed
bindings need a new approval. Page/file instructions are untrusted content.
Imported/historical approvals never grant new authority.

Protocol v2 is additive, with v1 historical reads preserved. V2 dispatch remains
disabled until runtime isolation/supervision/Stop work is complete. Drain active
jobs before activation; legacy unexecuted approvals then require renewal.
Stop requested/confirmed/unconfirmed differ; close/hide is independent of Stop.
Never replay a started recipe after lease loss. A separate reaper is required.
Only the human or executor owns input at a time; takeover ends the automated
attempt with partial results, and restarting requires a new run/approval.

## Stages, dependencies and acceptance

0. **Baseline:** reconcile docs and run fresh checks on the selected revision.
   Historical test totals stay dated; real owner-approved records are not fixtures.
1. **Targets/protocol:** owner-only target revisions and DNS/HTTPS verification,
   versioned schemas, immutable authorization bindings and additive migrations.
   Reject stale URL/environment/recipe/auth/limits, cross-project targets,
   expired proof and unsupported engines. Rehearse migration/restore in a
   disposable database. Publish the compatibility/activation boundary explicitly.
2. **Runtime:** separate supervisor, per-allocation production container with
   Chrome/display/VNC/WebSocket services. Non-root sandbox, resource limits,
   private control ports, no application secrets/host mounts, egress protection
   against internal/metadata addresses and DNS rebinding. Prove tenant isolation,
   process termination, orphan cleanup, crash recovery and no step replay.
3. **Login:** manual MFA/allowed SSO with capture/model inspection disabled;
   optional supported storageState, AES-256-GCM with independently versioned
   keys outside the database, maximum seven days without silent extension.
   Consent, owner/project/target isolation, deletion/revocation of active use and
   restore tombstones are mandatory. No passwords/cookies/MFA/vault data in
   logs, evidence, models or exports. Logout revokes control and stops allocation.
4. **Resources:** typed Sources/Activity/Results/Evidence/Browser/Readiness views
   with pin/open/close/hide/expand. Historical readers must not select the QA
   controller's request. Preserve draft/reader position, writer/decision/Stop,
   owner scope, keyboard/focus, RTL and responsive behavior; no second controller.
5. **Evidence/export:** measured expected/observed results with target/build,
   step, time and executor provenance; AI interpretation remains separate.
   TEXT/SCREENSHOT/REFERENCE first; no blanket FAIL for execution infrastructure
   failures. Existing PostgreSQL/R2 interruption/cleanup/restore gates must pass
   before production assets are enabled. Keep 50 MiB/account and 4 MiB/image;
   new evidence binaries expire after thirty days with gaps visible. Versioned
   JSON/Markdown/ZIP and project/account export include QA records/hashes without
   secrets/live authority. Bounded-memory export reports missing files clearly;
   imports do not resume execution or reinstate approval.
6. **Models/quotas/auth:** explicit model means that model or an error; Auto
   permits declared routing/fallback. Preserve actual-model usage and credit
   reservation/reconciliation; add durable browser reservations across restarts.
   Harden owned auth, email and proxy/edge limits before public registration.
   No new provider or unrelated authentication-platform migration in this slice.
7. **Readiness:** versioned candidate/environment/criteria frozen before testing;
   all mandatory checks and current required evidence must pass. Default evidence
   freshness is 24 hours; known build changes invalidate immediately. Declared
   build identity alone cannot grant verified-release GO: a configured version
   endpoint supplies deployment proof. Absent proof still permits tests/reports.
   Distinguish failed/missing/blocked/stale reasons; human optional-risk acceptance
   cannot waive a mandatory failure. No automatic deploy/release authorization.
8. **Launch:** current types/tests/DB migrations/build/audit gates; actual
   two-account isolation/Stop/SSRF, storage/vault deletion and restore, an unaided
   first-user journey, capacity and infrastructure budget. Daily encrypted
   off-host backups retained seven days, proven restore/rollback, monitored
   reaper/deletion/mail/storage failures and tested operator kill switches.

Dependencies: 0 -> 1 -> 2 -> 3. Resources integrate 1-3; evidence depends on
targets/runtime/login; readiness depends on targets/evidence. Model/quotas/auth
must precede public use. Launch requires all prior gates. Review and test every
stage before activating its dependents. Documentation of a gate is not its proof.

## File boundaries and verification by stage

Paths marked **new** are proposed module locations, not existing capabilities.
Use the preceding acceptance criteria with these regression boundaries.

| Stage | Files/modules affected | Required verification |
| --- | --- | --- |
| 0 | This plan, `AI_HANDOFF.md`, `NEXT_STEPS.md`, historical launch notes, checkpoint | Fresh types/architecture/regressions; dated baseline and explicit authorization scope |
| 1 | Shared contract `target.ts`/`v2.ts`; API `qa-targets/`, `qa-requests/`, existing session profile readers; Prisma schema/additive migration; env guard | URL/schema rejection, owner/CSRF boundaries, optimistic revisions, exact approval/expiry, cross-project fencing, v1 regression, real DB concurrency/migration/restore |
| 2 | **new** `apps/browser-runtime/`; `apps/runner/src/`; existing QA execution repository/services; **new** API browser allocation/supervision module; deployment configuration | Real Chrome/noVNC, two-account isolation, private ports, SSRF/rebinding, deadline/crash/lease-loss/Stop proof, no replay, restart/reaper and protocol drain |
| 3 | **new** API browser-auth/vault module and migrations; runtime login boundary; auth logout/account/project deletion; session browser controls | No capture/model access during login/MFA, exact SSO origins, encryption/key versioning, seven-day expiry, revocation/deletion/restore tombstones, active-use termination |
| 4 | `apps/web/src/features/sessions/SessionPage.vue`, existing `useTestSession.ts` and QA controller; **new** typed resource view module; locale catalogs | One controller, historical reader independence, preserved drafts/scroll/focus, pin/close/hide/Stop semantics, RTL and mobile viewer journeys |
| 5 | API `qa-requests/`, `assets/`, `data-portability/`; web evidence/results/export readers; retention operators | Evidence provenance/missing states, expired/deleted images, file/byte limits, bounded ZIP, no live authority/secrets on export/import, PostgreSQL/R2 interruption/cleanup/restore |
| 6 | API `modules/ai/provider-registry.ts`, `routing/model-router.ts`, usage/auth/email/limits; web model picker; browser reservations | Exact model-or-error vs explicit Auto fallback, actual-model charging, restart/concurrent quota reconciliation, verified-email registration and abuse limits |
| 7 | **new** readiness criteria/candidate/snapshot module and web view; target/evidence records; shared readiness contract | Frozen criteria, verified deployment identity, changed build/24-hour staleness, missing/blocked/failed reasons, mandatory failures cannot be waived |
| 8 | CI and deployment/readiness docs/operators; browser/storage/mail/reaper health; backup/rollback tooling | Full regression/build/audit gates, real unaided user journey, tenant isolation, Restore/Stop/SSRF, measured capacity and infrastructure budget, operator kill switches |

The before-beta boundary includes stages 0-8 and their operational proofs.
Stages 0-2 are locally accepted (`PHASE_02_CLOSEOUT.md`). Stage 3 is split at
the owner's explicit review gate: 3A manual login/control is the current local
implementation; 3A closed locally on 2026-10-13 after retained independent reviews.
The owner authorized 3B encrypted saved state; read PHASE_03B_CHECKPOINT.md for
its implementation, verification and independent-review boundary.
Read `PHASE_03A_CHECKPOINT.md` for its actual file/test scope. Stage 4 closed
locally after its independent repair review (`PHASE_04_CLOSEOUT.md`). Stage 5
closed locally after independent repair review (`PHASE_05_CLOSEOUT.md`).
Phase 06 is locally accepted through the 06C closeout. Phase 07 readiness is
locally accepted through `PHASE_07_CLOSEOUT.md`; Phase 08A inventory is in
`PHASE_08A_READINESS_INVENTORY.md`. Stage 8 launch and public activation remain
gated. Android/iOS and the
other workstreams below remain deferred; no unsupported engine is advertised.

## After beta

Android APK upload/Firebase import adds immutable artifact hash/build/source
metadata and its own device/session/recipe handling. iOS is a separate
device/signing workstream. Prepare target/candidate/evidence identities now,
without fake supported engines. Local browser helper/extension, additional
browser providers, autonomous replanning, Jira/GitHub writes, organizations,
video/HAR/full traces and release/deploy orchestration remain later workstreams.
External writes require scoped credentials, preview and explicit approval.
