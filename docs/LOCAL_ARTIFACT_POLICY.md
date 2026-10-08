# Local artifacts and commit preparation

The repository keeps application code, maintained test harnesses, and reviewed
documentation. `work/` is local scratch space for generated runs and one-off
operational helpers. It is ignored as a directory; its contents remain on disk.
The root `debug.log` is also ignored. Existing exclusions for environment files,
local Runner profiles, generated code, dependencies, and build output remain in
place.

## Scope checked on 2026-10-05

Before adding the exclusions, `git ls-files -- work` returned **0 tracked files**
and `git ls-files --others --exclude-standard -- work` returned **4,560 files**:

| Kind | Count |
| --- | ---: |
| PNG screenshots | 4,397 |
| JPG screenshots | 31 |
| Logs | 84 |
| JSON run reports and audit fixtures | 25 |
| One-off JavaScript helpers (`mjs` / `cjs`) | 14 |
| HTML prototypes | 4 |
| Markdown reports | 3 |
| PDF / TXT fixtures | 2 |

The already-ignored `work/local-db-backups/` was outside that untracked count.
File names and Git metadata were sufficient for this inventory; it was not a
content-level secret audit. The count is a dated inventory, not an expected
steady-state value: subsequent runs add files.

The maintained source and package/configuration files do not import the helpers
under `work/`. Four browser harnesses write their output there:

- `apps/web/scripts/qa-focus-smoke.mjs`
- `apps/web/scripts/session-tools-smoke.mjs`
- `apps/web/scripts/test-session-smoke.mjs`
- `apps/web/scripts/ux-navigation-smoke.mjs`

Those harnesses, application source, tests, Prisma migrations, documentation,
and `apps/runner/oddpath.runner.example.json` remain eligible for version control.
The 2026-10-07 publication review excludes the two historical `qa-critical-flow`
and `qa-workspace` previews, their HTML entry points and named design boards.
They have no application or maintained-test imports and remain preserved locally;
the exact paths are ignored to prevent a later accidental bulk addition.
Ignoring generated output does not change how a harness runs or saves reports.

## Local-only material

Keep these materials under the ignored `work/` directory:

- Timestamped screenshot runs, raw browser logs, and intermediate reports.
- Local database backups, restore fingerprints, and activation snapshots.
- Audit account data, authentication state, Runner credentials/configuration,
  and fixtures that may contain local account or session information.
- One-off database activation/read-only inspection helpers and audit servers.
- Historical prototypes and their local review images.

Local helpers are preserved, not deleted or treated as supported public tools.
Before reusing one from another checkout, review its configuration, credentials,
data scope, and side effects. A helper needed for repeatable verification should
be generalized into `apps/api/scripts/` or `apps/web/scripts/`, with explicit
configuration and documented invocation. Do not publish a private helper merely
to make a historical link resolve.

## Evidence intended to travel with the repository

Use `docs/evidence/<topic>/` for a small, explicitly reviewed evidence set. This
location is not ignored. Include only the final screenshots or sanitized reports
needed to explain a result, preferably from isolated fixtures. Record the test
command, fixture scope, relevant dimensions/language/theme, outcome, and limits
in the accompanying Markdown document.

Review images and report text for account details, real project content, tokens,
URLs containing credentials, local paths, and browser storage before copying
anything into that directory. Raw logs and private database exports are not
curated evidence. Do not use `git add -f work` to bypass the policy.

Existing checkpoint documents link to paths under `work/`. These are **local-only
evidence links**: they work in the original workspace while the files are kept,
but will not resolve in a fresh clone. Their written outcomes and limits remain
part of the documentation. Before publishing a document that requires its
images, either select and review a small evidence set under `docs/evidence/` and
update its links, or label the image links as local-only. No image has been
promoted to public evidence by this policy change.

The subsequent `SESSION_CLOSEOUT.md` and `SESSION_LIVE_CLOSEOUT.md` select three
inspected images under `docs/evidence/session-closeout/`: two synthetic-fixture
Integrations views and one isolated audit report. They record the source runs,
scope and limits; that small selection does not promote the remaining raw runs.

## Commit review policy

The exclusions remove accidental bulk additions; they do not certify every
other changed file as ready to publish. Review selected application changes,
migrations, documentation and curated evidence, then the actual staged diff
and file list when staging is authorized. Confirm that no private artifacts were
previously tracked outside `work/`, and inspect intentional additions for secrets.
The separately authorized 2026-10-07–08 review is recorded in
`PRE_COMMIT_REVIEW.md`; historical local-only checkpoints are not new Git authority.

This policy change does not delete, move, stage, commit, or push files. It also
does not apply database migrations or modify application data.
