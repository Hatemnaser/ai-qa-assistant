# Phase 03A — Docker EOF settlement repair

Date: 2026-10-12. Implemented and locally verified; independent re-review pending. Public beta remains NO-GO and saved-login 3B is not started.

## Corrected behavior

A real Docker CLI transport error can return code 1, no signal and plain EOF after the server received an entire mutation request. The previous diagnostic blacklist did not recognize that error, so allocationOwner was cleared and Stop could be confirmed before a late network appeared.

The driver now marks every failed resource-mutating CLI operation as allocationSettlementUnknown: container create/start and network create/connect. Neither a numeric exit code nor stderr establishes an authoritative daemon settlement outcome. The existing supervisor/journal fence therefore remains held, Stop performs best-effort cleanup, and no STOPPED/reportable proof is produced for the unsettled allocation. Reopening the journal cannot release the fence. Successful startup, read-only preflight failure, authority loss after a completed command, readiness failure and normal Stop retain their existing lifecycle paths.

Only docker-driver.mjs changes production behavior. supervisor.test.mjs adds nine unit cases, and docker.integration.mjs adds an actual CLI EOF/late-network regression with two journal connections and restart coverage. No API, QA controller, session, Runner or frontend code, schema, dependency or activation setting changed.

## Recovery limit

This is deliberately conservative for all failed mutation commands, including daemon-looking diagnostics. The CLI wrapper has no trustworthy structured settlement acknowledgement. Such failures can leave the single allocation capacity blocked pending operator investigation, even after current resources are cleaned. No timer, journal restart, resource absence or text allowlist may auto-release that fence. The operator settlement/recovery runbook remains a launch gate; this repair does not introduce a reset API or claim automatic recovery. Drain old allocations and update supervisor and reaper together before activation.

## Validation

- Red before the repair: four targeted unit failures and the real CLI EOF regression failed on the missing settlement marker.
- Full verify: **1818/1818** (contract34, API1040, Runner33, web639, runtime72), all required checks passed.
- Disposable PostgreSQL: **90/90**, 26 migrations, no drift. The working database was not migrated.
- Combined real PostgreSQL/SQLite/Docker cases: **2/2**. The original pending-create race confirms only after settlement and cleanup. The EOF case retains STOP_REQUESTED with no reportable proof, then cleans the late network while preserving the unresolved fence. Cancelled execution accept remains rejected.
- Complete real Docker suite on a clean rerun: **22/22**. This includes Chrome/Playwright isolation, noVNC framebuffer and delayed readiness, manual login/MFA, crash handling, watchdogs, cleanup, and the new EOF regression. See the evidence ledger for the initial failed attempt and rerun context.
- **59** image/source or compiled-module comparisons match. The supervisor was rebuilt under phase-03a-eof-fix and local phase-02/phase-03a aliases; previous repair tags are retained. Chrome/egress digests are unchanged.
- No runtime fixtures/controllers/networks/disposable databases remain; working PostgreSQL is healthy. git diff --check passes.

Fault injection receives the complete network-create request in a loopback HTTP fixture, drops the reply to produce EOF from the real Docker CLI, and later forwards the retained operation to the real Docker daemon. It does not pause daemon internals. The late physical resource proved is a network. The combined test invokes real API repositories and the production reporting eligibility rule without spawning a complete deployed API/reaper stack.

Exact hashes, image identities, sanitized timelines, first-attempt and clean-run logs are recorded in evidence/phase-03a/docker-eof-fix/validation.json. Prior repair and review reports remain historical. No deployment, commit/push, paid AI call, 3B work or public activation occurred.
