# Phase 4 — scoped session resources and tabs

2026-10-13. Authorized after the retained 3B review. Local implementation; independent review is the next gate before stage 5. Final validation is `evidence/phase-04/validation.json`.

The retained independent review found three issues at the production CSP,
pending-view intent and modal keyboard boundaries. Their repair and subsequent
validation are recorded separately in `PHASE_04_REVIEW_FIX.md` and
`evidence/phase-04/review-fix.json`; the original implementation/review evidence
remains dated. Review the repair before closing stage 4 or starting stage 5.

## Behavior and identity

`sessionResources.ts` defines references for Sources, Activity, Results, Evidence, Browser and Readiness in the existing owner/project/session scope. It contains no credentials, viewer URLs, cookie state, execution approval or second lifecycle. Sources/Activity are session views; results/evidence/readiness reference an owned request. The browser reference binds the current selected execution job and is withdrawn when that controller selection is historical.

At most 12 tabs are retained in memory. Pin changes ordering; close removes that tab and its pin, choosing a neighboring tab. Hide preserves opened readers, their native scroll/details and selection; it disconnects the browser display. Expand uses the accessible modal surface. Account/project/session changes clear the catalog state synchronously; KeepAlive deactivation hides the panel and disconnects live viewing. No signed authority is persisted with tabs or exported.

`useSessionResourceReader` fetches through the existing owner-scoped QA GET service, separately from `useTestSession`. It checks returned project/request identity, invalidates late responses at scope/resource/deactivation/disposal boundaries, preserves the selected run across refreshes, and reports a missing selected run instead of switching to a newer one. Session activity/timeline result links open this reader rather than calling `selectRequest`. Explicit human decision buttons retain the existing controller selection behavior.

The existing writer, draft persistence, reader position, current-run approvals and Stop controller remain authoritative. Browser Stop checks the exact current execution identity before invoking the existing cancellation action. Private-login consent/complete controls remain mounted in the session; opening/hiding/closing the browser resource does not reset an unresolved consent choice. The tab can obtain a fresh LOGIN display grant during authorized human input; capture remains paused and the API/runtime fences remain unchanged.

Evidence views use existing evidence records/cards/download authorization. New evidence provenance/retention/export is stage 5. The Readiness view explicitly says not evaluated and displays recorded context only; it never infers GO from PASS or human approval. Frozen criteria and verified deployment readiness are stage 7.

## Embedded browser boundary

The viewer gateway accepts optional `viewerFrameOrigin` in operator supervisor configuration. It must be one exact HTTPS origin, different from the viewer origin. Omission retains `frame-ancestors 'none'`. The gateway grants framing only to that configured application origin; no wildcard, arbitrary parent list or change to VIEW/LOGIN grants is introduced. Local test-only `secure:false` permits explicit loopback HTTP origins.

Example operator configuration fields:

```json
{
  "publicOrigin": "https://browser.oddpath.eluthira.com",
  "viewerFrameOrigin": "https://oddpath.eluthira.com"
}
```

The application and viewer must use separate origins on the same site because the viewer retains HttpOnly/Secure/SameSite=Strict cookies. Operator HTTPS/CSP/proxy configuration must allow the viewer frame; these fields are examples, not provisioned DNS or activation. No app or viewer secret belongs in the Chrome container.

Build the frontend with optional `VITE_BROWSER_VIEWER_ORIGIN` equal to that
viewer `publicOrigin` (and the API's `QA_BROWSER_VIEWER_ORIGIN`). The generated
production `frame-src` permits only that exact HTTPS origin; omitting it keeps
framing disabled. The viewer's `viewerFrameOrigin` controls the reverse boundary,
allowing the separate app origin to embed it. Both settings are needed.

Viewer capability URLs live only in the active component. Switching tabs, hiding, closing, deactivation, expiry/failure or Stop removes the iframe; reopening requests a new one-use grant. The gateway notifies the exact parent only after noVNC's RFB connect event. The parent checks the actual iframe WindowProxy, viewer origin, runtime and VIEW/LOGIN mode. Iframe load or an unrelated postMessage cannot show success. Missing acknowledgement becomes a visible failure after 15 seconds; cancellation is independent of that display failure. A missing/disabled managed runtime has a separate unavailable state, including advanced local Runner jobs.

Changing between the side panel and teleported drawer (including expand/collapse)
disconnects the iframe as well. The old bootstrap grant cannot be reused after
DOM relocation. The display reports disconnected and requires a fresh explicit
connection; the browser and QA execution are not stopped by that layout change.

## Validation and limits

The final ledger records current type/architecture/full regression/i18n/web-build checks, scoped resource/reader unit cases, actual SessionPage/controller/CSS/EN-DE-AR journeys on desktop/mobile, and real Chrome/noVNC embedded display with fresh grants, view disconnection and physical Stop. Tests use synthetic owner-scoped API fixtures for deterministic UI/transport behavior. The Docker case runs the actual viewer gateway/Chrome and measures framebuffer pixels; its API bridge is synthetic, not a deployed application/database certification.

No API/database source, wire contract, migration, default activation gate, paid AI call, commit, push or deployment is changed. The full migrated PostgreSQL suite and entire Docker isolation/expiry suite remain dated prior evidence; focus here is the affected framing/display/reader boundary. Operational readiness, durable public quotas, auth/email, hosting budget and release GO/NO-GO remain stages 5–8. Android/Firebase/iOS remain deferred.
