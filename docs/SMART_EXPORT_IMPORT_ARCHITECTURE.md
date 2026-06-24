# Smart Export / Import Architecture

> Status: Phase 0 review completed; implementation order accepted.
>
> Last reviewed: 2026-06-24.
>
> This document defines the architecture and implementation order only. It does
> not authorize application-code changes by itself.

## Goal

Build a smart, extensible Export / Import system for projects, memory, chats,
conversations, and later account-level data.

The system already supports basic chat import/export in JSON, Markdown, TXT,
and CSV. The goal is not to rewrite that flow. The first real portable MVP is
Project ZIP export/import because project metadata, instructions, memory,
documents, and chats are already server-persisted and owner-scoped.

The system will also introduce a deterministic planning layer that decides the
safest and most useful export container/format based on:

* Export subject
* User intent
* Presence of attachments
* Presence of tables
* Presence of project documents
* Need for restore/import
* Need for human-readable archive
* Need for external tool integration

This document is the source of truth for the implementation sequence,
portability contract, and import/export safety boundaries.

---

## Phase 0 Review Result

The current implementation review established:

* Existing chat export supports JSON, Markdown, TXT, and CSV.
* Existing chat import accepts JSON and creates a new local chat identity.
* Signed-in chats are persisted, but chat attachments are currently retained
  as metadata such as name, type, and MIME type. The original attachment bytes
  are not persisted as portable files.
* Project metadata, Project Instructions, Project Memory, Project Documents,
  and project-linked chats are already stored as owner-scoped server data.
* Project Documents retain their authoritative content and can be exported.
* Project Document chunks, embeddings, hashes, and index lifecycle fields are
  derived retrieval state and can be rebuilt.
* Conversation Summary is derived chat continuity and can be regenerated from
  canonical conversation content.

Consequences:

1. Project Portable ZIP Export is the first implementation slice.
2. Project Import is split into a read-only Preview and a separate Commit.
3. Project Import MVP always creates a new project.
4. Full Conversation ZIP is deferred until chat attachment persistence exists.
5. Account Memory portability follows the project round trip.
6. Account ZIP, PDF, and external adapters remain later phases.

---

## Core Principles

### Deterministic Planning

Smart Export is not AI-based in the current architecture.

It uses a deterministic planner with explicit rules. The planner inspects the
subject, intent, available canonical data, requested readable artifacts, and
known limitations. It returns an Export Plan and warnings. It does not infer
data, summarize content through an AI provider, or silently alter stored data.

Smart Export should produce an **Export Plan**, not blindly force one format.

The system should recommend the best default, but the user may still choose supported formats when safe.

Example:

* Text-only chat + backup intent → JSON
* Text-only chat + readable intent → Markdown
* Project portable export → ZIP
* Future chat with persisted attachments → ZIP
* Project export → ZIP
* Later account export → ZIP
* Tables → CSV files inside ZIP when needed
* PDF → readable archive only, not an import source
* Jira, GitHub Issues, or Linear → target-specific adapter, later phase

### Portable Source Of Truth

JSON inside the ZIP is the source of truth for validation and restoration.
Markdown is a readable companion only. PDF is a readable artifact only and is
never an import source.

### Create-New Import

The Project Import MVP creates a new project with new local identifiers. It
does not overwrite, update, or merge with an existing project.

### Owner-Scoped Access

Every export, preview, and commit operation must be authenticated and
owner-scoped. The user may export or import only into their own account, and
project export must pass the existing project access boundary.

---

## Canonical And Derived Data

Portability packages must distinguish authoritative product data from state
that can be regenerated.

### Canonical Project Data

The Project ZIP source-of-truth JSON may include:

* Project name, description, and portable timestamps.
* Project Instructions, when present.
* Project Memory content and provenance, when present.
* Project Documents:
  * title
  * content
  * source/provenance
  * MIME type
  * portable file metadata
  * created and updated timestamps where useful
* Project-linked chats when selected:
  * title
  * mode
  * model
  * messages
  * portable attachment metadata only
* Source identifiers for traceability only. Import must generate new database
  identifiers.

Imported Project Memory and Project Documents must be stored with
`provenance = IMPORTED`, regardless of their source-package identifiers.
Original provenance may be retained separately as informational import
metadata if needed later.

### Derived Data

Do not export the following as restorable state:

* Conversation Summary.
* Project Document chunks.
* Embeddings and embedding-provider metadata.
* Document content hashes used for indexing.
* Chunking versions.
* Index status, index errors, or indexed timestamps.
* Retrieval caches or ranking results.

Imported documents must be re-indexed from canonical document content after
the database transaction succeeds.

### Sensitive And Operational Data

Never export:

* Usage events or AI usage logs.
* Sessions or session tokens.
* Password hashes.
* Password-reset or email-verification tokens.
* Provider API keys.
* Application secrets or server configuration.
* CSRF secrets, cookie secrets, SMTP credentials, or billing secrets.
* Internal data belonging to another user or project.

---

## Export Subjects

The system should support these subject levels.

### 1. Existing Chat Export / Import

The existing lightweight flow remains supported.

Used for:

* Exporting an answer or conversation.
* Saving a small interaction.
* Quick readable copy.
* Lightweight JSON/Markdown/TXT/CSV output.
* Importing the current supported chat JSON shape.

This flow is not the Project Portable MVP and should not be rewritten as part
of the first project portability slices.

---

### 2. Project Portable Export / Import

Project portability is the first real MVP.

Project export uses ZIP because it combines multiple resources:

* `manifest.json`.
* Canonical project JSON.
* Project Instructions.
* Project Memory.
* Project Documents.
* Optional project-linked chats.
* Readable Markdown companions.

Project import validates a Project ZIP, previews its contents without database
writes, then creates a new project only after explicit confirmation.

---

### 3. Account Memory Export / Import

Account Memory portability follows the Project ZIP round trip.

It should support a bounded, versioned JSON format for the signed-in user's
manual Account Memory records. Import must create new memory records with
`provenance = IMPORTED`, enforce the existing per-record limits, and present a
preview before writing.

Duplicate and conflict policy remains an open design question. Until that
policy is accepted, Account Memory import must not silently overwrite or merge
existing records.

---

### 4. Account ZIP Export

Used from Settings.

Account export is a later phase. It should use ZIP because it may contain
multiple projects, unassigned chats, Account Memory, settings, and documents.
Account ZIP import is not part of the first account portability phase.

Sensitive information should not be exported.

Do not export:

* Password hashes
* Sessions
* Reset or verification tokens
* Provider API keys
* Internal auth secrets
* Billing secrets
* Server-only config

---

### 5. Full Conversation ZIP / PDF

Full Conversation ZIP is deferred.

Chat attachments are currently persisted as metadata only, not as original
files. A portable Conversation ZIP must not claim to contain restorable
attachments until explicit chat attachment persistence is implemented.

After attachment persistence exists, a Conversation ZIP may include:

* canonical chat JSON
* readable Markdown
* persisted attachment files
* optional CSV table artifacts
* optional readable PDF

PDF remains readable only and is never accepted for import.

---

## Format Roles

### JSON

JSON is the source of truth for structured import/export.

Use JSON for:

* Backup
* Restore
* Import
* API-style data exchange
* Rebuilding conversations or projects programmatically

JSON may reference external files inside a ZIP.

Future persisted-attachment reference example:

```json
{
  "id": "m2",
  "role": "user",
  "content": "Please check this image.",
  "attachments": [
    {
      "id": "att1",
      "type": "image",
      "filename": "photo1.jpg",
      "path": "attachments/photo1.jpg",
      "mimeType": "image/jpeg"
    }
  ]
}
```

JSON alone is not enough when an export includes actual persisted files or
attachments. In that case JSON should live inside a ZIP.

---

### Markdown

Markdown is the preferred human-readable text archive.

Use Markdown for:

* Reading
* Sharing
* GitHub / VS Code / Obsidian / Notion-style workflows
* Preserving headings, code blocks, links, and simple tables

Markdown should not be the primary import format.

---

### TXT

TXT is a very simple plain-text fallback.

Use TXT for:

* Minimal readable export
* Environments that do not handle Markdown well
* Copy/archive scenarios with no formatting needs

TXT should not be the primary import format.

---

### CSV

CSV is for rows and columns.

Use CSV when:

* The conversation contains structured tables
* The assistant produced tabular artifacts
* The data is naturally row/column-based
* The user is exporting for tools that prefer CSV
* A later adapter targets tools like Jira, issue trackers, CRMs, or spreadsheets

CSV should not be used for full conversation restore.

CSV files may be placed inside ZIP under:

```txt
tables/table_001.csv
tables/table_002.csv
```

---

### PDF

PDF is a readable archive format.

Use PDF for:

* Sharing a conversation or project summary visually
* Printing
* Archiving readable output
* Including rendered images when possible

PDF is not an import/restore source.

If there are attachments or raw files, PDF should be included inside a ZIP, not replace the ZIP.

Example:

```txt
chat_export.zip
├─ manifest.json
├─ chat.json
├─ chat.md
├─ chat.pdf
└─ attachments/
```

---

### ZIP

ZIP is the portable container.

Use ZIP when:

* There are attachments
* There are images, files, or media
* There are tables that produce CSV files
* The export contains more than one file
* The export is an eligible full conversation with persisted files, a project,
  or an account-level package
* The user chooses full portable export

A ZIP should include:

* `manifest.json`
* JSON source of truth
* Markdown readable copy when useful
* PDF readable copy when requested
* CSV tables when present
* Attachments/documents when present

---

## Manifest

Every ZIP export should include `manifest.json`.

The manifest describes:

* `formatVersion`
* package type
* exported timestamp
* app version if available
* subject metadata
* included files
* per-file digest where applicable
* package counts
* warnings
* compatibility notes

`formatVersion` versions the portable package contract, not the application or
database schema. Importers must reject unsupported major versions. Backward-
compatible additions may use a minor version.

Initial version:

```txt
formatVersion: "1.0"
```

Example:

```json
{
  "formatVersion": "1.0",
  "exportedAt": "2026-06-24T10:00:00.000Z",
  "type": "project_export",
  "subject": {
    "kind": "project",
    "sourceId": "project_123",
    "name": "Checkout QA"
  },
  "contains": {
    "json": true,
    "markdown": true,
    "pdf": false,
    "documents": true,
    "chats": true
  },
  "files": [
    {
      "path": "data/project.json",
      "sha256": "..."
    },
    {
      "path": "readable/project.md",
      "sha256": "..."
    }
  ],
  "counts": {
    "documents": 3,
    "chats": 5
  },
  "warnings": [
    "Chat attachment metadata is included, but original attachment files are not available."
  ],
  "compatibility": {
    "minimumImporterFormatVersion": "1.0"
  }
}
```

---

## ZIP Safety And Limits

Import must apply limits before extracting or parsing package content. The
first implementation should define shared constants and tests for:

* Maximum compressed upload size: **50 MB**.
* Maximum total uncompressed size: **200 MB**.
* Maximum ZIP entries: **1,000**.
* Maximum individual entry size: **25 MB**, while imported Project Documents
  must still satisfy their stricter active product limits.
* Maximum path length: **240 characters** after normalization.
* Maximum nesting depth: **10 path segments**.
* No absolute paths.
* No Windows drive prefixes.
* No `..` path traversal segments.
* No symbolic links, hard links, device files, or executable archive entries.
* No duplicate normalized paths, including case-insensitive conflicts.
* No encrypted ZIP entries in the MVP.
* No nested archives in the MVP.

Limits are compatibility and abuse-protection rules, not permission to bypass
existing domain validation. Project names, instructions, memory, documents,
chats, messages, and file types must also pass their current application
schemas and per-field limits.

The importer should calculate a SHA-256 digest for the uploaded package during
Preview. Commit must receive or recompute the same digest and reject the
operation if the bytes changed.

---

## Suggested ZIP Structures

### Future Full Conversation ZIP

```txt
chat_export.zip
├─ manifest.json
├─ chat.json
├─ chat.md
├─ chat.pdf
├─ tables/
│  └─ table_001.csv
└─ attachments/
   └─ image_001.png
```

This structure is deferred until attachment persistence exists. `chat.pdf` is
optional, readable only, and never a restore source.

---

### Project ZIP MVP

```txt
project_export.zip
├─ manifest.json
├─ data/
│  ├─ project.json
│  └─ chats/
│     └─ chat_001.json
├─ documents/
│  ├─ document_001.md
│  └─ imported_file_002.json
└─ readable/
   ├─ project.md
   ├─ instructions.md
   ├─ memory.md
   └─ chats/
      └─ chat_001.md
```

`data/project.json` is the source of truth. The `readable/` files are
convenience artifacts only. The MVP does not include original chat attachment
files because they are not currently persisted.

---

### Later Account ZIP

```txt
account_export.zip
├─ manifest.json
├─ account.json
├─ settings.json
├─ memories/
│  └─ account_memory.json
├─ projects/
│  └─ project_001/
│     ├─ project.json
│     ├─ instructions.md
│     ├─ memory.md
│     ├─ documents/
│     └─ chats/
└─ chats/
   └─ unassigned_chat_001.json
```

Account export should exclude sensitive server-side secrets.

---

## Export Planner

Introduce a deterministic export planning layer.

The planner is a pure decision component. It does not call an AI provider,
read or write the database, create files, or execute exports. Export services
execute the accepted plan.

Suggested type:

```ts
type ExportSubject =
  | "conversation"
  | "project"
  | "account_memory"
  | "account";

type ExportIntent =
  | "backup"
  | "readable"
  | "plain_text"
  | "full"
  | "tables"
  | "external_tool";

type ExportContainer =
  | "single_file"
  | "zip";

type ExportFormat =
  | "json"
  | "markdown"
  | "txt"
  | "csv"
  | "pdf"
  | "zip";

type ExportPlan = {
  subject: ExportSubject;
  intent: ExportIntent;
  container: ExportContainer;
  primaryFormat: ExportFormat;
  include: {
    json: boolean;
    markdown: boolean;
    txt: boolean;
    csvTables: boolean;
    pdf: boolean;
    attachments: boolean;
    documents: boolean;
    projectMemory: boolean;
    projectInstructions: boolean;
    accountSettings: boolean;
  };
  reason: string;
  warnings: string[];
  blockers: string[];
};
```

The first planner implementation needs to cover Project ZIP export and existing
chat export compatibility. Conversation ZIP, Account ZIP, PDF, and external
adapters may extend the same contract later.

---

## Smart Export Rules

### Conversation

Keep the current text-oriented behavior:

* backup intent → JSON
* readable intent → Markdown
* plain text intent → TXT
* table intent → CSV if structured rows exist

If a full portable conversation is requested and messages contain attachment
metadata, return a blocker/warning that original files are not currently
portable. Do not produce a misleading full ZIP. Conversation ZIP becomes
eligible only after chat attachment persistence is implemented.

---

### Project

Project export should default to ZIP.

Include:

* `manifest.json`.
* canonical `data/project.json`.
* readable `readable/project.md`.
* readable Instructions and Project Memory files when present.
* canonical Project Document content and metadata.
* project-linked chats when requested.
* warnings for chat attachment metadata that has no persisted file.

Do not include Conversation Summary, document chunks, embeddings, or index
state.

---

### Account Memory

Account Memory may use versioned JSON for export/import because it is a bounded
list of text records. Import remains preview-first and creates imported records
without silently replacing existing memory.

---

### Account ZIP

Account ZIP is a later export-only phase.

Include:

* manifest.json
* account.json
* settings.json
* account memories
* projects
* unassigned chats if requested

Exclude sensitive auth/server data and all operational/usage records.

---

## Import Rules

### Project Import Preview

Preview is mandatory and performs no database writes.

Preview must:

* authenticate the user
* enforce ZIP size and entry limits
* normalize and validate every archive path
* require `manifest.json`
* validate `formatVersion`
* validate the manifest and canonical project JSON schemas
* verify every referenced file exists
* verify declared file digests
* reject undeclared or prohibited executable entries
* enforce current project, memory, instruction, document, chat, and message
  limits
* report unsupported or omitted fields
* report unavailable chat attachment files
* calculate the whole-package SHA-256 digest
* return a bounded preview containing:
  * proposed project name
  * document count
  * chat count
  * instructions/memory presence
  * warnings
  * blockers
  * package digest

Preview must not reserve identifiers, create temporary database records, update
existing data, index documents, or call an AI provider.

---

### Project Import Commit

Commit is a separate explicit user action.

Commit must:

* authenticate the user again
* re-read and revalidate the package instead of trusting the Preview result
* recompute the package digest and require it to match the confirmed Preview
  digest
* create a new project with new local identifiers
* restore canonical Project Instructions, Project Memory, Project Documents,
  and selected chats
* set imported Project Memory and Project Documents provenance to `IMPORTED`
* map source identifiers to new identifiers only inside the import operation
* persist canonical records in one database transaction
* roll back all canonical database writes if any required record fails
* start Project Document re-indexing only after the transaction succeeds
* return the new project identity and any post-commit indexing warnings

The MVP must not overwrite, update, merge, or deduplicate against an existing
project. A name collision does not imply identity; the imported project is a
new project and may receive an explicit imported suffix if the UI chooses.

Document indexing is derived work. If indexing fails after commit, the new
project and authoritative documents remain available with a visible warning
and the existing retry/index lifecycle.

---

### Account Memory Import

Account Memory import follows the same Preview/Commit separation.

The initial flow may use versioned JSON rather than ZIP. Preview validates
record counts, content limits, provenance, duplicates, and conflicts without
writes. Commit revalidates the same payload/digest and creates imported memory
records only.

The accepted duplicate/conflict UX must be documented before implementation.

---

### Existing Chat JSON Import

The current simple Chat JSON import remains supported. It is separate from the
Project ZIP contract and does not imply support for restoring original chat
attachment files.

---

### Markdown / TXT Import

Markdown and TXT are readable archive formats, not primary restore formats.

Do not support full restore from Markdown/TXT in the MVP.

---

### CSV Import

CSV import is allowed only for specific structured flows.

Examples:

* tables
* tasks
* issues
* future external tool adapters

Do not use CSV to restore a full conversation.

---

### PDF Import

PDF is never an import source.

---

## Security Rules

Import must protect against:

* path traversal inside ZIP
* ZIP bombs and excessive compression ratios
* excessive entry counts and nesting depth
* duplicate or case-conflicting normalized paths
* unsupported MIME types
* oversized files
* malformed JSON
* unsupported `formatVersion` values
* digest mismatches between Preview and Commit
* executable attachments
* ownership bypass
* cross-user or cross-project data references
* unexpected database writes during Preview

Export must avoid leaking:

* auth secrets
* sessions
* password hashes
* reset and verification tokens
* provider API keys
* internal server config
* private data from other users/projects
* usage events and AI usage logs
* derived retrieval and indexing state

All export/import operations must be owner-scoped. Package identifiers are
untrusted external data and must never be treated as authorization evidence.

---

## External Tool Adapters

External tools should be implemented as adapters, not mixed into the core export logic.

Future adapters may include:

* Jira
* GitHub Issues
* Linear
* Notion
* generic CSV
* generic JSON API payload

### Jira

Jira should not be part of the first MVP unless explicitly prioritized.

Future Jira exports may produce:

```txt
jira_export.zip
├─ jira_import.csv
├─ jira_payloads.json
└─ attachments/
```

Manual Jira import:

* CSV

Jira API import:

* JSON payloads

Attachments require ZIP.

---

## Phased Implementation Plan

### Phase 0 — Review Current Export/Import

Status: completed on 2026-06-24.

The accepted findings and consequences are recorded in the Phase 0 Review
Result section above. No application code or refactor was part of Phase 0.

---

### Phase 1 — Project Portable ZIP Export

Status: completed on 2026-06-24.

The backend now exposes an owner-scoped Project ZIP export with canonical JSON,
readable Markdown, Project Document files, optional project chats, per-file
SHA-256 metadata, and explicit warnings when chat attachment metadata has no
persisted file bytes. The implementation uses the small zero-dependency
`fflate` package and currently builds the ZIP in API-process memory.

Goals:

* [x] add the deterministic Project export plan
* [x] define and validate `formatVersion: "1.0"`
* [x] create `manifest.json`
* [x] export canonical `data/project.json`
* [x] export Project Instructions and Project Memory when present
* [x] export canonical Project Document content without derived index state
* [x] optionally export project-linked chats
* [x] include readable Markdown companions
* [x] include file digests and package warnings
* [x] preserve existing chat import/export behavior
* [x] enforce owner-scoped Project access
* [x] test that sensitive and derived data are absent

---

### Phase 2 — Project Import Preview

Status: completed on 2026-06-24.

The backend now exposes authenticated, read-only package inspection through
`POST /api/portability/projects/import/preview`. The route accepts
`application/zip` and `application/octet-stream` through a route-specific raw
body parser capped at 50 MB. Preview performs no project access lookup,
repository call, database write, identifier reservation, indexing, or AI
provider work.

The implementation inspects the ZIP central directory before decompression,
enforces entry/path/compressed/uncompressed limits, rejects duplicate and
case-conflicting paths, validates the strict current manifest/project/chat
schemas, verifies declared SHA-256 hashes and counts, then returns a
whole-package SHA-256 digest for the future Commit slice. Safe undeclared ZIP
entries are reported through `unsupported`; invalid or incompatible packages
receive one bounded validation error without parser internals.

Goals:

* [x] enforce ZIP and path-safety limits
* [x] validate `manifest.json` and `formatVersion`
* [x] validate canonical schemas and referenced files
* [x] verify per-file digests
* [x] calculate the package SHA-256 digest
* [x] report counts, warnings, and unsupported data
* [x] perform zero database writes
* [x] require an authenticated destination account

---

### Phase 3 — Project Import Commit As Create-New Project

Add the explicit confirmed import action.

Goals:

* re-read and fully revalidate the package
* require the Preview digest to match
* create a new project only
* generate new identifiers
* restore Instructions, Memory, Documents, and selected chats
* mark imported Project Memory and Project Documents as `IMPORTED`
* commit canonical records transactionally
* perform no overwrite, merge, or implicit deduplication
* trigger document re-indexing only after transaction success
* surface post-commit indexing failures without deleting canonical data

---

### Phase 4 — Account Memory Export / Import

Add a bounded versioned Account Memory portability flow.

Goals:

* export signed-in Account Memory records to canonical JSON
* preview import without writes
* revalidate payload and digest during Commit
* create imported memory records with `IMPORTED` provenance
* enforce current item and content limits
* apply an accepted duplicate/conflict policy
* remain owner-scoped

---

### Phase 5 — Account ZIP Export

Add account-level export from Settings later.

The ZIP may include:

* export-safe account profile fields
* settings
* Account Memory
* projects using the accepted Project ZIP contract
* unassigned chats when selected

Account ZIP import is not included in this phase. Sensitive, operational, and
derived state remains excluded.

---

### Phase 6 — Chat Attachment Persistence

Persist original chat attachment files behind an explicit storage and retention
policy.

This phase must define:

* authorized file ownership
* storage backend abstraction
* upload and download limits
* retention and deletion behavior
* malware/content-type controls
* portability references
* production backup implications

Conversation ZIP must remain deferred until this foundation exists.

---

### Phase 7 — Conversation ZIP, PDF, And External Adapters

After attachment persistence:

* add full Conversation ZIP
* include canonical JSON and persisted attachment files
* include readable Markdown
* optionally include readable PDF
* optionally include CSV table artifacts
* add Jira, GitHub Issues, Linear, or other target-specific adapters only when
  prioritized

PDF remains non-importable. External adapters stay separate from the core
portable package contract.

---

## Final MVP Scope

The first complete MVP is the Project portability round trip:

1. Project Portable ZIP Export.
2. Project Import Preview with no database writes.
3. Project Import Commit that creates a new project.

The MVP includes:

* deterministic planning
* `formatVersion: "1.0"`
* `manifest.json`
* canonical project JSON as the restore source
* readable Markdown companions
* Project Instructions
* Project Memory
* Project Documents
* optional project-linked chats
* owner-scoped authorization
* ZIP/path/size validation
* Preview/Commit digest matching
* transactional canonical writes
* imported provenance
* post-transaction Project Document re-indexing

Account Memory portability is the next bounded phase after the Project round
trip and is not required to call the Project MVP complete.

---

## Non-Goals For The Project MVP

Do not implement all formats for all subjects immediately.

MVP should not include:

* AI-based export planning
* full Conversation ZIP
* original chat attachment export
* chat attachment persistence
* Conversation Summary restore
* document chunk, embedding, or index-state restore
* project overwrite
* project merge
* account ZIP export/import
* Account Memory import until Phase 4
* Jira adapter
* GitHub Issues adapter
* Linear adapter
* Notion adapter
* PDF generation
* PDF import
* Markdown full restore
* TXT full restore
* CSV conversation restore
* server secrets export
* usage-event export
* automatic upload to external tools

---

## Acceptance Criteria

The Project MVP is successful when:

* Existing export/import still works.
* The deterministic planner produces a Project ZIP plan and warnings.
* Project export creates a valid ZIP with `manifest.json`.
* `data/project.json` is sufficient to recreate the canonical project data.
* Markdown files are readable companions and are not used for restoration.
* Export excludes secrets, usage data, Conversation Summary, chunks,
  embeddings, and index state.
* Preview validates schema, version, ownership, paths, sizes, entries, and
  digests without database writes.
* Commit rejects changed package bytes or a digest mismatch.
* Commit creates a new project and never overwrites or merges.
* Imported Project Memory and Project Documents use `IMPORTED` provenance.
* Canonical writes are transactional.
* Document re-indexing starts only after transaction success.
* Indexing failure does not destroy imported canonical data.
* Tests cover planner decisions, export exclusions, ZIP safety, Preview
  no-write behavior, digest revalidation, owner isolation, rollback, and the
  project round trip.

---

## Remaining Open Questions

These questions do not block the accepted phase order, but must be answered
before their relevant implementation slice:

1. Should Project ZIP include project-linked chats by default, or require an
   explicit checkbox?
2. What are the maximum Project Document count and total canonical content
   size inside one imported project, in addition to the global ZIP limits?
3. Should imported project names always receive an `(Imported)` suffix, only
   on collision, or never automatically?
4. Should original provenance be retained in import metadata while canonical
   Project Memory and Project Documents use `IMPORTED`?
5. Should Project Document re-indexing run synchronously after commit or use
   the existing best-effort lifecycle with a visible pending state?
6. What duplicate/conflict policy should Account Memory import use:
   skip exact duplicates, import all, or require per-item review?
7. Which account settings are portable in the later Account ZIP export, and
   which are device/environment-specific?
8. Which storage and retention policy should be selected before chat
   attachment persistence?
