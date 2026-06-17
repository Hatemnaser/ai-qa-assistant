import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createConversationSummaryUsageService } from "../src/modules/usage/conversation-summary-usage.service.ts";
import type { UsageRepository } from "../src/modules/usage/usage.repository.ts";
import {
  CONVERSATION_SUMMARY_ACTION,
  type UsageRecordInput,
  type UsageUpdateInput,
} from "../src/modules/usage/usage.types.ts";

describe("conversation summary usage service", () => {
  it("records summary generation separately without consuming chat credits", async () => {
    const repository = createFakeUsageRepository();
    const service = createConversationSummaryUsageService(repository);

    const eventId = await service.start({
      estimatedPromptTokens: 120,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });
    await service.complete(eventId, {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    });

    assert.equal(repository.records[0]?.action, CONVERSATION_SUMMARY_ACTION);
    assert.equal(repository.records[0]?.creditsReserved, 0);
    assert.equal(repository.records[0]?.units, 0);
    assert.deepEqual(repository.updates[0], {
      creditsUsed: 0,
      id: "usage-1",
      outputTokens: 40,
      promptTokens: 100,
      status: "completed",
      totalTokens: 140,
      units: 0,
    });
  });

  it("marks failed provider work without charging credits", async () => {
    const repository = createFakeUsageRepository();
    const service = createConversationSummaryUsageService(repository);
    const eventId = await service.start({
      estimatedPromptTokens: 20,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });

    await service.fail(eventId);

    assert.deepEqual(repository.updates[0], {
      creditsUsed: 0,
      id: "usage-1",
      status: "failed",
      units: 0,
    });
  });
});

interface FakeUsageRepository extends UsageRepository {
  records: UsageRecordInput[];
  updates: UsageUpdateInput[];
}

function createFakeUsageRepository(): FakeUsageRepository {
  const repository: FakeUsageRepository = {
    records: [],
    updates: [],

    async countUsage() {
      return 0;
    },

    async listUsageEvents() {
      return [];
    },

    async recordUsage(input) {
      repository.records.push(input);

      return {
        id: `usage-${repository.records.length}`,
      };
    },

    async updateUsage(input) {
      repository.updates.push(input);
    },
  };

  return repository;
}
