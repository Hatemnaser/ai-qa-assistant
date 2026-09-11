import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  addQaEvidenceSchema,
  qaChecklistDraftSchema,
} from "../src/modules/qa-requests/qa-requests.schema.ts";

describe("QA request schemas", () => {
  it("accepts agent-native text logs and traces without a private file upload", () => {
    assert.equal(addQaEvidenceSchema.safeParse({
      assetIds: [],
      kind: "LOG",
      textContent: "payment.declined correlation_id=abc",
    }).success, true);
    assert.equal(addQaEvidenceSchema.safeParse({
      assetIds: [],
      kind: "TRACE",
      textContent: "checkout -> payment -> order",
    }).success, true);
  });

  it("requires screenshot and file evidence to have an asset or reference", () => {
    assert.equal(addQaEvidenceSchema.safeParse({
      assetIds: [],
      kind: "SCREENSHOT",
      textContent: "A screenshot existed locally.",
    }).success, false);
    assert.equal(addQaEvidenceSchema.safeParse({
      assetIds: [],
      externalReference: "https://example.invalid/artifacts/checkout.png",
      kind: "SCREENSHOT",
    }).success, true);
    assert.equal(addQaEvidenceSchema.safeParse({
      assetIds: [],
      externalReference: "screenshot-on-my-laptop",
      kind: "SCREENSHOT",
    }).success, false);
  });

  it("rejects checklist items that do not define their proof requirements", () => {
    const result = qaChecklistDraftSchema.safeParse({
      title: "Checkout",
      items: [{
        evidenceRequirements: [],
        expectedResult: "Order is created once.",
        preconditions: [],
        steps: ["Submit checkout"],
        title: "Successful checkout",
      }],
    });
    assert.equal(result.success, false);
  });
});
