# Stage 2 — viewer startup readiness

Date: 2026-10-11. Local implementation and verification passed. Independent
review of this new repair is pending; public beta remains **NO-GO**.

The selected R1/R2/R4 fixes passed their earlier independent review. The R3
SQLite write-lock repair subsequently passed independent re-review, including
real competing-writer tests and the busy-timeout failure path. Its 97-file
snapshot and historical evidence remain unchanged. This follow-up changes no
API, session, QA controller, Runner, journal, approval or migration behavior.

## Controlled failure and scope

The old driver returned after Docker reported running containers. Chrome's CDP
readiness did not prove websockify's static modules or x11vnc were available.
A disposable image derived from the pinned production Chrome image delays only
websockify by eight seconds. With the pre-repair driver, the real owner-scoped
viewer shell responds 200 but `viewer/core/rfb.js` responds **502**. The browser
cannot import its RFB module, remains blank and reaches the unchanged 15-second
framebuffer timeout while the allocation lease is still valid.

This controlled reproduction establishes a startup race mechanism. It does not
retrospectively identify the cause of the earlier uninstrumented 10/11 runs.
Their failures remain recorded in `PHASE_02_SQLITE_LOCK_FIX.md` and its ledger;
the independent diagnostic 11/11 pass also remains a separate historical run.

## Implementation

- New `apps/browser-runtime/src/browser-readiness.mjs` checks the authenticated
  CDP version, the noVNC RFB module and a real WebSocket RFB greeting. The last
  check proves websockify can reach x11vnc; it sends no keyboard/mouse input and
  closes its probe connection without completing a viewer session.
- `DockerRuntimeDriver.start` executes these probes from the trusted supervisor
  on the allocation's private network. The driver returns only after readiness;
  the existing supervisor then performs its checks and marks the attempt LIVE.
- The readiness deadline is the earliest of fifteen seconds from probe startup,
  the existing lease and the immutable execution deadline. Probes have bounded
  waits, retry while authority remains valid and check time again after awaits.
  They never renew or extend authority. Failed startup requests the existing
  physical Stop/cleanup path; Docker unavailability remains unconfirmed Stop.
- The maintained Docker suite adds normal and eight-second-delayed viewer cases.
  Both keep the original framebuffer timeout and assert actual rendering,
  HttpOnly ticket exchange and disconnection after physical Stop.

Six unit regressions cover delayed modules, missing RFB backend, split greeting,
Chrome startup failure, expiry during the final probe and failed-start cleanup.
The delayed image is a uniquely labelled disposable test fixture; production
Chrome and egress images remain unchanged. The supervisor image was rebuilt to
include the readiness helper and driver.

## Verification

| Check | Result |
| --- | --- |
| Controlled delayed startup before repair | 1 failure; module 502, no framebuffer, valid lease |
| `npm run verify` | 1779/1779; 33 contract, 1036 API, 31 Runner, 636 web, 43 runtime |
| Types, architecture and runtime syntax | PASS |
| Guarded disposable PostgreSQL | 81/81; 25 migrations, zero schema drift |
| Focused real viewer pair | 2/2; normal and delayed startup |
| Full maintained Docker/Chrome suite | 12/12, zero failures/cancellations/skips |
| Source preservation | Existing session, QA controller, Runner, journal and migrations match prior snapshot |

The final Docker suite also checks Chrome namespace/seccomp sandbox, private
egress, host/metadata/network isolation, tenant storage isolation, renderer
failure preserving prior PASS evidence, physical Stop, lease/deadline expiry,
crash without replay and orphan-network cleanup. Both viewers render 1440x900
and disconnect after physical Stop. These are disposable local fixtures, not
production deployment or unrestricted public onboarding validation.

Two intermediate test-setup failures are retained transparently. The first
cancelled all twelve cases because fixture-image build exceeded the generic
30-second Docker command budget; only that build command now gets 90 seconds.
The next run passed 11/12: the first viewer left its detached gateway listening
on the controller port, so the second case reached the old in-memory journal.
Each case now removes its own gateway after the physical Stop assertion, checking
its PID, process command and execution identity. Viewer and authority timeouts
were not increased. The corrected pair and full suite passed afterward.

The final source/verification ledger is
`docs/evidence/phase-02/viewer-startup-fix.json`. Raw logs remain ignored under
`work/novnc-startup/`, with fingerprints in the ledger. Test containers, networks,
controllers, delayed images and temporary PostgreSQL were removed; the application
PostgreSQL container remains healthy. Historical ledgers were not rewritten.

## Review and next gate

Review the readiness helper and driver, expiry/failure cleanup, no-input RFB
probe and actual delayed-startup regression. Check the updated source hashes
against the ledger and preserve the already reviewed SQLite/approval/registration
repairs. Independent review of this new change is required before deciding
stage-2 closeout and authorizing stage 3.

Saved login/manual control, resource tabs, evidence/export, public project
routing and durable quotas, model policy and operational launch gates remain
stages 3-8 work. Production v2 activation stays disabled. This local repair
includes no commit, push, deployment or paid AI calls.
