# Oddpath Product And Launch UX Direction

Last updated: 2026-09-14

Status: owner priorities and product direction recorded for handoff. This is
not a finalized screen design, an implemented feature list, or authorization
to build every idea below. Read this before proposing the next UX workstream.
Operational release gates remain in `PRODUCTION_READINESS.md`.
The proposed whole-product page/navigation map is in
`PRODUCT_INFORMATION_ARCHITECTURE.md`. Its bounded phase-one shell was later
approved and implemented locally; see that file's 2026-09-14 checkpoint and
`UX_FEATURE_PRESERVATION.md`. The broader live-session brainstorm remains
unimplemented and is not blanket implementation authorization.
The existing first real-user rollout decision remains an invite-only beta;
this UX direction does not open public registration or waive its release gates.

## Owner Priority

The owner found the real first-test experience too complicated: too many
concepts, scattered actions, scrolling, dialogs, and manual setup explanations.
An easy, smooth first-test experience is a launch priority, not later polish.
A technically successful run does not establish that onboarding is usable.

The owner likes the perceived task focus and simplicity of Codex and Claude
Code. These are interaction references, not a decision to clone either UI or
to make a terminal the primary experience. Choose the layout through Oddpath
usability checks, not assumptions about which reference product is best.

## Product Thesis To Preserve

- Oddpath should complement capable agents rather than depend on having a
  uniquely smarter browser-clicking agent. Better models should improve the
  testing work without replacing the durable QA record or safety boundaries.
- The value is understandable, traceable, reviewable testing: what was tested,
  which instructions were approved, what happened, and what evidence supports
  the result. A live browser is a useful window into that work, not the whole
  product.
- Model improvements are an opportunity, not an automatic competitive moat.
  Useful evidence, low setup friction, trust, and repeat use must be validated.
- Do not rebuild the completed control plane merely to simplify its surface.
  Preserve project isolation, immutable artifacts, approvals, and history.

## Friction Reported By The Owner

- Project, Chat, Workspace, QA Request, Recipe, connection, and Runner appear
  as concepts the user must learn before finishing one test.
- The next action is distributed across pages, long scroll regions, and
  dialogs. The user repeatedly needed guidance about where to click next.
- A saved agent connection looks similar to a running local executor, even
  though the latter can be offline. Disabled approval felt like a broken UI.
- MCP's purpose was unclear during a run that actually used the built-in
  Playwright Runner path. MCP must not become mandatory setup for every test.
- The owner wants to see testing happen, including browser actions, and needs
  a clear way to handle a site that requires login without entering credentials
  into chat or learning terminal commands for routine interaction.

## Preferred UX Direction — Validate Before Implementation

Use one persistent test-session surface as the main experience. "Session" is
a user-facing organizing concept, not a decision to replace QA Request/Run
records, rename authentication sessions, or add a new database entity.

The proposed first-test journey is:

1. Describe the target and testing goal from one obvious starting point.
2. Resolve only the setup needed for this test in context. Keep the selected
   project, environment, and account scope visible without a separate tour.
3. Review a readable plan and give the required explicit execution approval.
4. Follow progress and, when useful, see the actual execution browser.
5. Inspect results with expected versus observed behavior and supporting proof.
6. Review the QA record or request changes; retain the history of attempts.

Keep the request, plan, execution status, and result within the same journey.
Prefer a clear primary next action per state, with a nearby explanation and
recovery action when blocked. Reveal hashes, manifests, raw logs, and detailed
history on demand; do not hide meaningful scope, risk, or failure information.

Projects remain organizational/security containers. Integrations belong in a
discoverable setup/settings surface, not a mandatory stop during every run.
Do not silently remove project scoping or create/move user data just to simplify
navigation. Whether to offer a default project or a particular sidebar layout
is still a design decision.

The browser view should be optional, not something users must watch to complete
a run. Distinguish live view, recorded evidence, and an offline executor
honestly. Do not substitute an unrelated iframe or simulated clicks for the
browser that actually executed the test.

## Three Near-Term Product Priorities

1. A coherent first-test journey with minimal concept/setup burden.
2. Clear execution progress and a deliberately scoped visual browser experience.
3. Actionable findings: expected behavior, observed behavior, failing step, and
   relevant evidence, rather than just a PASS/FAIL badge or step count.

These are priorities, not three features to implement simultaneously. Select
one bounded slice after the journey/prototype is reviewed. Preserve existing
auth, chat, project data, settings, i18n, portability, and QA workflows.

## Existing Foundation Versus Unbuilt Capabilities

The current harness already has locked context, immutable checklist/Recipe
revisions, exact approval, scoped REST/MCP connections, Runner leases,
version/idempotency guards, requirement-linked evidence, and append-only history.
The local Playwright/TEXT smoke reached owner-approved Human Review.

Important limits must stay explicit:

- Immutable instructions do not freeze the application build, local values,
  browser version, database, or authenticated state. Full reproducibility is
  not established by the public profile hash.
- Runner TEXT evidence currently summarizes status, completed-step count, and
  the first incomplete step. Real assertions execute, but measured actual
  values are not retained by that formatter. Evidence presence is not the same
  as sufficient diagnostic detail. See `apps/runner/src/execution.ts` and
  `apps/runner/src/interpreter.ts`.
- Local visible-browser execution is not an embedded live stream. Streaming,
  input ownership, pause/takeover, and resume checkpoints are not implemented
  session features. Do not present them as styling-only changes.
- Runner screenshot support exists, but real private-upload/SCREENSHOT and
  deployed recovery validation remain separate open gates. Keep production
  private assets disabled until the activation proof in
  `PRODUCTION_READINESS.md` is satisfied.
- Gemini is the current runtime text provider and Playwright the executor.
  Agent-neutral boundaries are not proof that every external client was tested.

## Safety And Login Design Constraints

- Keep owner-only selection/review, exact execution approval, and production
  confirmations. Fewer screens must not mean implicit consent or weaker scope.
- Distinguish plan/execution approval from final QA-record review. A recorded
  FAIL is not automatically a confirmed product bug; an approved QA record is
  not a guarantee that a release is safe.
- Design direct browser login as a scoped capability, not a demand for secrets
  in chat. Preserve local-secret handling; protect stored cookies and prevent
  sensitive fields, tokens, or response bodies from leaking into evidence.
- Cross-domain login/SSO needs deliberate design because the current Runner
  restricts top-level navigation to the approved origin. Do not remove that
  protection casually to make a demo work.
- Pause/takeover must define who controls input and record human intervention.
  Changes outside the approved instructions need explicit scope handling.
- "Retry from here" is not a generic safe shortcut: prior browser actions may
  already have changed server data or created an order. Define replay/reset
  semantics before offering it; preserve prior attempts and their evidence.

## Decisions Still Open

- The initial tester persona/use case within the invite-only beta and whether
  executor delivery is a local companion, desktop experience, hosted Runner,
  or a deliberately limited mix.
  Do not promise zero-install browser execution with today's local CLI.
- How a first-time user connects the executor with minimal friction. Routine
  use should not require terminal knowledge; packaging and first-time setup
  still need an explicit decision and realistic validation.
- The first visual scope: local browser visibility, embedded read-only live
  view, or richer interaction. Playback and live control are different features.
- The exact information architecture, login/session lifetime, safe takeover,
  and evidence capture/redaction scope. Prototype these before broad changes.

## Proposed Usability Acceptance Checks

Validate with someone unfamiliar with Oddpath; these are not completed tests.

- They can start and complete a first scoped test without chat-by-chat coaching
  or having to understand MCP, hashes, or the internal lifecycle vocabulary.
- At each state they can identify what is happening, what is needed from them,
  and the next action. Offline/setup/review failures have actionable recovery.
- The core flow does not require repeated page switching, nested dialogs, or
  searching a long page for its next button. Advanced controls stay available.
- Login/setup does not lose the task or expose credentials. Leaving and
  returning does not create a duplicate run or imply one stopped when it did not.
- They can explain a result from its evidence and distinguish a failed check,
  an execution/setup error, and a decision still awaiting review.
- Keyboard use, focus, smaller screens, and existing en/ar/de and RTL behavior
  remain usable. Measure time to first meaningful result, help requests, dead
  ends, and navigation effort before/after; agree targets after a baseline.

## Deferred — Not Launch Prerequisites By Default

The external AI brainstorm is inspiration, not an accepted implementation
backlog. Do not automatically add per-PR environments, database snapshots,
change-impact intelligence, flaky-test clustering, autonomous release decisions,
many integrations, billing, or native Android/iOS execution to this UX phase.
Mobile testing is a future owner interest; responsive web checks are not native
mobile-app testing. Keep extension boundaries sensible without building a
universal execution platform now.

## Next Conversation

### First Concept Checkpoint — 2026-09-12

An interactive conversation-only concept now explores the public login-page
example: request, simulated offline setup, readable plan/approval, illustrative
browser progress, expected/observed evidence, and final record review. It also
includes failed-review recovery, request changes, and English/Arabic layouts.
Its source is local to this thread at
`C:/Users/hatem/.codex/visualizations/2026/08/07/019fdd33-3d71-7d62-8cec-eb3f36e90c78/oddpath-first-test-session.html`.

This is an unapproved prototype, not a changed application route, real browser
stream, AI-generated plan, working executor connection, or persisted QA record.
The setup shortcut is explicitly simulated; it does not solve installation.
Direct login/takeover and safe replay remain undecided. The owner's first
feedback was that the flow is better but still has too many steps. They asked
to resolve the public/post-login home, sidebar, chat, and projects together.
This is not design acceptance. See `PRODUCT_INFORMATION_ARCHITECTURE.md` for
the code-audited proposal; automated interaction/layout checks do not replace
owner review or an unassisted usability trial.

### Resume Guidance

Read `AI_HANDOFF.md`, this document, and the relevant part of `NEXT_STEPS.md`.
Start by checking Git state and preserving untracked preview/design files.
Those previews are exploratory, not an approved design specification.

The next task is to review the proposed whole-product information architecture
and prototype its connected home/project/session shell. Reduce the first
concept's extra steps while retaining offline/setup, approval, running, failure,
and review states. Compare with the actual old flow and agree a bounded
implementation slice before changing application routes or domain behavior.
Read the QA control-plane/harness contracts before changing their behavior.
Do not reopen the approved smoke, trigger deployment, or implement the full
brainstorm simply because this handoff mentions those possibilities.
