# Phase 4 — production framing, view intent and keyboard repair

2026-10-13. Local repair of the three retained independent-review findings.
Review the repair before closing stage 4 or starting evidence/export stage 5.
The original implementation ledger and independent review remain dated evidence;
the repair's validation is `evidence/phase-04/review-fix.json`.

## Production viewer origin

`VITE_BROWSER_VIEWER_ORIGIN` is optional. A configured value must be one exact
HTTPS origin, without credentials, wildcard, path, query, fragment or origin
list. The web build emits `frame-src` for only that origin. Omission emits
`frame-src 'none'`; framing never gets an implicit wildcard or API/script access.
Match this value to the API's `QA_BROWSER_VIEWER_ORIGIN` and supervisor's
`publicOrigin`. Set the supervisor's separate `viewerFrameOrigin` to the app
origin. Retain separate same-site origins and the viewer's Strict/Secure cookie.
Changing configuration requires rebuilding; no host/DNS or active configuration
was provisioned by this repair.

The maintained SessionPage browser fixture can enforce the actual built
`dist/_headers` CSP. Its two policy journeys exercise both the configured viewer
and a rejected alternative origin. Run after a synthetic review build:

```powershell
$env:VITE_API_BASE_URL='https://api.example.test'
$env:VITE_BROWSER_VIEWER_ORIGIN='https://viewer.example.test'
npm run build:web
$env:ODDPATH_RESOURCE_PRODUCTION_HEADERS='1'
node --test apps/web/tests/sessionResources.browser.mjs
```

The policy journeys are explicitly skipped when that browser-test environment
flag is absent. Their fixture routes synthesize HTTPS responses; this checks the
production CSP in actual SessionPage, not a deployed TLS/API certification.

## Pending display intent

`BrowserResourceView` has a separate viewer generation. Explicit disconnect,
status failure/revocation, scope/deactivation/layout changes and display failure
invalidate pending grant responses and clear the display busy state. Removing
the previous display during adoption of a current grant does not invalidate
that grant. Status polling has its existing independent lifecycle generation.
The requested VIEW/LOGIN mode is selected before awaiting a grant so a valid
LOGIN poll cannot accidentally cancel first connection preparation.

Both VIEW and LOGIN UI journeys hold the first grant across a status poll,
disconnect while a later grant is pending, and prove that its eventual response
cannot recreate the iframe. A new explicit connection wins even when an older
request completes afterward. No view action calls cancellation or physical Stop.

## Native keyboard traversal

The shared dialog helper includes native iframe and details-summary tab stops.
It excludes descendants of collapsed details, whose cached layout rectangles
can otherwise make hidden controls look focusable. The resource modal adds an
end focus guard: keyboard events inside a cross-origin iframe do not bubble to
the parent's handler, so native Tab leaving the final frame is redirected to
the first dialog control. The guard is excluded from normal focus candidates.

Desktop expanded and mobile drawer journeys visit both login-frame inputs,
return to the app controls with Tab/Shift+Tab, traverse collapsed/open saved-login
details and retain containment when saved-login management is unavailable and
the iframe is last. Background inertness and the existing body lock remain
active until the modal closes. No private fields are read by product code.

## Validation and retained boundary

The separate ledger records the final full verify/type checks, production build,
15 actual resource UI journeys, focused header/controller/dialog cases and
affected real Chrome/noVNC Docker journeys. Intermediate keyboard failures are
retained separately: they exposed collapsed-details and last-frame containment,
which were repaired before final validation. Earlier successful totals are not
substituted for final source checks.

The first concurrent Docker run exceeded the embedded gateway fixture's static
45-second journal lease on its third connection, while the browser fixture was
still accepting heartbeats. That test gateway now renews its journal only after
an accepted private browser heartbeat, bounded by the original deadline, as the
production supervisor does. The final case records the renewal count. Production
runtime source and its expiry checks were not relaxed; the failed attempt remains
separate evidence.

The existing QA controller, BrowserLoginControls consent/complete lifecycle,
API/runtime grants, schema/migrations and physical Stop implementation are
preserved. No public activation, deployment, paid model call, commit/push or
stage 5 feature is part of this repair. Full migrated PostgreSQL and the entire
Docker isolation suite remain dated prior evidence. Public release remains
NO-GO until the subsequent evidence, quotas/auth, readiness and operating gates.
