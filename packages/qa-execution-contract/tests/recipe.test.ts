import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  executionClaimResponseV1Schema,
  executionTaskV1Schema,
  profileManifestV1Schema,
  recipeBundleV1Schema,
} from "../src/index.js";

const profile = {
  environmentKind: "TEST" as const,
  evidenceKinds: ["TEXT", "SCREENSHOT"] as const,
  executorKey: "playwright" as const,
  label: "Local checkout",
  manifestHash: "a".repeat(64),
  profileKey: "checkout.test",
  recipeSchemaVersions: [1] as const,
  schemaVersion: 1 as const,
  valueReferences: [{ key: "customer.email", secret: false }],
};

const bundle = {
  engine: "playwright" as const,
  items: [{
    checklistItemId: "item-1",
    steps: [
      { action: "navigate" as const, path: "/checkout", ref: "open-checkout", waitUntil: "domcontentloaded" as const },
      {
        action: "fill" as const,
        locator: { by: "label" as const, value: "Email" },
        ref: "fill-email",
        value: { key: "customer.email", source: "profile" as const },
      },
      {
        action: "expect" as const,
        expectation: {
          kind: "visible" as const,
          locator: { by: "role" as const, name: "Place order", role: "button" as const },
        },
        ref: "verify-submit",
      },
    ],
  }],
  schemaVersion: 1 as const,
};

describe("QA execution contract", () => {
  it("accepts a bounded semantic Playwright recipe and public profile manifest", () => {
    assert.equal(recipeBundleV1Schema.parse(bundle).engine, "playwright");
    assert.equal(profileManifestV1Schema.parse(profile).environmentKind, "TEST");
  });

  it("rejects arbitrary navigation origins, duplicate coverage, and recipes without assertions", () => {
    assert.equal(recipeBundleV1Schema.safeParse({
      ...bundle,
      items: [{
        checklistItemId: "item-1",
        steps: [{ action: "navigate", path: "https://attacker.example", ref: "open" }],
      }],
    }).success, false);
    assert.equal(recipeBundleV1Schema.safeParse({
      ...bundle,
      items: [bundle.items[0], bundle.items[0]],
    }).success, false);
  });

  it("requires execution tasks to cover the immutable checklist exactly", () => {
    const parsed = executionTaskV1Schema.safeParse({
      artifact: {
        id: "artifact-1",
        items: [{
          clientRef: null,
          evidenceRequirements: [{
            description: "Capture confirmation",
            id: "requirement-1",
            kind: "SCREENSHOT",
            required: true,
          }],
          expectedResult: "Order confirmation is visible.",
          id: "different-item",
          ordinal: 0,
          title: "Checkout succeeds",
        }],
        revision: 1,
        title: "Checkout",
      },
      deadlineAt: "2026-08-30T12:00:00.000Z",
      executionId: "execution-1",
      profile,
      projectId: "project-1",
      recipe: { bundle, hash: "b".repeat(64), id: "recipe-1", revision: 1 },
      requestId: "request-1",
      runId: "run-1",
      runVersion: 1,
      schemaVersion: 1,
    });
    assert.equal(parsed.success, false);
  });

  it("uses a flat claim response and represents an empty queue explicitly", () => {
    assert.deepEqual(executionClaimResponseV1Schema.parse({ claim: null }), { claim: null });
    assert.equal(
      executionClaimResponseV1Schema.safeParse({ claim: { claim: null } }).success,
      false
    );
  });
});
