# Chat Sync and Data Limits

This document records the launch contract implemented for signed-in chat sync
and PostgreSQL growth control. The limits are product guardrails for the small
launch database; they are not a substitute for storage monitoring or backups.

## Signed-in chat sync contract

- Guest chats remain local-first. Signing in with guest chats explicitly marks
  those chats as pending account drafts so they can be adopted once.
- For a signed-in user, scoped `localStorage` is a cache, not an independent
  replica. A local chat participates in reconciliation only when it is an
  explicit pending edit or a current-session create/adopted guest draft.
- A server omission is authoritative for every non-pending cache entry. This
  prevents a chat deleted on another device from being uploaded again by an
  older browser cache or after logout/login.
- A local edit is saved only when the server row still exists and the edit is
  newer than that server copy. A missing, equal, or newer server copy wins and
  clears the stale pending marker; an offline edit therefore cannot recreate a
  chat deleted on another device.
- Local deletion creates a durable `pendingDeletes` tombstone before changing
  the visible list. The tombstone hides any stale server snapshot and remains
  until deletion succeeds. HTTP 404 is treated as successful idempotent
  deletion because another client may already have removed the chat.
- Guest migration and explicit local create/import actions are allowed to
  create a missing server row only during the current signed-in page session.
  This create authority is deliberately discarded on logout, account switch,
  or reload, closing the crash window in which an acknowledged old draft could
  otherwise resurrect a later server deletion. Edits and delete tombstones may
  remain durable, but edits never recreate a missing row. Merely loading a
  previous user cache does not create any mutation authority.
- Attachment previews and signed download URLs remain excluded from
  `localStorage`; the existing opaque `assetId` contract is unchanged.

If browser storage is unavailable, the current in-memory edit remains usable,
but an offline pending mutation cannot be durable across a reload. The app
attempts to flush current-session creates before logout; if that flush fails,
the cached draft is not trusted to recreate data after the next login. The next
successful refresh still treats the server as authoritative.

## Launch data limits

The canonical API constants live in `apps/api/src/config/data-limits.ts`.

| Resource | Launch limit | Additional bound |
| --- | ---: | --- |
| Saved chats | 40 per user | collection query returns at most 40 |
| Messages | 160 per chat | 50,000 characters per message and 1,000,000 aggregate UTF-8 content bytes per chat |
| Projects | 8 owned projects per user | collection query returns at most 8 |
| Project documents | 10 per project | imported source files are at most 250KB; manual content is at most 50,000 characters |
| Account memories | 50 per user | 4,000 characters per memory |

Project Instructions and Project Memory already use one row per project with
bounded content, so they do not need collection quotas.

Normal create/import batches enforce count limits inside the same PostgreSQL
transaction as the write. Transaction-scoped advisory locks serialize quota
checks for a user or project, preventing concurrent requests from both passing
the final slot. The list endpoints are therefore bounded by the enforced hard
caps and do not need pagination at this launch size.

Every bulk portability/import path must validate its complete post-import
totals against the same constants before committing; it must not bypass these
repository limits. If the product raises any cap later, add cursor pagination
before allowing a collection to become unbounded.

## Operational follow-up

- Keep registration controlled while using a 1GB PostgreSQL plan.
- Alert before database usage reaches 70-80% and review real average document,
  chunk, embedding, and chat sizes.
- Raising the 250KB document-file limit has a multiplied database cost because
  source text is also chunked and each chunk may store an embedding vector.
- A quota increase is a capacity decision and should be tested against a copy
  of production data; it is not just a UI/configuration change.
