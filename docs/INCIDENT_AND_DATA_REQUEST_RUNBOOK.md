# Incident And Data-Request Runbook

This is the operational runbook for the first Oddpath beta. It is not legal
advice and does not replace final review of the operator's legal notices,
processor contracts, retention schedule, or competent German supervisory
authority.

## Before Enabling Registration

Record these values in a private operator document, not in this repository:

- the controller/operator's legal identity and reachable contact address;
- the competent German state data-protection authority;
- Render, Cloudflare, Google, and Brevo security/privacy contact paths;
- the person who can disable registration, AI, and private uploads;
- the production database, R2 bucket, backup owner, and alert destinations; and
- the reviewed retention periods and current Terms/Privacy versions.

The BfDI explains that most private businesses and freelancers are supervised
by a state authority rather than the federal authority. Confirm the authority
for the operator's German state before launch:
https://www.bfdi.bund.de/DE/Buerger/Inhalte/Allgemein/Datenschutz/Zust%C3%A4ndigkeit-BfDI.html

## Security Or Privacy Incident

### 1. Stabilize and preserve evidence

1. Record the discovery time in UTC, reporter, affected environment, and a
   short factual description.
2. Do not paste prompts, files, credentials, tokens, presigned URLs, or full
   user records into tickets or chat.
3. Preserve relevant provider audit events and application logs in a restricted
   location. Record hashes or IDs instead of copying personal content when that
   is sufficient.
4. Rotate a credential immediately when exposure is credible. Do not wait for
   the full investigation.

### 2. Contain using the narrowest safe switch

- Stop new accounts: `REGISTRATION_MODE=disabled`.
- Stop AI spend or suspected prompt exposure: `AI_ENABLED=false` and
  `GUEST_AI_ENABLED=false`.
- Stop new object uploads: `PRIVATE_ASSETS_ENABLED=false`. Keep cleanup storage
  credentials available so queued deletion can still finish.
- If authorization or database integrity is in doubt, take the API out of
  service rather than serving uncertain data.

Changing a flag is not containment until the deployment has completed and a
clean-browser check confirms the behavior.

### 3. Determine scope and risk

Create a timeline and answer, with evidence:

- What systems, processors, regions, and time window were affected?
- Which people and data categories may be involved?
- Were authentication material, prompts, chats, memories, files, inferred
  content, IP hashes, or backups exposed, changed, deleted, or unavailable?
- Was confidentiality, integrity, or availability affected?
- Can the data identify people directly or when combined with other data?
- What was the likely impact and has access actually been observed?

Ask each affected processor for its incident reference, timestamps, scope,
containment action, and deletion/retention status. Do not accept "EU region" as
proof that no other processor or remote-access path was involved.

### 4. Make and record the notification decision

GDPR Articles 33 and 34 govern authority and individual breach notifications.
Where a personal-data breach is likely to create a risk, the authority deadline
is generally 72 hours after awareness; high risk can also require notifying the
affected people without undue delay. Record the decision and rationale even
when notification is not required:
https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng

Do not wait for perfect information before escalating for legal review. If all
details are not yet available, record what is known, what is pending, and when
the next decision checkpoint occurs.

### 5. Recover and close

1. Patch the cause and add a regression test where possible.
2. Restore into an isolated target first; never test recovery by overwriting
   production.
3. Confirm account isolation, sessions, chats, files, deletion jobs, email, AI
   switches, and billing before reopening.
4. Record affected versions, actions, notification decisions, residual risk,
   and an owner/date for every follow-up.

## Data-Subject Request

Oddpath must support access/export, correction, deletion, restriction,
portability where applicable, and objection workflows. GDPR Article 12 sets the
general response timing (normally one month) and Articles 15–22 define the
individual rights. Use the official text for the reviewed process:
https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng

### Intake and identity

1. Record the request date, requested right/scope, locale, and deadline.
2. Use the authenticated account flow when possible. Request only the minimum
   additional evidence needed when identity is genuinely uncertain.
3. Never ask a person to email their password, session token, ID document, or
   exported archive. If identity cannot be established safely, pause and
   document why.

### Locate and fulfill

Use the product's own account export and password-confirmed account deletion as
the primary self-service paths. Before responding manually, map the request to:

- user/account and Terms acceptance;
- sessions and verification/reset tokens;
- projects, instructions, documents, chunks, and memory;
- chats, messages, summaries, and attachments;
- StoredAsset rows and R2 objects;
- usage/security records and processor-held copies; and
- backup copies subject to the documented backup expiry cycle.

Check that an export's manifest states truthfully whether original attachment
files are included. A database-only ZIP is not a complete file export after R2
uploads are enabled.

For deletion, verify that the database transaction queued every object before
the account was removed, then monitor `ObjectDeletionJob` until the backlog is
clear. A successful HTTP response does not prove provider deletion while jobs
remain pending.

### Protect other people

Uploaded files and conversations can contain third-party data. Review manual
exports for other people's rights and secrets; do not disclose another user's
account data, internal credentials, abuse controls, or processor security
details.

### Close the request

Record what was supplied or deleted, exclusions and their reason, processors
contacted, completion date, and any backup-expiry follow-up. Store this case log
separately from product content with a reviewed retention period.

## Minimum Operational Checks

At least daily during the private beta, review:

- API readiness and 5xx/429 trends;
- registration/email verification failures;
- database disk and backup status;
- Gemini usage, provider budget, unknown-billing attempts, and kill switches;
- R2 upload validation failures and total bytes;
- `ObjectDeletionJob` count, oldest age, and failed attempts; and
- last successful retention and asset-cleanup run.

Escalate immediately when deletion jobs grow continuously, readiness fails,
backup state is unknown, an unexpected AI bill appears, or authorization
failures suggest cross-account access.
