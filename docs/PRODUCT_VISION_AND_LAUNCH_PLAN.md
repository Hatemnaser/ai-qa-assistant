# Oddpath Product Vision And Launch Sequence

Last reconciled: 2026-10-05 (original vision discussion: 2026-09-20)

Status: product direction and local delivery are recorded separately below.
Future capabilities remain proposals; this document does not authorize building
every roadmap item or deploying the application.

This is the product sequencing reference. `PRODUCTION_READINESS.md` remains
the authoritative operational release gate; `DEPLOY_AUTH_READINESS.md` adds
environment/auth checks. No blocker is waived here. Current implementation
and historical verification are recorded in `AI_HANDOFF.md`.

## Current Delivery — One Session With QA Capabilities

The local implementation now uses one session for discussion, writing and QA.
There is no Chat/QA workspace switch, Start test handoff, or separate conversation
identity created merely because the user requests a test. Server-owned turns,
the stable message/QA-event timeline and canonical `#/chat?sessionId=...` route
are recorded in `ONE_SESSION_CHECKPOINT.md`; legacy Tests links stay compatible.
QA Request/Run/Recipe/evidence records retain their existing authority. Confirming
scope, approving an exact run and reviewing a QA record are separate decisions.

Project sessions live only in their project folders; Recent contains projectless
sessions. Instructions, memory, project documents and Integrations are managed
from project details. Session Sources, Activity and Results open on demand; account
usage is in the account menu. The six composer tasks are optional writing/task
preferences, not separate products or a prerequisite to request execution.
See `SESSION_TOOLS_CHECKPOINT.md` and `SESSION_START_REFINEMENT.md` for this
presentation and the clean new-session/reader follow-up.

The last completed verification before this documentation closeout was 1,601
tests plus 60 read-only and eight critical QA browser fixture scenarios, as
recorded in `SESSION_START_REFINEMENT.md`. Those are historical local results,
not a fresh release-candidate run or live provider/storage certification.
Current closeout work and its results belong in `AI_HANDOFF.md`.

Earlier local real journeys and Runner onboarding remain useful evidence:
`TEST_SESSIONS_LIVE_CHECKPOINT.md` records four PASS, one intentional FAIL and
five stored TEXT proofs with owner record approval; `RUNNER_ONBOARDING_CHECKPOINT.md`
records the bounded setup/recovery UI. Keep that approved record intact.
Unassisted onboarding, packaged executor delivery and operational launch gates
remain open. Embedded browser viewing/takeover, independent cross-provider review,
native mobile execution and general multi-agent orchestration remain future work.

## Already Built Versus Not Yet Proven

The focused Home/chat/project shell and visual refresh were merged in PR #15
(`08c4f35`). The QA foundation already includes locked context, immutable
checklists/Recipes, owner approvals, local Playwright execution, required
evidence, and history. The owner completed the local TEXT smoke and approved
its QA record. These are not new implementation tasks.

The shared session coordinates conversation and explicit QA links while the QA
records retain execution/review authority. Cross-provider code review, MR/Jira/Figma
adapters, a general multi-agent coordinator, embedded live browser and readiness
policy evaluation are not shipped capabilities. Local checks and the completed
smoke do not establish unassisted onboarding or live deployment readiness.

## Product Direction

Oddpath should be an AI-native QA workspace with an agent-neutral execution
harness: one understandable place to coordinate QA work, inspect evidence,
follow fixes, and assess what is known about a release candidate.

It complements coding agents rather than relying on being a uniquely smarter
coding or browser agent. Stronger models can improve planning and review;
Oddpath preserves scope, approvals, evidence, provenance, and history. Model
choice, another chat UI, browser clicking, or simply calling a second model
are not sufficient differentiation. Validate value through useful findings,
lower user effort, and repeat use, not the number of connected agents.

### One Interface, Focused On The Work

The owner prefers a single coherent work surface:

- Bottom composer for goals, questions, and follow-up discussion.
- Center focused on the conversation and real plan, progress and findings.
  Code/design review adapters and browser viewing are future extensions;
  browser watching is not intended as a prerequisite to complete a test.
- On-demand Activity shows known assistant/preparation/execution work and its
  outcomes. Future delegation needs real assignments and progress before it can
  appear as agent activity. Credentials or saved connections are not active agents.
- Project instructions, memory and files remain discoverable on the project
  page, reached through the session's project link. Session Sources lists actual
  attachments; it does not claim to list documents retrieved through RAG.
- Persistent contextual decisions explain scope and risk. A notification or
  chat message is not a substitute for explicit approval.

The owner subsequently approved the persisted one-session implementation without
replacing the QA lifecycle. Broader agent aggregation/orchestration still needs
its own scope. Multiple agents are optional; one worker must remain a complete,
understandable path.

## Independent Review — The Owner's Delegation Use Case

The owner clarified that delegation primarily means: a coding agent implements
a change using one model; Oddpath arranges a second review using another chosen
model/provider. This is more specific than an autonomous multi-agent swarm.

Proposed contract for a later bounded pilot:

- Review the original requirement, exact diff/base/head revision, relevant
  project context, and available test receipts; do not rely only on the
  implementer's completion summary. Gather an initial independent assessment
  before feeding back the implementer's explanations when practical.
- Return actionable findings tied to files/lines or behavior, with supporting
  evidence and explicit uncertainty. Separate bugs, questions, and preferences.
- Start read-only. Test execution, writes, posting comments, fixing code,
  committing, and merging are distinct permissions, not implied by review.
- Disclose the receiving provider and approved context; minimize sensitive
  data and treat repository/document instructions as untrusted review inputs.
  Define timeout, cost, cancellation, retry, and owner/project boundaries.
- A changed commit makes the previous assessment historical, not approval of
  the new head. Reverification should preserve prior findings and receipts.
- Measure useful issue detection, false positives, latency, and cost on known
  examples before selecting a default reviewer. Different providers can make
  the same mistake; agreement is not proof of correctness.

Current REST/MCP boundaries and provider abstraction are foundations, not
evidence of arbitrary outbound agent control or a shipped cross-provider code
review workflow. Gemini is currently the registered runtime text provider.
Client connectivity, credentials, provider availability, and cost need explicit
design; do not assume an external coding tool's subscription grants API access.

## Evidence-Led Outcomes And Release Readiness

Keep these concepts separate:

- **Check outcome:** an actual assertion result for a defined target and scope.
- **AI finding:** a review hypothesis or interpretation, not automatically a
  reproduced defect. Even a real failed assertion can reflect a bad test or an
  intentional negative case; preserve expected behavior and cause uncertainty.
- **Readiness assessment:** policy over required checks, current evidence,
  coverage gaps, known blockers, and explicitly accepted risks.
- **Human decision:** approval of a QA record, release authorization, and actual
  deployment are different actions. Existing QA approval grants neither of
  the latter two.

Missing, skipped, blocked, stale, or inconclusive checks cannot silently count
as passes. A model's positive opinion cannot override a failed required check.
Passing checks do not establish that all relevant behavior was tested. Keep
subjective UX/design judgments labeled and allow human review.

"Release ready" is a long-term goal, not a current unconditional guarantee.
Preferred promise: **Know what is ready, what is blocking release, and what
evidence supports the decision.** A future readiness result must name the
candidate build/commit, environment, criteria version, evaluated scope, and
evidence freshness. A relevant change requires reassessment. Security,
performance, operations, or other untested domains must remain visible gaps.
Do not substitute an LLM score or overall pass percentage for required gates.

## Integration Direction — Future, Not Launch Requirements

### Issue Trackers Such As Jira

Maintain an Oddpath finding/evidence identity with links to external issues;
this is a logical boundary, not an approved schema. An adapter should preserve
tracker workflow ownership rather than build another competing issue tracker.

- Search the authorized project scope before proposing a new ticket. Show
  likely matches and reasons; text similarity alone does not establish a duplicate.
- For a confirmed match, propose linking the finding and adding useful missing
  evidence/reproduction details without overwriting or duplicating existing data.
- When no match is found, prepare a ticket draft for confirmation. Report search
  failure or incomplete access as unknown, not "no ticket exists."
- Attach only real, relevant evidence with sensitive content removed. Screenshots
  and recordings are conditional on available capture/storage, not fabricated
  artifacts or an implicit promise that recording exists today.
- Begin with approval per external write. Later opt-in automation needs scoped
  rules, retry-safe idempotency, duplicate prevention, audit, and recovery.
- A ticket marked fixed is not retest evidence; an existing ticket does not
  remove a release blocker. Closing/reopening issues needs explicit policy.

### Merge/Pull Request Review

Reuse the independent-review contract for a chosen repository and exact MR/PR
revision. Findings, test evidence, and follow-up review should stay linked to
the version examined. Review, posting comments, editing code, and merging are
separate capabilities. No automatic fix/commit/merge is part of the initial idea.

### Figma Or Other Design References

Compare actual implementation against an explicitly selected, versioned design
reference for a particular viewport, state, and theme. Report location and
evidence for layout/spacing/type/color/state differences; separate intentional
responsive differences and subjective suggestions from requirement violations.
Pixel similarity alone proves neither functional correctness nor accessibility.
The existing image Visual Review task is not a live Figma integration.

Keep adapters replaceable and project-scoped. Connecting every tool must not
become mandatory onboarding; no generic plugin platform is required now.

## Before Live — Two Separate Gates

The selected first real-user rollout remains a **verified, invite-only beta**.
A deployed portfolio demo is a different release type; it cannot bypass data
safety when visitors can create accounts or store content. Public signup and a
broad commercial launch are not implied by "go live."

### A. A Useful, Honest First-Test Experience

- [ ] Confirm the initial tester/use case and supported target/environment.
  Decide realistic executor setup/delivery for that audience; the current local
  CLI is not zero-install or an embedded browser.
- [x] Implement the simplified session journey and its later unified successor,
  with visible status, persistent decisions and preserved QA rules. The project
  organization, optional tools and clean start refinements are locally implemented.
- [ ] Validate that journey without coaching; plan Runner setup/recovery changes
  based on the observed manual token friction. Implementation alone is not acceptance.
- [ ] Make the initial result useful: expected behavior, available observed
  evidence, and failure/setup explanation. Current Runner TEXT step summaries
  do not retain rich measured actual values; improve or explicitly bound the
  pilot before making stronger diagnostic claims.
- [ ] Validate a first test with an unfamiliar user, plus offline/review-failure,
  interruption, and return-to-work behavior on isolated data. Do not reopen or
  alter the previously approved smoke record as a shortcut.
- [x] Record the local feature-preservation and keyboard/layout/en/ar/de/RTL
  checks in `UX_FEATURE_PRESERVATION.md` and `SESSION_START_REFINEMENT.md`.
- [ ] Re-run the relevant release-candidate checks after closeout changes and
  verify real-device/assistive-technology behavior where the beta requires it.
  Automated catalog and desktop viewport checks have narrower coverage.
- [ ] Align landing/onboarding copy with actual capabilities and beta limits.
  Do not market independent code review, live streaming, recording, automatic
  Jira workflows, or a release certificate before they exist and are validated.

### B. Real-User Operational Safety

Use the actual checklists in `PRODUCTION_READINESS.md` and
`DEPLOY_AUTH_READINESS.md`; this grouping is not a replacement or completion
claim. Remaining work includes managed database provisioning and separation,
backups/restore proof, staging/HTTPS/auth-email smoke, proxy/edge abuse controls,
reviewed privacy/terms and retention, monitored cleanup, alerting/incident
ownership, and release/rollback verification. Recheck dependencies and provider
limits for the release candidate rather than relying on old green checks.

Preserve the closed production private-assets and import guards. Real EU R2
activation/recovery/cleanup proof and QA data portability gaps remain tracked
blockers; none is silently moved to "after live" by this roadmap. Any proposal
for a narrower beta must explicitly reconcile those blockers and supported
data/features in the authoritative release checklist first.

Registration stays disabled until its reviewed invite-only activation gates
are met. Provisioning, paid services, production data operations, deployment,
and enabling features require a separate authorized release task.

## After Live — Sequenced Learning, Not A Shipping Commitment

Recommended order; not yet an owner-approved delivery schedule:

1. Observe the limited beta: onboarding friction, time to useful evidence,
   misleading results, support requests, reliability, and cost. Repair safety
   or correctness issues immediately; "after live" is not permission to defer
   known launch blockers.
2. Pilot independent read-only review of one change, then a bounded MR/PR
   adapter and repair/recheck loop. Evaluate a second provider before promising
   better review quality. Do not introduce a swarm to implement one reviewer.
3. Add one issue-tracker adapter: search/link/draft first, confirmed writes
   next, bounded opt-in automation only after duplicate/recovery validation.
4. Pilot comparison against a chosen design source, with clear visual-review
   scope and actual reference/capture provenance.
5. Extend the implemented session Activity with real delegation and readiness
   policy only through a separately scoped contract. Independent tasks may run
   in parallel when isolation, permissions, cost, and evidence ownership allow.

Embedded live browser/login/takeover/recording, safe replay, cloud executors,
per-PR environments, richer test intelligence, native Android/iOS execution,
organizations, and billing are separate optional workstreams. Reprioritize
from beta evidence; do not make all of them prerequisites for the first launch.

## Historical Approved Slice — Focused Tests (Superseded Presentation)

Update 2026-09-21: the owner approved and requested the bounded plan described
below, and it is implemented locally on `main`. See `TESTS_FOCUS_CHECKPOINT.md`
for changes, verification, recovery regressions and limits. The planning wording
below records the original scope; it is no longer an instruction to plan again.
Its standalone Tests presentation was followed by the unified session work above;
do not repeat this planning task or restore that navigation.

**Simplify the next action in the existing Tests surface.** This is a bridge
toward the coherent session, not a second redesign of the completed shell.

Inspect `QaWorkspacePage.vue`, `QaPlaywrightRunModal.vue`, QA presentation
helpers, and current regression tests. Plan one prominent state-dependent
action with nearby status/blocker/recovery guidance. Consolidate duplicated
execution entry points and move technical detail/history behind discoverable
controls. Keep the project, target, environment, risks, and real failures visible.

Reuse the current run modal and domain operations initially. Derive presentation
from canonical state; do not invent a second lifecycle. Preserve generated and
agent-provided checklists, explicit owner selection, exact Recipe/profile approval,
production confirmations, cancellation, evidence requirements, and Human Review.
Retain access to existing MCP/REST flows as secondary actions.

Acceptance: identify the next action for empty/loading, checklist selection,
missing/offline/incompatible Runner, absent/pending/failed Recipe review,
approval, running/cancelled/failed execution, missing evidence, and final review.
Explain disabled controls; verify stale owner/project responses, keyboard/focus,
en/ar/de/RTL, and the established responsive sizes with isolated fixture tests
and actual visual inspection. Record what was not exercised against real services.

No schema/API changes, chat/QA linkage, provider additions, MR/Jira/Figma adapter,
agent scheduler, streaming, new MCP, production mutation, commit, push, or deploy
belongs to this slice. The owner approved its implementation after planning.
Future expansion still needs separate approval. Work on `main` per owner
preference and preserve local previews and existing documentation edits.

## Historical Documentation Checkpoint — 2026-09-20

This discussion was documented on 2026-09-20. No new application capability,
provider review, real test run, migration, public release, or production-readiness
proof was created by this documentation task. Prior checks are historical
evidence, not a new release certification.
