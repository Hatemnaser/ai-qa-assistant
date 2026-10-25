# Phase 05 review repairs — 2026-10-14

The owner authorized repair of the three findings in the independent Phase 05
review. These changes remain local and await independent repair review before
closing stage 5 or starting stage 6. The original implementation and review
ledgers remain dated evidence. Public activation remains NO_GO.

## Account archive v3

The importer now derives the private-file manifest fact from the union of
legacy chat/document binaries and referenced, validated QA files in v3. QA file
paths are collected transiently during the existing path/MIME/size/checksum
validation, before imported descriptors become NOT_INCLUDED. These paths are
not persisted. Stray files cannot establish the manifest fact, conflicting
claims and modified files are rejected, and v1/v2 validation remains intact.

The tests exercise the real account export service with a QA-only PNG, mixed
legacy/QA archives, false manifest claims, unreferenced files and a checksum
tamper. QA import still creates inert history; original QA binaries remain in
the ZIP and are not restored to live storage.

## Environment descriptions

Request input, provenance and QA history now share the supported 500-character
environment limit. Existing descriptions remain complete, including in exported
history. The input and provenance schemas still reject values over the bound.
Real PostgreSQL coverage records results/evidence and exports a complete
500-character environment through the report reader.

## External screenshot evidence

A shared predicate recognizes HTTPS references without URL credentials. Both
the generic QA lifecycle and Runner finish path use it after filtering available
local bindings; the frontend uses the same content predicate. An external
screenshot without local files can satisfy its requirement. Any expired,
missing or detached local binding still blocks that evidence even when it has
a valid external link. All qualifying records are filtered before deduplicating
requirement ids, so an invalid historical reference cannot hide another valid
piece of proof for the same requirement.

Coverage includes HTTPS scheme case normalization, unsafe historical references,
finish followed by owner approval, expired local files with an external link,
and the actual historical resource reader. This preserves one session and one
QA controller; browser viewer/login/Stop behavior is unchanged.

## Verification and boundaries

Fresh results and file hashes are in `evidence/phase-05/review-fix-validation.json`.
All migration and PostgreSQL mutation checks use labeled disposable databases;
the working application database is not migrated. The UI fixture uses the real
Vue components and Chromium with synthetic API/viewer responses. A first UI run
overlapped shared-contract rebuilds and logged Vite HMR plus a viewer timeout;
the final UI run is isolated after checks and builds finish.

No real R2 mutation, paid AI call, deployment, public activation or new Docker
Chrome/noVNC proof is included. Those operating gates remain separate.
