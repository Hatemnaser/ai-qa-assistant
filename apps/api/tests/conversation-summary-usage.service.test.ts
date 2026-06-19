import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createConversationSummaryUsageService } from "../src/modules/usage/conversation-summary-usage.service.ts";
import type {
  AiOperationReservation,
  AiOperationReservationInput,
  AiOperationUsageService,
  AiOperationCompletionInput,
  AiOperationFailureInput,
} from "../src/modules/usage/usage.service.ts";
import { CONVERSATION_SUMMARY_ACTION } from "../src/modules/usage/usage.types.ts";

describe("conversation summary usage service", () => {
  it("reserves summary generation through the global AI operation guard", async () => {
    const usage = createFakeOperationUsageService();
    const service = createConversationSummaryUsageService(usage);

    const reservation = await service.start({
      estimatedPromptTokens: 120,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });
    await service.complete(reservation, {
      inputTokens: 100,
      outputTokens: 40,
      totalTokens: 140,
    });

    assert.deepEqual(usage.reservations[0], {
      action: CONVERSATION_SUMMARY_ACTION,
      estimatedOutputTokens: 750,
      estimatedPromptTokens: 120,
      estimatedTotalTokens: 870,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });
    assert.deepEqual(usage.completions[0], {
      completion: {
        outputTokens: 40,
        promptTokens: 100,
        totalTokens: 140,
      },
      reservation,
    });
  });

  it("marks failed summary provider work through operation usage", async () => {
    const usage = createFakeOperationUsageService();
    const service = createConversationSummaryUsageService(usage);
    const reservation = await service.start({
      estimatedPromptTokens: 20,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });

    await service.fail(reservation);

    assert.deepEqual(usage.failures[0], {
      failure: undefined,
      reservation,
    });
  });
});

interface FakeOperationUsageService extends AiOperationUsageService {
  completions: Array<{
    completion?: AiOperationCompletionInput;
    reservation?: AiOperationReservation;
  }>;
  failures: Array<{
    failure?: AiOperationFailureInput;
    reservation?: AiOperationReservation;
  }>;
  reservations: AiOperationReservationInput[];
}

function createFakeOperationUsageService(): FakeOperationUsageService {
  const usage: FakeOperationUsageService = {
    completions: [],
    failures: [],
    reservations: [],

    async completeAiOperation(reservation, completion) {
      usage.completions.push({
        completion,
        reservation,
      });
    },

    async failAiOperation(reservation, failure) {
      usage.failures.push({
        failure,
        reservation,
      });
    },

    async reserveAiOperation(input) {
      usage.reservations.push(input);

      return {
        action: input.action,
        eventId: `usage-${usage.reservations.length}`,
        model: input.model,
        provider: input.provider,
        reserved: 1,
      };
    },
  };

  return usage;
}
