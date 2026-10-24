# Oddpath stages 0-1 checkpoint

Date: 2026-10-10. Scope: accepted public-beta foundation, stages 0 and 1 only.
Base: `08ae650` on `main`. Work branch: `codex/oddpath-foundation-phase-01`.
Changes are local in a separate worktree; no commit, push or deployment was made.
Worktree: `C:\Users\hatem\Documents\Codex\oddpath-foundation-phase-01`.
Use that directory for continued review/implementation; the original checkout
is still on clean `main` at the base revision.

## Result

The target and approval foundation is ready for review. Remote-browser public
beta remains **NO-GO** until the remaining stages and operational gates pass.
No Chrome/noVNC service, saved-login vault, resource-tab UI or readiness/release
engine is claimed by this checkpoint. V2 dispatch defaults off; production
startup rejects enablement. Controlled tests enable the repository explicitly.

## Stage 0

`ODDPATH_BETA_IMPLEMENTATION_PLAN.md` records the accepted public-beta scope,
remote Chrome/Playwright/noVNC direction, infrastructure budget, fixed initial
limits, exact approval/Stop/login boundaries, stage dependencies and file/test
boundaries. It preserves future APK/Firebase/iOS work without advertising a
supported mobile engine. Historical provider/invite-only launch notes are dated
reference rather than current product scope or publication permission.

Fresh baseline on the selected revision had 1,641 passing tests of 1,642:
contract 4, API 984, Runner 18, web 635/636. The sole failure was an existing
source-inspection regex assuming LF in a Windows CRLF checkout. The test reader
now normalizes line endings; the Usage page and session UI were not changed.

## Stage 1

- Project-owned targets use append-only revisions, normalized HTTPS identity,
  environment, exact dependency origins, declared candidate and SHA-256.
  Create/revise requires the owner's explicit acknowledgement of test authority.
- Owner cookie/CSRF endpoints manage targets and bounded DNS TXT/HTTPS-file
  ownership challenges. The database stores only challenge hashes. Proof expires
  after 24 hours and is never silently renewed. Verification fences revision
  changes during the probe. HTTPS probes pin a supported public DNS address,
  reject mixed/private answers, follow no redirects and bound time/body size.
- Shared strict v2 manifests/tasks/approval bindings reject URL credentials,
  query/fragment, IP literals, wildcard/invalid DNS labels, non-default ports,
  mismatched environments/auth identity and unsupported engines. Limits cap
  preparation at five minutes and execution at ten minutes.
- Exact owner approval binds request/checklist version, recipe/hash, profile/hash,
  target revision/hash, ownership proof, auth identity, candidate and limits.
  Claim and accept validate the approved state again. Changed/malformed/expired
  bindings terminalize the job and preserve QA history; accept commits that
  failure before rejecting the runner. New proof cannot revive an old approval.
- Additive migration `20261010000100_add_qa_target_approval_v2` adds three target
  tables, optional v2 approval fields, indexes, foreign keys and SQL constraints.
  Legacy authorization fields, hashes and QA history are not rewritten. Shared
  v1 schemas, the current CLI and existing execution behavior remain compatible.
- V2 adapters reuse the existing QA services. Inactive v2 profiles are shown as
  incompatible and dispatch is blocked. Saved-state execution is blocked; v2
  production recipes permit navigation/assertions with explicit confirmation.
  These rules do not guarantee that a navigation has no server-side effects.
- Stop's future contract distinguishes requested, confirmed and unconfirmed.
  Confirmation requires a runtime exit observed after the request. Existing
  database cancellation/lease expiry does not establish that runtime proof.

## Files

Contracts: `packages/qa-execution-contract/src/{target,v2,index}.ts` and tests.
Domain: API `modules/qa-targets/`, canonical hashing, existing `qa-requests/`
services/repositories/adapters and session profile readers. Persistence: Prisma
schema/migration. Activation: env loader/validator and `.env.example`.
Regression: target service/URL/approval/SQL/concurrency suites, existing runner
registration/owner-route/env tests, and the CRLF-portable web source test.
Documentation: accepted plan, control plane/harness, handoff/roadmap and this
checkpoint. There is no second session or QA controller.

## Verification

Node 24.19.0, freshly installed unchanged lockfile, PostgreSQL 16. All database
mutation was confined to a labeled disposable container on a separate loopback
port; the owner's working database and approved QA records were not used.

| Gate | Result |
| --- | --- |
| `npm run verify` | PASS: 1,707/1,707; contract 33, API 1,020, Runner 18, web 636 |
| Types/architecture inside `verify` | PASS: 293 API source files, 150 test files |
| `npm run test:i18n` | PASS: 8/8 |
| `npm run test:integration:db` | PASS: 66/66; 31 new target/approval cases plus existing 35 |
| `npm run db:migrate:deploy` | PASS: 24 migrations on the disposable database |
| `npm run db:drift:check` | PASS: up-to-date, no difference |
| Transactional legacy-migration rehearsal | PASS: old authorization fields and QA history unchanged |
| Synthetic `pg_dump` / `pg_restore` rehearsal | PASS: all 51 table count/content fingerprints identical; 21 non-empty tables, two target revisions and one v2 approval retained |
| API/Runner/web production builds | PASS; web built with a synthetic exact HTTPS API origin |
| `npm run audit:production` | PASS: zero vulnerabilities |

The restore rehearsal included synthetic session text, QA history, target
revisions/proof and an exact approval. It establishes PostgreSQL data preservation
for this slice; it does not certify production browser restart, encrypted vault
restore/tombstones, R2 durability or safe reactivation of live execution.
Sanitized outcomes are in `docs/evidence/phase-01/validation.json`. Raw logs,
one-off restore helper, dump and fingerprints stay local under ignored `work/`.
The fresh checkout had no production web API origin, so the existing build guard
initially rejected it. Supplying `https://api.example.test` for build validation
passed without contacting that host or writing deployment settings. The existing
web bundle-size advisory remains. The temporary DB container was retired after
verification; local fixture dump/fingerprints remain excluded from publication.

## Next review and activation boundary

The R1/P2 expiration-during-lock-wait review fix is implemented and tested.
Read `PHASE_01_REVIEW_FIX.md` and `evidence/phase-01/review-fix.json` for the
fresh 1,718 regression tests and 71 disposable-database tests. Independent
re-review remains pending; the original verification totals above are historical.

Review these stages before stage 2. Stage 2 must supply real remote Chrome/noVNC,
an independent supervisor, runtime isolation/egress enforcement, truthful Stop,
orphan cleanup/reaper, crash recovery and no replay of a started recipe. It must
also update the v2 runner/session integration, protocol drain and stale legacy
approval handling. Current v1 retry/cancellation semantics are transitional.
The development v2 enable flag is not a production operator kill switch.

Stage 3 supplies human login/MFA/capture pause and encrypted revocable saved
state. Resource tabs, provenance/export, exact-model vs Auto behavior, durable
quotas/public auth, scoped readiness and launch operations remain later gated
stages. Hosting cost/capacity and the full public-beta GO remain unproven.
No new paid provider call, deployment or modification of synced project sources
is authorized by this checkpoint.
