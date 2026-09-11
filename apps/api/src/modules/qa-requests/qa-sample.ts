export function getQaWorkspaceSample(projectId: string) {
  const createdAt = "2026-01-01T00:00:00.000Z";
  const artifactId = "sample-artifact";
  const runId = "sample-run";

  return {
    sample: true,
    id: "sample-checkout-qa",
    projectId,
    title: "Checkout QA",
    objective: "Verify the critical checkout path and preserve reviewable proof.",
    target: "Checkout",
    environment: "Staging",
    acceptanceNotes: "Payment succeeds, failures are understandable, and no duplicate order is created.",
    phase: "READY_FOR_REVIEW",
    version: 7,
    selectedArtifactId: artifactId,
    createdAt,
    updatedAt: createdAt,
    contextSnapshots: [{
      id: "sample-context",
      version: 1,
      schemaVersion: 1,
      payloadHash: "sample",
      retrievalMode: "SAMPLE",
      degraded: false,
      createdAt,
    }],
    artifacts: [{
      id: artifactId,
      requestId: "sample-checkout-qa",
      revision: 1,
      origin: "ODDPATH_GENERATED",
      title: "Checkout critical path",
      lockedAt: createdAt,
      createdAt,
      assessments: [{
        id: "sample-assessment",
        status: "PASSED",
        summary: "Checklist is scoped, executable, and evidence-ready.",
        suggestions: [],
        completedAt: createdAt,
        createdAt,
      }],
      items: [
        sampleItem("sample-item-card", 0, "Card payment succeeds", "P0", "A single order and payment confirmation are created", "SCREENSHOT", "Confirmation with order reference"),
        sampleItem("sample-item-decline", 1, "Declined card is recoverable", "P0", "The payment is declined without creating an order", "LOG", "Gateway decline and application correlation id"),
        sampleItem("sample-item-double", 2, "Double submit stays idempotent", "P1", "Only one charge and one order are created", "TRACE", "Request trace showing the idempotency key"),
        sampleItem("sample-item-guest", 3, "Guest checkout preserves cart", "P1", "The cart remains available after a recoverable failure", "SCREENSHOT", "Cart state after retry"),
      ],
    }],
    runs: [{
      id: runId,
      requestId: "sample-checkout-qa",
      artifactId,
      status: "RESULTS_SUBMITTED",
      outcome: "FAIL",
      version: 6,
      sourceLabel: "Codex via MCP",
      externalRunRef: "sample-run-1042",
      commitSha: "8e10f21",
      startedAt: createdAt,
      submittedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
      results: [
        sampleResult("sample-result-card", runId, "sample-item-card", "PASS", "Order #1042 created once."),
        sampleResult("sample-result-decline", runId, "sample-item-decline", "FAIL", "A duplicate pending order was created."),
        sampleResult("sample-result-double", runId, "sample-item-double", "PASS", "Second request reused the first result."),
        sampleResult("sample-result-guest", runId, "sample-item-guest", "PASS", "Cart state remained intact."),
      ],
      evidence: [{
        id: "sample-evidence",
        runId,
        checklistItemId: "sample-item-decline",
        requirementId: "sample-item-decline-requirement",
        actorKind: "INTEGRATION",
        transport: "MCP",
        kind: "LOG",
        textContent: "payment.declined followed by order.pending for the same correlation id",
        externalReference: "https://example.invalid/runs/sample-run-1042",
        metadata: { source: "Codex", sample: true },
        createdAt,
        assets: [],
      }],
    }],
    reviews: [],
    events: [
      sampleEvent(1, "REQUEST_CREATED", "USER", "WEB", createdAt),
      sampleEvent(2, "CHECKLIST_SUBMITTED", "SYSTEM", "SYSTEM", createdAt),
      sampleEvent(3, "RUN_STARTED", "INTEGRATION", "MCP", createdAt),
      sampleEvent(4, "RUN_RESULTS_SUBMITTED", "INTEGRATION", "MCP", createdAt),
    ],
  };
}

function sampleItem(
  id: string,
  ordinal: number,
  title: string,
  priority: string,
  expectedResult: string,
  evidenceKind: string,
  evidenceDescription: string
) {
  return {
    id,
    artifactId: "sample-artifact",
    ordinal,
    clientRef: `checkout-${ordinal + 1}`,
    title,
    category: "Functional",
    priority,
    preconditions: ["Checkout test data is available"],
    steps: ["Open checkout", "Complete the scenario", "Observe the resulting order and payment state"],
    expectedResult,
    createdAt: "2026-01-01T00:00:00.000Z",
    evidenceRequirements: [{
      id: `${id}-requirement`,
      checklistItemId: id,
      ordinal: 0,
      kind: evidenceKind,
      description: evidenceDescription,
      required: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    }],
  };
}

function sampleResult(id: string, runId: string, checklistItemId: string, status: string, observedResult: string) {
  return {
    id,
    runId,
    checklistItemId,
    status,
    observedResult,
    notes: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
}

function sampleEvent(sequence: number, type: string, actorKind: string, transport: string, createdAt: string) {
  return {
    id: `sample-event-${sequence}`,
    requestId: "sample-checkout-qa",
    sequence,
    type,
    actorKind,
    transport,
    metadata: { sample: true },
    createdAt,
  };
}
