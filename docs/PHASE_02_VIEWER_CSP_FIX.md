# Stage 2 — noVNC framebuffer CSP repair

Date: 2026-10-12. Local repair and verification passed. Independent review is
pending; public beta remains **NO-GO** and production activation stays disabled.

The final independent browser review reproduced a real black framebuffer while
Chrome/Playwright, TigerVNC and WebSocket/RFB worked. The viewer CSP defaulted
image loading to same-origin sources; bundled noVNC decodes JPEG/PNG rectangles
through data images. Successful transport, canvas dimensions and a nonempty
screenshot therefore did not prove actual Chrome content.

## Bounded change

- The gateway adds only `img-src 'self' data:`. Existing nonce script/style,
  same-origin connections, frame/object/form restrictions and owner authorization
  remain intact. No input control, new route or lifecycle change was introduced.
- The existing normal/delayed Docker viewer tests now set a large red Chrome
  fixture through real CDP and count matching pixels from the actual noVNC canvas.
  They then change Chrome to blue, require the new pixels and ensure the previous
  red frame is gone before confirming viewer disconnection after physical Stop.
  The threshold is 100,000 pixels with a three-channel-value JPEG tolerance;
  the existing 15-second framebuffer waits were not increased.
- The supervisor image was rebuilt from the source. The Chrome and egress image
  IDs remain unchanged. Eleven critical source/test files match the pinned images.

## Fresh validation

| Check | Result |
| --- | --- |
| Stronger viewer pair on original image | 0/2 pass; both fail at actual red-pixel wait |
| Full verify | 1779/1779: contract 33, API 1036, Runner 31, web 636, runtime 43 |
| Types, architecture and runtime syntax | PASS through full verify |
| Maintained real Docker suite on rebuilt image | 12/12; zero failure, cancellation or skip |
| Normal changing framebuffer | red 1045957; blue 1045846; old frame replaced; disconnected after Stop |
| Delayed changing framebuffer | red 1045957; blue 1045846; old frame replaced; disconnected after Stop |
| Stop, lease/deadline expiry, renderer crash, isolation and orphan cleanup | PASS in the real Docker suite |
| Fixture cleanup | No runtime containers/networks, test controllers, fixture images or owned Node processes; application PostgreSQL healthy |

The negative run executed the strengthened maintained tests against the original
supervisor image, with no response interception or policy override. Both failed
at the unchanged 15-second pixel wait; no unrelated fixture setup failure occurred.
The positive full run uses the rebuilt production implementation and the same
maintained tests. No security-disabling browser flag or iframe/CSP bypass was used.

The original API, session, QA controller, Runner, journal, approval and migrations
are preserved against the 103-file pre-repair snapshot. Only the two named runtime
source/test files and this handoff's documentation differ. Historical evidence,
including `viewer-startup-fix.json`, is unchanged. Database integration was not
rerun: this fix changes neither persistence nor lifecycle/locking/evidence rules.
The earlier 81-test PostgreSQL result remains dated evidence.

## Evidence and next review

The portable sanitized ledger is `docs/evidence/phase-02/viewer-csp-fix.json`.
Raw logs and pre-repair files are local-only under `work/viewer-csp-fix/`.
Commands: `npm run verify` and, with explicit disposable-fixture acknowledgement,
`ODDPATH_BROWSER_DOCKER_TESTS=1 node --test --test-timeout=240000 apps/browser-runtime/tests/docker.integration.mjs`.
The negative pair also uses `--test-name-pattern='renders the real owner-scoped'`.

Review the image-only CSP change, actual red-to-blue regression, pinned source
match and physical Stop cleanup before deciding Phase 02 closeout. Login/control,
product resources/tabs and stages 3-8 remain pending. This work includes no commit,
push, deployment, production v2 activation, paid AI call or working-database change.
