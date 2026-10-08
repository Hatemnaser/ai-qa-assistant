# Accumulated session work: publication review

Review dates: 2026-10-07–08. Baseline: `08c4f35` (`main` / `origin/main`).

The owner authorized an MR-style review, fixes, a commit and a review-branch
push. This is not permission to merge, deploy, execute another paid AI audit,
or modify the owner's approved QA records. Earlier local-only checkpoint
restrictions describe their original work; this review is the publication gate.

## Scope and findings

The review covers the accumulated managed-session migration, server-owned turns,
timeline, QA approvals and preparation, unified session UI, drafts, project
organization, session tools, account isolation, portability and compatibility.
Independent reviews covered backend, storage/concurrency and frontend behavior.

Concrete findings addressed during this review:

1. **Persisted draft overwrite:** a fresh page could transfer an unscoped draft
   over an existing project's IndexedDB draft without loading it first. Read
   the destination before transfer, retain both drafts and reject stale reads.
2. **Stale worker claim:** a worker's old PENDING snapshot could claim a newer
   expired PROCESSING turn and repeat a provider call. Claim against the exact
   selected state/lease/retry identity; uncertain provider results still require
   explicit retry. Three new concurrency regressions cover the race.
3. **Pre-body admission gap:** compatibility turn routes and method-substituted
   bodies bypassed the shared admission gate. Both route families now use the
   same middleware before JSON parsing, with regression coverage.
4. **Moving an open session:** route scope and private draft keys could retain
   the previous project after a successful sidebar move. This review includes
   an explicit move acknowledgement and guarded draft rekey; arbitrary
   wrong-project links must still fail closed.
5. **Dependency gate:** the first production audit reported ten advisories,
   including high/critical dependencies. Targeted updates now pass the audit
   with zero reported vulnerabilities. No broad `audit fix --force` was used.

Security updates: MCP SDK 1.32.1, DOMPurify 3.4.16, aligned Vue 3.5.43 packages,
Nodemailer 10.0.16 (bundled types replace `@types/nodemailer`), and compatible
lockfile patches for proxy-addr, source-map-js, fast-uri, hono and ip-address.
The Vue compiler's compatible Babel/PostCSS dependency updates are included.
Node 24.19 remains the supported runtime. Nodemailer's major update is covered
by an offline real-package `jsonTransport` test for both auth messages; no email
was sent. Maintainer notes: [Nodemailer](https://github.com/nodemailer/nodemailer/blob/master/CHANGELOG.md),
[MCP SDK](https://github.com/modelcontextprotocol/typescript-sdk/releases/tag/1.32.0),
[proxy-addr](https://github.com/jshttp/proxy-addr/releases/tag/v2.0.8).

## Verification ledger

The final local regression gates below completed on 2026-10-08. Remote CI is a
separate publication check, not implied by these local results.

- Focused API admission/worker checks: **47/47** passed.
- Offline auth-email compatibility: **11/11** passed after dependency updates.
- Focused draft/move/controller/shell/sidebar/i18n checks: **107/107** passed;
  frontend types passed. Cases include cached and never-mounted editors,
  destination collisions, account/navigation races and attachment URL cleanup.
- Fresh disposable PostgreSQL 16: all **23 migrations** applied; history/schema
  drift check passed; **35/35** database regressions passed. The first attempt
  stopped at environment validation (AI disabled but guest AI inherited true);
  retry explicitly disabled both. The final replay after the clean dependency
  install also passed all 35 tests. No application assertion was weakened.
- Production and full (including development) dependency audits after patches:
  **zero vulnerabilities** reported.
- Clean `npm ci --include=dev` passed on Node **24.19.0** / npm **11.12.1**.
- Final `verify`: **1,642/1,642** (contract 4, API 984, Runner 18, web 636),
  zero failures/skips; separate i18n **8/8**. API and Runner production builds
  passed. The first web-build attempt correctly rejected the local HTTP API
  setting; the final retry **passed** using CI's `https://api.test.example`
  origin without changing `.env` or weakening the HTTPS header gate.
- Isolated browser verification: **9 critical journeys + 71 read-only cases**
  passed, with no runtime errors. The new move regression retains an unsent
  message and TXT attachment after moving the open session and reloading,
  with exactly one metadata PATCH and no message, upload or QA side effects.
- The 71-case set includes 48 locale/theme/viewport combinations: en/ar/de,
  light/dark, widths 1440/1024/992/991/390/320 and short 390x667/320x568 phones.
  Representative final screenshots were inspected manually (Arabic short-phone
  writer and account menu, German results drawer, desktop move restoration);
  this is not a claim that every generated screenshot was individually reviewed.
- Earlier full UI/visual/live results remain separately dated in
  `SESSION_CLOSEOUT.md` and `SESSION_LIVE_CLOSEOUT.md`; they are not substituted
  for the final regression pass here.

Private logs are under ignored `work/mr-review-20261007/`. They are local-only,
not expected to resolve in a clean clone. Final browser reports/images are under
`work/test-session-validation/2026-10-08T02-55-06-511Z/` and
`work/session-tools-validation/2026-10-08T02-55-21-070Z/` (also local-only).
The disposable test container and its
anonymous volume were removed after the database run. The normal database on
5432 and the preserved earlier audit container/data were not used.

## Publication contents

Publish application source, tests, two additive migrations, maintained browser
harnesses, reviewed documentation and three curated synthetic-audit screenshots
under `docs/evidence/session-closeout/`. Preserve, but do not publish:

- `eluthira-site/` (separate repository, no Git link).
- `.env*` secrets, local Runner profiles/tokens, dependency/build/generated output.
- `work/`, database archives, raw audit/authentication data, temporary helpers,
  raw screenshots, clipboard/remote attachments and `debug.log`.
- Historical `qa-critical-flow` / `qa-workspace` prototype entry points and
  source directories, plus their specifically named design boards/generator.

The product's public `oddpath.eluthira.com` domain in documentation is intentional;
it is not the separate Eluthira source repository. Private absolute workstation
paths in the reviewed docs were replaced with portable descriptions. Review the
actual staged paths and scan their content again before committing. A pattern
scan supplements manual review; it does not certify the absence of all secrets.

The final selected-file inventory contains **219 files**, including the three
curated images. An independent read-only privacy review found no publication
blocker. The publication target is `codex/unified-session-workspace`, not `main`.
Commit preparation uses an explicit file manifest (not a blanket `git add .`),
an index/content comparison and staged whitespace/exclusion/secret-pattern checks.

## Merge/deployment and deferred limits

- Two additive migrations must precede the new API. Drain old in-flight
  conversation/provider work before rollout: the migration cannot reconstruct
  provider-start markers for calls already running under older code.
- Merge and deployment remain owner actions; production readiness/backup/restore
  gates in `PRODUCTION_READINESS.md` still apply.
- The UI model selection can still be silently overridden by server policy.
  This is a known behavior defect explicitly deferred by the owner to the next
  model/provider design conversation, not a claim that the chosen model ran.
- No extra live-provider, real SMTP, production-storage, real-device/keyboard,
  visible-browser, Android or new-integration testing is claimed.
- Existing frontend main-bundle size advisory (592.31 kB / 177.22 kB gzip in
  the final build) remains a follow-up, not hidden.
