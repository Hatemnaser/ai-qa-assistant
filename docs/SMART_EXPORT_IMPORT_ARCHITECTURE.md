# Smart Export / Import Architecture

> Status: Project portability and unified Account Export/Import are implemented,
> including bounded native v2 private files with v1 compatibility and staged
> restore. Production private assets remain fail-closed pending operational proof.
>
> Last reviewed: 2026-08-25.
>
> This document defines the architecture and implementation order only. It does
> not authorize application-code changes by itself.

## Goal

Build a smart, extensible Export / Import system for projects, chats,
conversations, complete account-level data, and external AI migration.

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
* Signed-in chat attachments and original Project Document sources can be
  persisted as private `StoredAsset` objects with normalized relations.
  Account/Project archive v2 carries eligible bytes; legacy v1 packages remain
  accepted. The lightweight standalone Chat JSON exporter remains text and
  metadata oriented.
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
4. Full Conversation ZIP remains a separate deferred product format even
   though signed-in attachment persistence now exists.
5. Full Account Data ZIP is the account-level feature exposed in Settings.
6. External AI imports use provider adapters and must not claim native account
   restoration when the destination provider does not support it.

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
  * attachment metadata
  * in v2, descriptors and separate `assets/` entries for exact eligible
    stored-asset relations
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

### 3. Full Account Data Export

The primary account-level product is a complete owner-scoped ZIP from Settings.

It includes:

* export-safe profile fields and settings
* canonical Account Memory
* projects, Project Instructions, Project Memory, and Project Documents
* all owned chats and messages, including project references
* readable Markdown companions
* provider-neutral conversation and memory reference files

It excludes sessions, credentials, tokens, usage events, Conversation Summary,
document chunks, embeddings, and index lifecycle state. Legacy v1 packages
carry no private-file entries. When eligible stored assets exist, v2 includes
validated descriptors and original bytes under bounded `assets/` paths.

---

### 4. External AI Chat Import

External migration is a provider-adapter concern, not a restore of foreign
account settings.

The first supported input adapters are:

* ChatGPT data-export ZIP files containing `conversations.json` or numbered
  conversation JSON files.
* Claude data-export ZIP files containing exported conversations.

This import is best-effort. It supports recognized conversation shapes and
supported user/assistant text only; it does not guarantee complete migration
of another provider account, settings, memories, attachments, tool output, or
every historical export variant.

Preview auto-detects or verifies the selected source, parses only supported
user/assistant text messages, reports counts and warnings, and performs no
database writes. Commit revalidates the same ZIP and digest and creates new
standalone chats with new local IDs in one transaction. Source IDs and model
names are trace metadata only.

Gemini Takeout import remains deferred because Google documents how to obtain
the archive but does not publish a stable import schema for third-party
parsers.

---

### 5. Full Conversation ZIP / PDF

Full Conversation ZIP is deferred.

Signed-in asset persistence now exists, but the lightweight Chat export/import
flow has not been upgraded into a full Conversation ZIP contract. It must not
claim restorable files until that separate package schema, relation validation,
Preview/Commit path, and UI are implemented. A future Conversation ZIP may
include:

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

Implemented native versions:

```txt
formatVersion: "1.0"  # legacy package with no binary entries
formatVersion: "2.0"  # bounded stored-asset descriptors and ZIP entries
```

Simplified Project v2 example:

```json
{
  "formatVersion": "2.0",
  "exportType": "project",
  "exportedAt": "2026-06-24T10:00:00.000Z",
  "projectId": "project_123",
  "projectName": "Checkout QA",
  "include": {
    "assets": true,
    "chats": true,
    "documents": true,
    "readable": true
  },
  "counts": {
    "assetBytes": 1024,
    "assets": 1,
    "documents": 3,
    "chats": 5,
    "messages": 20
  },
  "assets": [
    {
      "sourceAssetId": "asset_123",
      "sourceProjectId": "project_123",
      "purpose": "CHAT_ATTACHMENT",
      "binding": {
        "kind": "message_attachment",
        "sourceMessageId": "message_123",
        "ordinal": 0
      },
      "originalName": "screenshot.png",
      "mimeType": "image/png",
      "sizeBytes": 1024,
      "checksumSha256": "...",
      "file": {
        "path": "assets/001-screenshot.png",
        "sha256": "...",
        "sizeBytes": 1024
      }
    }
  ],
  "files": [
    {
      "path": "data/project.json",
      "sha256": "...",
      "sizeBytes": 2048
    },
    {
      "path": "assets/001-screenshot.png",
      "sha256": "...",
      "sizeBytes": 1024
    }
  ],
  "warnings": []
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

This structure remains deferred until the standalone Conversation ZIP schema,
Preview/Commit flow, and UI are implemented. `chat.pdf` is optional, readable
only, and never a restore source.

---

### Project ZIP MVP

```txt
project_export.zip
├─ manifest.json
├─ data/
│  ├─ project.json
│  └─ chats/
│     └─ chat_001.json
├─ assets/
│  └─ 001-screenshot.png
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
convenience artifacts only. Legacy v1 packages have no `assets/` directory.
Version 2 includes it only when eligible stored private files exist and binds
every descriptor to one canonical message attachment or Project Document
source.

---

### Full Account Data ZIP

```txt
account_export.zip
├─ manifest.json
├─ account.json
├─ settings.json
├─ assets/
│  └─ 001-screenshot.png
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

The implemented account export uses this concept with versioned canonical
JSON, readable Markdown, document content, and provider-neutral migration
reference files. Version 2 adds bounded stored-asset entries and exact
relational descriptors when present; version 1 remains importable. Both
versions exclude sensitive server-side secrets and derived state.

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
chat export compatibility. Full Account Data ZIP now extends the same
principles; Conversation ZIP, PDF, and work-management adapters remain later.

---

## Smart Export Rules

### Conversation

Keep the current text-oriented behavior:

* backup intent → JSON
* readable intent → Markdown
* plain text intent → TXT
* table intent → CSV if structured rows exist

If a full portable conversation is requested and messages contain attachment
metadata, do not present the lightweight Chat JSON/Markdown export as a full
file-restorable package. Direct users to the containing Project or Account v2
archive when applicable, or return an explicit blocker until the standalone
Conversation ZIP contract is implemented.

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
* bounded v2 `assets/` entries and exact relational descriptors when eligible
  stored files are present.
* warnings only when legacy metadata cannot be matched to a portable stored
  file.

Do not include Conversation Summary, document chunks, embeddings, or index
state.

---

### Full Account Data ZIP

Full Account Data ZIP is the primary account-level export.

Include:

* manifest.json
* account.json
* settings.json
* account memories
* projects
* unassigned chats if requested

Also include a provider-neutral `migration/conversations.json` and
`migration/account-memory.md`. These files are references for other AI tools;
they are not a promise that another provider will restore its native sidebar,
settings, subscriptions, memories, or projects.

Exclude sensitive auth/server data and all operational, usage, and derived
records.

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
* for v2, verify each binary descriptor, byte length, content hash, MIME/magic
  content, unique binding, and source message/document relation
* reject undeclared or prohibited executable entries
* enforce current project, memory, instruction, document, chat, and message
  limits
* report unsupported or omitted fields
* report legacy attachment metadata that has no packaged file
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
* for v2, stage quota-reserved assets and durable deletion jobs before object
  writes, then finalize `READY` assets and relations inside the canonical
  transaction
* set imported Project Memory and Project Documents provenance to `IMPORTED`
* map source identifiers to new identifiers only inside the import operation
* persist canonical records in one database transaction
* roll back all canonical database writes if any required record fails
* start Project Document re-indexing only after the transaction succeeds
* return the new project identity and any post-commit indexing warnings

Failed or ambiguous v2 restores must never issue a blind inline delete. Cleanup
may claim only the exact unreferenced staging row; otherwise the object/job is
quarantined for durable reconciliation. Persisted restore-session fencing is
implemented and checked around every object write plus finalization. A real
PostgreSQL/R2 process-kill and freeze/resume drill remains a production gate.

The MVP must not overwrite, update, merge, or deduplicate against an existing
project. The imported project is always named `<Original Name> (Imported)`.
Owner-local collisions receive a bounded numeric suffix such as
`<Original Name> (Imported 2)`; collision checks and project creation occur in
the same serializable transaction.

The commit request uses `application/zip` and carries the Preview digest in the
`X-Package-Digest` request header. Commit reuses the same package validation
path as Preview before comparing the full-package SHA-256 digest.

The current schema has dedicated `IMPORTED` provenance for Project Memory and
Project Documents, so no migration is required. Project, Chat, and Message do
not have dedicated source-trace metadata fields; their source IDs are used
only while validating/mapping the package and are not persisted as local
identity.

Document indexing is derived work. If indexing fails after commit, the new
project and authoritative documents remain available with a visible warning
and the existing retry/index lifecycle.

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

## External AI Migration Reality

Provider migration must follow current provider capabilities:

* ChatGPT can export chat history and account data as ZIP. Its documented
  cross-account process uploads `conversations.json` into a new chat as
  reference; it does not recreate old chats, sidebar state, settings, memories,
  subscriptions, or workspace membership.
* Claude exports user and conversation data, but does not support importing an
  export into another personal Claude account.
* Gemini currently accepts original ChatGPT and Claude export ZIP files for
  full chat-history import in supported regions. Google Takeout exports Gemini
  data, but its archive shape is not a stable public adapter contract.

Official references:

* https://help.openai.com/en/articles/7260999-how-do-i-export-my-chatgpt-history-and-data
* https://help.openai.com/en/articles/9106926
* https://support.claude.com/en/articles/9450526-export-your-claude-data
* https://support.google.com/gemini/answer/16868299
* https://support.google.com/gemini/answer/16920332

---

## Phased Implementation Plan

### Phase 0 — Review Current Export/Import

Status: completed on 2026-06-24.

The accepted findings and consequences are recorded in the Phase 0 Review
Result section above. No application code or refactor was part of Phase 0.

---

### Phase 1 — Project Portable ZIP Export

Status: completed on 2026-06-24.

The backend exposes an owner-scoped Project ZIP export with canonical JSON,
readable Markdown, Project Document files, optional project chats, and per-file
SHA-256 metadata. The original v1 contract remains supported. The current v2
extension adds bounded private-file descriptors and `assets/` entries when
eligible stored relations exist. The implementation uses the small
zero-dependency `fflate` package and builds the ZIP in API-process memory.

Goals:

* [x] add the deterministic Project export plan
* [x] define and validate legacy `formatVersion: "1.0"`
* [x] add compatible binary `formatVersion: "2.0"`
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
body parser capped at 8,000,000 bytes. Preview performs no project access lookup,
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

Status: completed on 2026-06-24.

The backend now exposes `POST /api/portability/projects/import/commit`. It
accepts `application/zip` with `X-Package-Digest`, re-runs the Preview ZIP and
schema validation path, compares the digest, and creates a destination-owned
project with new database identifiers.

Project metadata, Instructions, Project Memory, Project Documents, chats, and
messages are written in one serializable Prisma transaction. Project Memory
and Project Documents use `IMPORTED` provenance. Conversation Summary,
document chunks, embeddings, index state, usage data, and secrets are not part
of the validated canonical package and are never written.

Document indexing starts only after the transaction returns successfully.
Indexing failure or a remaining non-ready index status does not roll back the
project and is returned as a safe warning.

Goals:

* [x] re-read and fully revalidate the package
* [x] require the Preview digest to match
* [x] create a new project only
* [x] generate new identifiers
* [x] restore Instructions, Memory, Documents, and selected chats
* [x] mark imported Project Memory and Project Documents as `IMPORTED`
* [x] commit canonical records transactionally
* [x] perform no overwrite, merge, or implicit deduplication
* [x] trigger document re-indexing only after transaction success
* [x] surface post-commit indexing failures without deleting canonical data

---

### Project Portability Frontend UI

Status: completed on 2026-06-28.

The Projects UI now exposes Project ZIP export from each project's actions
menu and Project import from the Projects page. Export defaults to including
chats and allows the user to opt out before downloading the ZIP.

Import keeps the selected ZIP `File` in local modal state, sends it to Preview,
renders the source/suggested names, counts, warnings, unsupported items, and
package digest, then commits the same `File` with `X-Package-Digest`. Selecting
a different file clears the previous Preview state. Successful Commit refreshes
the project list and account chat state, opens the new project, and surfaces
post-commit warnings.

The frontend uses the existing authenticated fetch/CSRF conventions and does
not modify the lightweight Chat Quick Export/Import flow.

---

### Phase 4 — Full Account Data ZIP Export

Status: canonical export plus bounded private-file v2 implemented; production
storage activation remains gated on operational proof.

`POST /api/portability/account/export` requires CSRF and creates an owner-scoped
`account-data-export.zip`. The Settings "Your data" panel exposes the action.

The ZIP includes:

* canonical `data/account.json`
* per-project and per-chat canonical JSON
* Project Document content
* readable account, memory, project, and chat Markdown
* provider-neutral migration conversation JSON and memory Markdown
* `manifest.json`, counts, warnings, sizes, and SHA-256 file digests
* for v2, exact stored-asset descriptors and bounded `assets/` entries

Sensitive, operational, and derived state is excluded. Legacy v1 packages
remain importable; v2 is used when eligible stored private files exist. Export
is bounded and assembled synchronously in API memory. The single-instance MVP
caps output at 10 MB compressed, 5 MB per entry, 20 MB across generated
entries, and 600 entries. The authenticated endpoint permits three attempts per hour
per account and per source IP, returns `Retry-After` with
`ACCOUNT_EXPORT_RATE_LIMITED`, and intentionally uses an in-memory limiter that
resets on process restart and does not coordinate across replicas. Replace it
with a shared limiter before running multiple API instances. Only one
portability operation per user and two per API process may be active. The same archive
is accepted by the unified Account Import flow; these export-only limits do not
change Account Import limits. Restore never replaces account identity,
credentials, sessions, or settings; portable records are created as new local
records and exact Account Memory duplicates are skipped.

---

### Phase 5 — Unified Account Import

Status: implemented behind a production-default-off feature flag.

The backend exposes:

* `POST /api/portability/account/import/preview`
* `POST /api/portability/account/import/commit`

Both accept `application/zip`, require authentication and CSRF, enforce ZIP
path/entry/compressed/uncompressed limits, and automatically detect the archive
format. There is no provider selector or provider identity header. Preview
performs no writes and returns portable-record counts, warnings, import kind,
and a whole-file SHA-256 digest. Commit re-parses the ZIP, requires matching
`X-Package-Digest`, and rejects changed bytes before any database write.
`PORTABILITY_IMPORTS_ENABLED` defaults to false in production. Rate and
concurrency guards execute before raw-body parsing.

For a native Full Account Data ZIP, Commit creates new projects, memberships,
instructions, Project Memory, Project Documents, chats, messages, and
non-duplicate Account Memory records in one serializable transaction. Every
database identity is generated locally. Source identifiers and timestamps are
trace metadata only. Project-linked chats are mapped to the newly created
project IDs. Imported Project Memory, Project Documents, and Account Memory use
`IMPORTED` provenance. Existing email, password, sessions, account profile,
and settings are never overwritten.

For native v2 packages, Preview also validates each private-file descriptor,
manifest entry, checksum, MIME/content match, and exact source relation. Commit
stages quota-reserved `PENDING` assets plus durable deletion jobs before
immutable object writes. The canonical serializable transaction then promotes
the exact assets to `READY`, creates message/document relations, and removes
their jobs atomically. Failed cleanup claims only exact unreferenced staging
rows; ambiguous outcomes are quarantined and never blindly deleted inline.

Project and chat restore is create-new only. Imported project names use the
existing bounded `(Imported)` / `(Imported 2)` collision policy. Account Memory
duplicate comparison is exactly `content.trim()`: casing and internal
whitespace remain significant. Duplicates against current records and inside
the package are skipped, and duplicate state is recomputed inside the write
transaction. Document indexing starts after transaction success and indexing
failure returns a warning without deleting canonical data.

For recognized external conversation archives, the same endpoints
transactionally create new standalone chats/messages with new IDs. External
conversion remains best-effort and does not claim a complete foreign-account
restore.

External archive commit does not yet persist a digest-scoped idempotency
receipt. Retrying a commit after an ambiguous client/network outcome can create
another set of chats, so this path must remain production-disabled until a
forward-only receipt schema and replay contract are implemented.

The current account/native limits are 10 MB compressed ZIP bytes, 600 entries,
5 MB per entry, and 20 MB total expanded bytes. External conversation archives
use the same compressed/entry-count/expanded limits with a 10 MB maximum source
entry. Semantic limits reuse the application quotas (currently 40 chats, 160
messages per chat, 50,000 characters per message, and 1,000,000 UTF-8 content
bytes per chat), plus a 5,000,000-character aggregate import ceiling. ZIP paths reject parent
traversal, absolute/drive paths, backslashes, normalization conflicts,
duplicate/case-conflicting paths, encrypted entries, unsupported compression,
Unix symlinks, and executable Unix file modes. Larger or unknown packages must
fail safely rather than partially import.

Commit obtains the same advisory quota locks as ordinary project/chat/memory
creation, then checks current destination counts plus imported records inside
the serializable transaction. This prevents concurrent ordinary creates from
crossing the same account caps.

The Settings UI lazy-loads one generic Account Import modal. It stores the
selected `File`, Preview, and digest only in local modal state, has no provider
dropdown, and sends the same `File` to Commit. After Commit it refreshes Account
Memory, projects, and chats without a browser refresh. Project ZIP manifests
return a specific safe instruction to use the Projects page.

---

### Phase 6 — Additional Account Archive Adapters

Add another external account/archive format only after stable real fixtures and
a versioned parser contract are available. Each adapter must remain behind the
same safe auto-detection boundary and must not weaken ZIP validation or claim a
complete foreign-account migration.

---

### Phase 7 — Chat Attachment Persistence

Status: implemented for signed-in chat attachments and original Project
Document sources behind the disabled-by-default private-assets flag.

The implementation defines owner-scoped authorization, a storage port and R2
adapter, conservative upload/download limits, MIME/content checks, normalized
relations, retention/deletion outbox behavior, and Account/Project portability
references. Persisted restore fencing, maximum-boundary contract coverage, and
exact cleanup lease CAS are implemented. Production remains closed pending the
real PostgreSQL/EU R2 interruption gates, deployed freeze/resume and
production-scale timeout proof, and monitored multi-instance cleanup.

Standalone Conversation ZIP remains deferred as its own package/UI contract;
it is no longer blocked on whether signed-in attachment persistence exists.

---

### Phase 8 — Conversation ZIP, PDF, And Work-Management Adapters

When standalone Conversation ZIP is prioritized:

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
4. Project UI for ZIP export, preview, and confirmed create-new import.

The MVP includes:

* deterministic planning
* backward-compatible native `formatVersion: "1.0"` import
* bounded native `formatVersion: "2.0"` when stored private files are present
* `manifest.json`
* canonical project JSON as the restore source
* readable Markdown companions
* Project Instructions
* Project Memory
* Project Documents
* optional project-linked chats
* exact owner-scoped stored-asset bindings and hashed v2 `assets/` entries
* owner-scoped authorization
* ZIP/path/size validation
* Preview/Commit digest matching
* transactional canonical writes
* staged private-object restore with durable cleanup and atomic finalization
* imported provenance
* post-transaction Project Document re-indexing
* local-only selected ZIP state in the import modal
* user-visible Preview counts, warnings, unsupported items, and digest
* project-list and account-chat refresh before navigation after successful Commit

Unified Account Export/Import now follows the completed Project round trip.
Account Memory is included inside the complete account archive and remains
editable through its normal CRUD UI.

---

## Non-Goals For The Project MVP

Do not implement all formats for all subjects immediately.

MVP should not include:

* AI-based export planning
* full Conversation ZIP
* a standalone Conversation ZIP attachment-export flow
* Conversation Summary restore
* document chunk, embedding, or index-state restore
* project overwrite
* project merge
* overwrite of account identity, credentials, sessions, or settings
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
* V2 Preview validates binary descriptors, bytes, MIME/content, hashes, and
  exact source relations before storage or database mutation.
* Commit rejects changed package bytes or a digest mismatch.
* Commit creates a new project and never overwrites or merges.
* Imported Project Memory and Project Documents use `IMPORTED` provenance.
* Canonical writes are transactional.
* V2 restore stages assets/deletion jobs before object writes and promotes the
  exact `READY` assets and relations inside the canonical transaction.
* Document re-indexing starts only after transaction success.
* Indexing failure does not destroy imported canonical data.
* The Projects UI exports ZIP packages and commits only the same file that was
  successfully previewed.
* Tests cover planner decisions, export exclusions, ZIP safety, Preview
  no-write behavior, digest revalidation, owner isolation, v1/v2 compatibility,
  binary binding/tamper checks, staged cleanup, rollback, and the project round
  trip.

---

## Remaining Open Questions

These questions do not block the accepted phase order, but must be answered
before their relevant implementation slice:

1. What are the maximum Project Document count and total canonical content
   size inside one imported project, in addition to the global ZIP limits?
2. Which stable additional account-archive fixtures and schema versions can be
   supported?
3. What final retention periods, cleanup ownership, alert thresholds, and
   restore-reconciliation procedure should be approved before production
   private assets are enabled?
