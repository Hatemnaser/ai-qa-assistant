import type { ClaimedExecution, ManagedClaimedExecution } from "../src/http-client.js";
import { profileManifestV2Schema, executionTaskV2Schema, targetDefinitionSchema } from '@oddpath/qa-execution-contract';
import {
  buildPublicManifest,
  hashCanonicalJson,
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

export function managedClaimedExecution(): ManagedClaimedExecution {
  const legacy = claimedExecution();
  const definition = targetDefinitionSchema.parse({ baseUrl: 'https://example.com', environmentKind: 'STAGING' });
  const manifest = profileManifestV2Schema.parse({ schemaVersion: 2, profileKey: 'managed.staging', label: 'Managed staging', environmentKind: 'STAGING',
    evidenceKinds: ['TEXT'], recipeSchemaVersions: [1], executorKey: 'playwright', valueReferences: [], authentication: { kind: 'NONE' },
    executionLimits: { preparationTimeoutMs: 300000, executionTimeoutMs: 600000 },
    target: { ...definition, revision: 1, revisionId: 'revision-1', targetId: 'target-1', targetHash: hashCanonicalJson(definition) } });
  const profile = { ...manifest, manifestHash: hashCanonicalJson(manifest) };
  const bundle = legacy.task.recipe.bundle;
  bundle.items[0]!.steps = bundle.items[0]!.steps.filter(step => step.action !== 'fill');
  const recipe = { ...legacy.task.recipe, bundle, hash: hashCanonicalJson(bundle) };
  const approvedTime = Date.now(), approvedAt = new Date(approvedTime).toISOString(), expiresAt = new Date(approvedTime + 600000).toISOString();
  const approval = { id: 'approval-1', approvedAt, expiresAt, artifactId: legacy.task.artifact.id, profileManifestHash: profile.manifestHash,
    recipeHash: recipe.hash, recipeId: recipe.id, requestVersion: 1, targetRevisionId: profile.target.revisionId,
    targetHash: profile.target.targetHash, verificationId: 'proof-1' };
  const bindingHash = hashCanonicalJson({ ...approval, authentication: profile.authentication, executionLimits: profile.executionLimits, candidate: profile.target.candidate });
  return { claim: { ...legacy.claim, recipeHash: recipe.hash }, task: executionTaskV2Schema.parse({ ...legacy.task, schemaVersion: 2,
    profile, recipe, approval: { ...approval, bindingHash }, deadlineAt: expiresAt }) };
}
