# Session assistant capability correction — 2026-10-04

## Observed issue and cause

The owner showed a real session: after generating a login test-case table, with
the Test Cases task still selected, `runn test blz` received a generic answer
claiming that the assistant could only design/document tests and could not help
execute them. No execution was attempted. This was not a missing browser stream
or Runner failure; the conversation's instructions misrepresented the workflow.

The managed session prompt still began with the legacy selected-task persona
(“professional QA Engineer / Generate structured test cases”), then appended
the structured session contract. That contract prohibited the assistant itself
from executing but did not positively explain approved Runner capabilities.
The optional legacy workflow classifier could also override the selected format
before the structured reply understood the actual user intent.

## Bounded correction

- Managed SESSION/TEST conversations now use a capability-aware session prompt
  branch, not an unconditional legacy artifact persona. All six tasks remain
  optional writing-format preferences; they are not capability restrictions.
- Oddpath's approved Playwright/Runner capability is explicit. A short or
  slightly misspelled request to run the discussed checks should clarify missing
  target/environment information or propose a scope, not reject the entire
  capability or interpret politeness/typos as a target environment.
- Actual project ID (or null) is included separately in session context. The
  assistant cannot silently choose/create a project or invent a URL, Runner or
  observed result. It may explain the project choice required before preparation.
- Scope confirmation, exact Recipe/Runner/production execution approval and
  record review remain separate action-card decisions. Text never grants
  execution permission; attachments are still not execution evidence.
- The optional workflow-router provider call is disabled for managed sessions,
  including reservation estimates. Understanding belongs to the existing
  structured conversational response; usage still covers its policy/context.
  Raw user content remains the retrieval query and current provider message.
- Anonymous/legacy non-session prompt templates and their existing workflow
  router behavior are unchanged. Existing stored replies are not rewritten.

No API/schema/migration or execution-approval contract changed for this fix.
No real provider request or QA execution was manually initiated as a test.

## Verification and runtime

- **11/11** new isolated regression tests: all six tasks with the exact typo,
  Arabic follow-up, artifact-only request, positive capability and explicit
  no-bypass boundaries, unchanged guest persona, and one conversational provider
  call with no optional classifier. Provider/history/usage are mocked.
- Full API tests: **968/968**, including existing worker/preparation/exact
  approval and ownership checks. Type/architecture checks, API build and Git
  whitespace check passed. Logs: `work/session-capability-check-20261004.log`,
  `work/session-capability-api-tests-20261004.log`,
  `work/session-capability-api-build-20261004.log`.
- The built prompt policy was checked directly; the local API was restarted
  using `work/local-db-activation/serve-local.mjs` on 127.0.0.1:5000.

Mocked regressions verify prompt selection, context and call boundaries, not the
live model's exact next wording. The owner should retry within the same session;
missing URL/environment must be clarified, and preparation/execution must still
use the explicit cards. Do not use the approved historical QA request as a fixture.

Original implementation/visual verification remains recorded in
`ONE_SESSION_CHECKPOINT.md`; local database activation is recorded in
`LOCAL_ONE_SESSION_ACTIVATION.md`. No commit, push or deployment.
