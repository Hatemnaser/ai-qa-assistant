# Saved-login key and revocation operations

## Recovery fence (2026-10-24, implementation pending independent acceptance)

Full capture/quarantined restore has bounded local GO; see
`work/phase-08a-full-backup-acceptance-20261023/REVIEW.md`. The new recovery fence
adds `ODDPATH_RECOVERY_QUARANTINE_V1` to the recovery database's PostgreSQL COMMENT
before either official restore writes tables. This metadata survives rename and
does not require a schema migration. Normal API startup and routine jobs inspect
database metadata before listening, dispatching or cleanup; legacy restore names
also fail closed. Database failure is not permission to start. No automatic
promotion/removal path exists. Superusers/recovery owners remain trusted operators;
manual SQL/backup imports outside these tools require equivalent quarantine and
must never rename an unmarked historical database into service.

Use dedicated PG credentials/private `PGPASSFILE` in the operations environment:

```sh
node ops/recovery.mjs assess
```

Exit2 / `RECOVERY_BLOCKED` is the expected assessment result. It reads a consistent
historical inventory and changes no records, receipts, holds, roles, keys or
journals. Zero unknown rows, a hash, a valid MAC, an old successful job or an
operator-written JSON file cannot establish post-snapshot continuity. Counts
are not a promotion receipt. Routine reconciliation is fenced; narrowly scoped
accounting primitive invocations in isolated tests are not a production bypass.

The source required for current financial/deletion continuity is independently
preserved current/quiesced PostgreSQL or verified continuous WAL/PITR through a
trusted recovery point, plus current deletion/revocation/physical Stop evidence.
WAL shipping/PITR and off-host storage are not implemented by this slice. Lost
information cannot be guessed, billed as confirmed or recreated by provider
replay. Preserve estimates/unknowns and active reservations; keep the system
quarantined when evidence is incomplete. No paid infrastructure is assumed.

## Full data backup and quarantined recovery (2026-10-23, bounded local GO)

The optional fourth overlay `deploy/self-hosted.full-backup.compose.yml` and its
private `.env.example` extend the existing base/operations/stack files. The old
database-only CLI remains unchanged in scope and still refuses browser/object
records. `ops/full-backup.mjs` captures PG, both SQLite journals and READY object
bytes; a separately encrypted escrow preserves the supplied vault keyring. Both
archives share the exact seven-day retention boundary. Wrapping keys stay outside
the archives. Store both archives/receipts and separately protected wrapping keys;
a local copy is not certified off-host recovery.

SQLite's supported backup API runs in two isolated exporters as the journals'
native owners, with no network, signing keys, PG credentials or Docker socket.
They open the source readOnly but permit ordinary owner WAL/SHM bookkeeping.
Only closed, self-contained snapshots cross private Unix sockets. The aggregation
service cannot mount or write the live journals. Export plaintext stays in each
exporter's private tmpfs and is removed after the request. Source modes/ownership
must not be weakened to make capture succeed.

Components are separate snapshots, not an atomic multi-datastore checkpoint.
Runtime creator fences, unknown usage, unapplied receipts and reservations are
preserved; no exporter settles or releases them. Non-READY upload records remain
in PG but are not counted as recoverable object bytes.

Full restore authenticates all components before connecting to the empty,
exclusive recovery database. It writes private recovered files/receipts only into
a NEW recovery directory and never starts an app, grants access, uploads to the
live bucket or mounts a historical journal into current services. Saved-login
keyring identity is checked; recovered keys are not an automatic rollback of the
deployment's current generation. An independently supplied journal is staged
separately, authenticated, and explicitly freshness-unverified.

`financialContinuity` and `deletionContinuity` remain `UNVERIFIED`; historical
runtime state is never execution authority. Reconcile post-snapshot consumption
and deletions against current trusted evidence/PITR before any activation. Missing
evidence cannot be guessed or regenerated through a provider call. Prove current
revocation continuity and physical Stop/settlement, or invalidate old storage
generations and require fresh consent. Delete decrypted drill staging and its
isolated DB after verification. Full-system activation, real R2/off-host recovery
and independent release acceptance remain separate gates.

## Existing key/revocation contract

The feature remains off until local review and the selected deployment's rehearsal pass. Use the existing browser dispatch drain before schema/flag/key changes. Keep the control plane/reapers available until physical Stop is confirmed; disabling routes is not termination.

API configuration:

```text
QA_SAVED_LOGIN_ENABLED=false
QA_BROWSER_VAULT_KEYRING_FILE=/run/secrets/browser_vault_keys.json
QA_BROWSER_VAULT_REVOCATION_FILE=/var/lib/oddpath-vault/revocations.sqlite
```

The keyring file contains storage/transfer objects with activeVersion and keys maps, and a separate 256-bit revocationKey. Generate independent random 256-bit keys using a trusted operator tool; never reuse viewer/provider/session keys. Keep key files private/read-only and outside PostgreSQL, source control, logs, exports and tenant mounts. API startup validates enabled keyrings; graceful shutdown closes the journal. The supervisor allowSavedLogin gate also needs vaultTransferKeyFile, containing only the corresponding transfer ring. It must not receive the storage or revocation keys.

Storage rotation adds a new explicit version and makes it active for new consented saves. Retain old storage versions only for the reviewed remaining lifetime/backup policy; deleting a version invalidates its payloads and never silently re-encrypts/extends a saved login. Drain before transfer rotation, deploy API/supervisor together, and verify both directions with synthetic state. Do not rotate the revocation authentication key by discarding the journal; that requires a separate authenticated migration/rehearsal.

API and API reaper must use the same durable journal on one local filesystem. Preserve SQLite/WAL atomically using a supported SQLite backup while the service is quiescent or through its backup API; copying only the database during writes is insufficient. Protect keys and journal in encrypted off-host backups independently of PostgreSQL. Monitor reaper progress, expired payload cleanup, integrity/unknown-key failures, disk availability and physical Stop. A failed cleanup pass must trigger an operator alert, not be counted as successful deletion.

The live journal handle rejects a missing or replaced main file before authority reads/writes. Replacing a live file is therefore not a supported maintenance operation; drain and quiesce first. This check cannot detect an operator restoring both the old journal and the old relational database before a fresh process starts. Journal continuity and key invalidation on uncertain recovery remain operational requirements.

PostgreSQL restore must retain the latest independently issued/revoked/deleted identities. Do not roll back the journal with the relational snapshot. Rehearse restoration of a pre-revocation database against the current journal, including deleted accounts/projects and active-use Stop. If continuity is lost or uncertain, disable dispatch, stop existing allocations, invalidate all old storage versions, create a fresh secured journal/key generation and require fresh human consent. Existing payloads must not be manually re-issued into a replacement journal.

The local tests prove signed issuance/tamper handling, journal reopen, stale-row restore rejection, permanent project deletion and expiry during real PostgreSQL lock waits. They do not certify a particular host's backup medium, full disaster restore or multi-host journal coherence. Those remain operational release gates within the hosting budget. Never release the separate Docker creation fence without the settlement proof in BROWSER_RECOVERY_RUNBOOK.md.
