# Oddpath Phase 05 — independent repair review

Date: 2026-10-14. Decision: **PASS within the three repaired findings.** No actionable new findings were established. Public activation remains **NO_GO**.

## Findings checked

- **F1 — account v3 private-file contract: accepted.** The importer derives the flag from referenced, MIME/size/checksum-validated QA files together with legacy binaries. The real account service round-trips QA-only archives. Mixed and two-project archives pass. False manifest claims, stray files, tampered content, a forged MIME claim, and cross-project duplicate file references are rejected. Imported QA stays inert; no live asset or execution authority is restored.
- **F2 — environment length: accepted.** Request, provenance and history use the same 500-character bound. Real PostgreSQL result recording and export/import preserve 121- and 500-character Arabic descriptions. Maintained checks cover the full supported bound and reject oversized provenance.
- **F3 — external screenshots: accepted.** HTTPS references without URL credentials satisfy screenshot requirements without an upload. Invalid history cannot conceal a later valid record, and multiple proofs for one requirement do not cover a different missing requirement. Expired or detached local files still block the same evidence even when it has an external link. The actual UI agrees with these rules. Both generic and Runner counting implementations were inspected.

## Fresh verification

| Check | Passed |
| --- | ---: |
| Focused contracts, portability, evidence, resources and Runner tests | 157 |
| Additional independent archive cases | 3 |
| Full maintained PostgreSQL integration suite | 105 |
| Additional independent PostgreSQL cases | 5 |
| Actual Vue/Chromium resource UI | 19 |
| **Total** | **289** |

All fresh tests passed with no failures, cancellations or skips. Disposable migration deployment and dump/restore passed, including the three Phase 05 schema columns. UI coverage includes expired and external proof, historical export, owner/late-response boundaries, retained drafts and controller scope, Arabic/German/English at mobile and desktop sizes, private-login keyboard focus, production CSP, viewer failure and consent preservation. No contract rebuild overlapped the UI run.

The repair's prior full-check/build logs match their recorded hashes. They are retained dated evidence, not reruns in this review. A node-postgres deprecation warning occurred in independent DB cases without a test failure.

## Integrity and cleanup

All **269** inventoried source/test/document files matched the repair ledger before review and remained byte-for-byte unchanged afterward. The repair ledger and Git status also remained unchanged. Only ignored scratch tests/logs and this external report/evidence were written. The owned temporary database was removed; no review Node test processes or default fixture listener remained.

## Remaining boundary

These repairs are accepted for local Phase 05 closeout. The existing project checkpoints were not rewritten by this review. The next planned work is Phase 06 (model selection, durable quotas, public authentication/email and abuse limits), followed by readiness and operational release gates. This review does not start that implementation.

Real R2 interruption/recovery, a new Docker Chrome/noVNC run, deployment and public activation were not performed. QA import remains explicitly limited to inert history/descriptors, with binaries retained in the user's ZIP. The working application database was not migrated. No public release-readiness claim follows from these local checks.

Evidence: [machine-readable review evidence](./independent-repair-review.json). Scratch cases and logs: work/phase-05-repair-review-20261014/.

