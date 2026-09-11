import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createQaChecklistIntelligence } from "../src/modules/qa-requests/qa-checklist.intelligence.ts";
import type { QaContextSnapshotInput } from "../src/modules/qa-requests/qa-requests.types.ts";
import type { AiOperationUsageService } from "../src/modules/usage/usage.service.ts";
import { QA_CHECKLIST_GENERATION_ACTION } from "../src/modules/usage/usage.types.ts";

const SNAPSHOT: QaContextSnapshotInput = {
  degraded: false,
  payload: { request: { objective: "Verify checkout" } },
  payloadHash: "a".repeat(64),
  retrievalMode: "SHARED_PROJECT_RETRIEVER",
  sourceManifest: { documents: [] },
};

describe("QA checklist intelligence usage guard", () => {
  it("reserves, records, and completes paid provider work for the project owner", async () => {
    const calls: string[] = [];
    const usage = createUsage(calls);
    const intelligence = createQaChecklistIntelligence({
      async generateText(input) {
        calls.push(`provider:${input.provider}:${input.model}`);
        return {
          model: input.model!,
          provider: input.provider!,
          text: JSON.stringify({
            items: [{
              evidenceRequirements: [{ description: "Response log", kind: "TEXT" }],
              expectedResult: "One order exists.",
              preconditions: [],
              steps: ["Submit checkout"],
              title: "Checkout",
            }],
            title: "Checkout QA",
          }),
          usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
        };
      },
      usage,
    });

    const result = await intelligence.generate({
      requestId: "request-1",
      snapshot: SNAPSHOT,
      userId: "owner-1",
    });

    assert.equal(result.checklist.title, "Checkout QA");
    assert.equal(calls[0], `${QA_CHECKLIST_GENERATION_ACTION}:owner-1`);
    assert.equal(calls[1], "attempt");
    assert.match(calls[2] || "", /^provider:gemini:/);
    assert.equal(calls[3], "complete:140");
  });

  it("marks a reservation failed when the provider attempt fails", async () => {
    const calls: string[] = [];
    const intelligence = createQaChecklistIntelligence({
      async generateText() {
        calls.push("provider");
        throw new Error("provider unavailable");
      },
      usage: createUsage(calls),
    });

    await assert.rejects(
      () => intelligence.generate({ requestId: "request-1", snapshot: SNAPSHOT, userId: "owner-1" }),
      /provider unavailable/
    );
    assert.equal(calls.at(-1), "fail:true");
  });
});

function createUsage(calls: string[]): AiOperationUsageService {
  return {
    async reserveAiOperation(input) {
      calls.push(`${input.action}:${input.userId}`);
      return {
        action: input.action,
        eventId: "usage-1",
        model: input.model,
        provider: input.provider,
        reserved: 10,
      };
    },
    async recordAiOperationAttempt() {
      calls.push("attempt");
    },
    async completeAiOperation(_reservation, completion) {
      calls.push(`complete:${completion?.totalTokens}`);
    },
    async failAiOperation(_reservation, failure) {
      calls.push(`fail:${Boolean(failure?.providerAttempted)}`);
    },
  };
}
