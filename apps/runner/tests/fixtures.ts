import type { ClaimedExecution } from "../src/http-client.js";
import {
  buildPublicManifest,
  runnerConfigSchema,
  type RunnerConfig,
} from "../src/config.js";

export function testConfig(
  environmentKind: "LOCAL" | "TEST" | "STAGING" | "PRODUCTION" = "TEST"
): RunnerConfig {
  return runnerConfigSchema.parse({
    displayName: "Oddpath test runner",
    instanceId: "runner-test-1",
    profiles: [{
      baseUrl: "http://127.0.0.1:4173",
      environmentKind,
      evidenceKinds: ["TEXT", "SCREENSHOT"],
      key: "checkout.test",
      label: "Checkout test",
      values: {
        "customer.email": { secret: true, source: "env", name: "ODDPATH_TEST_EMAIL" },
      },
    }],
    schemaVersion: 1,
    serverUrl: "http://127.0.0.1:5000",
  });
}

export function claimedExecution(config = testConfig()): ClaimedExecution {
  const profile = buildPublicManifest(config.profiles[0]!);
  const deadlineAt = new Date(Date.now() + 60 * 60_000).toISOString();
  return {
    claim: {
      artifactId: "artifact-1",
      artifactRevision: 1,
      claimId: "11111111-1111-4111-8111-111111111111",
      executionId: "execution-1",
      leaseExpiresAt: new Date(Date.now() + 45_000).toISOString(),
      leaseToken: "l".repeat(43),
      recipeHash: "b".repeat(64),
    },
    task: {
      artifact: {
        id: "artifact-1",
        items: [{
          clientRef: "checkout",
          evidenceRequirements: [{
            description: "Describe the observed checkout state.",
            id: "requirement-text-1",
            kind: "TEXT",
            required: true,
          }],
          expectedResult: "The checkout confirmation is visible.",
          id: "item-1",
          ordinal: 0,
          title: "Successful checkout",
        }],
        revision: 1,
        title: "Checkout checklist",
      },
      deadlineAt,
      executionId: "execution-1",
      profile: { ...profile, manifestHash: profile.manifestHash! },
      projectId: "project-1",
      recipe: {
        bundle: {
          engine: "playwright",
          items: [{
            checklistItemId: "item-1",
            steps: [
              {
                action: "navigate",
                path: "/checkout",
                ref: "open-checkout",
                waitUntil: "domcontentloaded",
              },
              {
                action: "fill",
                locator: { by: "label", value: "Email" },
                ref: "fill-email",
                value: { key: "customer.email", source: "profile" },
              },
              {
                action: "expect",
                expectation: {
                  kind: "visible",
                  locator: { by: "role", name: "Place order", role: "button" },
                },
                ref: "verify-order",
              },
            ],
          }],
          schemaVersion: 1,
        },
        hash: "b".repeat(64),
        id: "recipe-1",
        revision: 1,
      },
      requestId: "request-1",
      runId: "run-1",
      runVersion: 1,
      schemaVersion: 1,
    },
  };
}

export function executionReceipt(
  runVersion: number,
  status: "CLAIMED" | "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" = "RUNNING"
) {
  return {
    executionId: "execution-1",
    leaseExpiresAt: status === "RUNNING" ? new Date(Date.now() + 45_000).toISOString() : null,
    requestPhase: status === "SUCCEEDED" ? "READY_FOR_REVIEW" as const : "RUNNING" as const,
    runId: "run-1",
    runVersion,
    status,
  };
}
