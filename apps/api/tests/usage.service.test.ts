import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import {
  createUsageService,
  type GlobalAiUsageGuardConfig,
  type IdentityInFlightLimits,
} from "../src/modules/usage/usage.service.ts";
import { estimateChatCredits } from "../src/modules/usage/credit-policy.ts";
import { setSecurityEventLoggerForTests } from "../src/lib/security-events.ts";
import type {
  UsageCleanupStaleReservedInput,
  UsageCountInput,
  UsageEventRecord,
  UsageListInput,
  UsageRecordInput,
  UsageRepository,
  UsageReservationInput,
  UsageReservationRecord,
  UsageUpdateInput,
} from "../src/modules/usage/usage.types.ts";
import {
  AI_USAGE_ACTIONS,
  CHAT_MESSAGE_ACTION,
  CONVERSATION_SUMMARY_ACTION,
  DOCUMENT_EMBEDDING_ACTION,
} from "../src/modules/usage/usage.types.ts";

const NOW = new Date("2026-05-19T12:00:00.000Z");
const CHAT_CREDIT_ESTIMATE = {
  attachmentCount: 0,
  credits: 2,
  estimatedOutputTokens: 700,
  estimatedPromptTokens: 250,
  estimatedTotalTokens: 950,
  fileCount: 0,
  fixedCredits: 0,
  imageCount: 0,
  mode: "general",
  model: "gemini-3.1-flash-lite",
  modelRoutingSource: "policy",
  provider: "gemini",
  workflowIntent: "general_qa",
  workflowSource: "fallback",
};
let restoreSecurityEventLogger: (() => void) | undefined;

before(() => {
  restoreSecurityEventLogger = setSecurityEventLoggerForTests(() => {});
});

after(() => {
  restoreSecurityEventLogger?.();
});

describe("usage service", () => {
  it("reserves guest chat credits with both guest and IP tracking", async () => {
    const { repository, service } = setupUsageService();

    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
        ipAddress: "127.0.0.1",
      },
      CHAT_CREDIT_ESTIMATE
    );

    assert.equal(reservation.limit, 20);
    assert.equal(reservation.remaining, 18);
    assert.equal(reservation.used, 2);
    assert.equal(reservation.unit, "credits");
    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].guestId, "guest-1");
    assert.ok(repository.events[0].ipHash);
    assert.equal(repository.events[0].creditsReserved, 2);
    assert.equal(repository.events[0].model, "gemini-3.1-flash-lite");
    assert.equal(repository.events[0].userId, undefined);
  });

  it("rejects guests after the daily demo credit limit", async () => {
    const { repository, service } = setupUsageService([
      createUsageEvent({ guestId: "guest-1", units: 12 }),
      createUsageEvent({ guestId: "guest-1", units: 8 }),
    ]);

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            guestId: "guest-1",
            ipAddress: "127.0.0.1",
          },
          CHAT_CREDIT_ESTIMATE
        ),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 2);
  });

  it("keeps guest quota after guest cookie rotation when the IP matches", async () => {
    const { repository, service } = setupUsageService();

    await service.reserveChatCredits(
      {
        guestId: "guest-1",
        ipAddress: "127.0.0.1",
      },
      {
        ...CHAT_CREDIT_ESTIMATE,
        credits: 20,
      }
    );

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            guestId: "guest-2",
            ipAddress: "127.0.0.1",
          },
          {
            ...CHAT_CREDIT_ESTIMATE,
            credits: 1,
          }
        ),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 1);
  });

  it("does not exceed guest quota when reservations run concurrently", async () => {
    const { repository, service } = setupUsageService([], {
      identityInFlightLimits: {
        guest: 100,
        user: 100,
      },
    });
    const attempts = Array.from({ length: 25 }, () =>
      service.reserveChatCredits(
        {
          guestId: "guest-1",
          ipAddress: "127.0.0.1",
        },
        {
          ...CHAT_CREDIT_ESTIMATE,
          credits: 1,
        }
      )
    );
    const results = await Promise.allSettled(attempts);
    const accepted = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");

    assert.equal(accepted.length, 20);
    assert.equal(rejected.length, 5);
    assert.equal(repository.events.length, 20);
    assert.equal(
      repository.events.reduce((total, event) => total + event.units, 0),
      20
    );

    for (const result of rejected) {
      assert.equal(result.status, "rejected");
      assert.equal((result.reason as { code?: string }).code, "USAGE_LIMIT_REACHED");
    }
  });

  it("uses user credit limits for signed-in users", async () => {
    const { repository, service } = setupUsageService();

    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
        ipAddress: "127.0.0.1",
        userId: "user-1",
      },
      CHAT_CREDIT_ESTIMATE
    );

    assert.equal(reservation.limit, 100);
    assert.equal(reservation.remaining, 98);
    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].guestId, undefined);
    assert.equal(repository.events[0].ipHash, undefined);
    assert.equal(repository.events[0].userId, "user-1");
  });

  it("allows chat reservations before the global AI guard limits", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({ guestId: "guest-2", units: 3 }),
        createUsageEvent({ units: 2, userId: "user-2" }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 10,
          requestLimit: 5,
        }),
      }
    );

    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
      },
      CHAT_CREDIT_ESTIMATE
    );

    assert.equal(reservation.used, 2);
    assert.equal(repository.events.length, 3);
    assert.equal(repository.events[2].status, "reserved");
  });

  it("rejects guest chat reservations after the global AI credit limit", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({ guestId: "guest-2", units: 6 }),
        createUsageEvent({ units: 3, userId: "user-2" }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 10,
          requestLimit: 20,
        }),
      }
    );

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            guestId: "guest-1",
          },
          CHAT_CREDIT_ESTIMATE
        ),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        message: "AI usage is temporarily limited. Please try again later.",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 2);
  });

  it("rejects signed-in chat reservations after the global AI request limit", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({ guestId: "guest-2", units: 1 }),
        createUsageEvent({ units: 1, userId: "user-2" }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 100,
          requestLimit: 2,
        }),
      }
    );

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            userId: "user-1",
          },
          CHAT_CREDIT_ESTIMATE
        ),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 2);
  });

  it("enforces the rolling daily credit limit outside the hourly window", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({
          createdAt: new Date("2026-05-19T10:00:00.000Z"),
          units: 9,
          userId: "user-2",
        }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 100,
          dailyCreditLimit: 10,
          requestLimit: 100,
          windowMs: 60 * 60 * 1000,
        }),
      }
    );

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            userId: "user-1",
          },
          CHAT_CREDIT_ESTIMATE
        ),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 1);
  });

  it("enforces the calendar-month request limit outside the daily window", async () => {
    const monthlyEvents = Array.from({ length: 3 }, (_, index) =>
      createUsageEvent({
        createdAt: new Date(`2026-05-0${index + 1}T12:00:00.000Z`),
        id: `monthly-${index}`,
        units: 1,
      })
    );
    const { repository, service } = setupUsageService(monthlyEvents, {
      globalAiUsageGuard: createGlobalGuard({
        creditLimit: 100,
        dailyCreditLimit: 100,
        dailyRequestLimit: 100,
        monthlyRequestLimit: 3,
        requestLimit: 100,
      }),
    });

    await assert.rejects(
      () =>
        service.reserveAiOperation({
          action: DOCUMENT_EMBEDDING_ACTION,
          credits: 1,
          model: "embedding-model",
          provider: "gemini",
        }),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 3);
  });

  it("keeps stale non-chat reservations in conservative global accounting", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({
          action: DOCUMENT_EMBEDDING_ACTION,
          createdAt: new Date("2026-05-19T10:00:00.000Z"),
          status: "reserved",
          units: 9,
          userId: "user-2",
        }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 100,
          dailyCreditLimit: 10,
          requestLimit: 100,
        }),
      }
    );

    await assert.rejects(
      () =>
        service.reserveAiOperation({
          action: CONVERSATION_SUMMARY_ACTION,
          credits: 2,
          model: "summary-model",
          provider: "gemini",
          userId: "user-1",
        }),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 1);
  });

  it("reserves and completes non-chat AI operations through the global guard", async () => {
    const { repository, service } = setupUsageService();

    const reservation = await service.reserveAiOperation({
      action: CONVERSATION_SUMMARY_ACTION,
      estimatedOutputTokens: 750,
      estimatedPromptTokens: 120,
      model: "summary-model",
      provider: "test-provider",
      userId: "user-1",
    });
    await service.completeAiOperation(reservation, {
      outputTokens: 40,
      promptTokens: 100,
      totalTokens: 140,
    });

    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].action, CONVERSATION_SUMMARY_ACTION);
    assert.equal(repository.events[0].status, "completed");
    assert.equal(repository.events[0].units, 1);
    assert.equal(repository.events[0].model, "summary-model");
    assert.equal(repository.events[0].provider, "test-provider");
  });

  it("applies global AI limits across chat and non-chat operations", async () => {
    const { repository, service } = setupUsageService(
      [
        createUsageEvent({
          action: "chat_message",
          units: 9,
        }),
      ],
      {
        globalAiUsageGuard: createGlobalGuard({
          creditLimit: 10,
          requestLimit: 20,
        }),
      }
    );

    await assert.rejects(
      () =>
        service.reserveAiOperation({
          action: DOCUMENT_EMBEDDING_ACTION,
          credits: 2,
          model: "embedding-model",
          provider: "gemini",
        }),
      {
        code: "AI_USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 1);
  });

  it("ignores old usage events outside the active window", async () => {
    const { service } = setupUsageService([
      createUsageEvent({
        createdAt: new Date("2026-05-17T12:00:00.000Z"),
        guestId: "guest-1",
        units: 20,
      }),
      createUsageEvent({
        createdAt: new Date("2026-05-19T10:00:00.000Z"),
        guestId: "guest-1",
        units: 5,
      }),
    ]);

    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
      },
      CHAT_CREDIT_ESTIMATE
    );

    assert.equal(reservation.used, 7);
    assert.equal(reservation.remaining, 13);
  });

  it("updates reserved credits with actual token usage", async () => {
    const { repository, service } = setupUsageService();
    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
      },
      {
        ...CHAT_CREDIT_ESTIMATE,
        credits: 5,
      }
    );

    const completed = await service.completeChatCredits(reservation, {
      model: "gemini-3.1-flash-lite",
      outputTokens: 250,
      promptTokens: 250,
      provider: "gemini",
      totalTokens: 500,
    });

    assert.equal(completed.used, 1);
    assert.equal(completed.remaining, 19);
    assert.equal(repository.events[0].creditsUsed, 1);
    assert.equal(repository.events[0].units, 1);
    assert.equal(repository.events[0].status, "completed");
    assert.equal(repository.events[0].totalTokens, 500);
  });

  it("preserves attachment and workflow-router charges when actual tokens settle", async () => {
    const { repository, service } = setupUsageService();
    const estimate = estimateChatCredits({
      attachments: [
        {
          content: "a,b\n1,2",
          mimeType: "text/csv",
          name: "cases.csv",
          type: "file",
        },
      ],
      history: [],
      imageCount: 1,
      message: "Review these attachments",
      mode: "general",
      model: "gemini-3.1-flash-lite",
      modelRouting: {
        reason: "policy",
        requestedModel: "gemini-3.1-flash-lite",
        selectedModel: "gemini-3.1-flash-lite",
        source: "policy",
      },
      provider: "gemini",
      usesWorkflowRouter: true,
      workflow: {
        confidence: 0.5,
        effectiveMode: "general",
        intent: "general_qa",
        language: "english",
        shouldAskClarifyingQuestion: false,
        shouldUseArtifactTemplate: false,
        source: "fallback",
      },
    });
    const reservation = await service.reserveChatCredits(
      { userId: "user-1" },
      estimate
    );

    await service.completeChatCredits(reservation, {
      model: "gemini-3.1-flash-lite",
      outputTokens: 200,
      promptTokens: 300,
      provider: "gemini",
      totalTokens: 500,
    });

    assert.equal(estimate.fixedCredits, 6);
    assert.equal(repository.events[0].creditsUsed, 7);
    assert.equal(repository.events[0].units, 7);
  });

  it("keeps a conservative charge when a provider attempt fails with unknown billing", async () => {
    const { repository, service } = setupUsageService();
    const reservation = await service.reserveChatCredits(
      { guestId: "guest-1" },
      {
        ...CHAT_CREDIT_ESTIMATE,
        credits: 4,
      }
    );
    reservation.generationAttempts = 1;
    reservation.providerAttempts = 1;

    const failed = await service.failChatCredits(reservation, {
      model: "gemini-3.1-flash-lite",
      provider: "gemini",
      providerAttempts: 1,
    });

    assert.equal(failed.used, 4);
    assert.equal(failed.remaining, 16);
    assert.equal(repository.events[0].creditsUsed, 4);
    assert.equal(repository.events[0].providerAttempts, 1);
    assert.equal(repository.events[0].status, "unknown");
    assert.equal(repository.events[0].units, 4);
  });

  it("accounts conservatively for a failed primary attempt before fallback succeeds", async () => {
    const { repository, service } = setupUsageService();
    const reservation = await service.reserveChatCredits(
      { userId: "user-1" },
      {
        ...CHAT_CREDIT_ESTIMATE,
        credits: 4,
      }
    );
    reservation.generationAttempts = 2;
    reservation.providerAttempts = 2;

    await service.completeChatCredits(reservation, {
      model: "gemini-2.5-flash-lite",
      outputTokens: 200,
      promptTokens: 300,
      provider: "gemini",
      totalTokens: 500,
    });

    assert.equal(repository.events[0].creditsUsed, 5);
    assert.equal(repository.events[0].providerAttempts, 2);
  });

  it("applies the signed-in daily budget across chat, summaries, and embeddings", async () => {
    const { service } = setupUsageService([
      createUsageEvent({
        action: CHAT_MESSAGE_ACTION,
        units: 97,
        userId: "user-1",
      }),
      createUsageEvent({
        action: DOCUMENT_EMBEDDING_ACTION,
        units: 2,
        userId: "user-1",
      }),
    ]);

    await assert.rejects(
      () =>
        service.reserveAiOperation({
          action: CONVERSATION_SUMMARY_ACTION,
          credits: 2,
          model: "summary-model",
          provider: "gemini",
          userId: "user-1",
        }),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
  });

  it("limits concurrent signed-in AI operations across action types", async () => {
    const { service } = setupUsageService([
      createUsageEvent({
        action: CHAT_MESSAGE_ACTION,
        status: "reserved",
        units: 1,
        userId: "user-1",
      }),
      createUsageEvent({
        action: DOCUMENT_EMBEDDING_ACTION,
        status: "reserved",
        units: 1,
        userId: "user-1",
      }),
      createUsageEvent({
        action: CONVERSATION_SUMMARY_ACTION,
        status: "reserved",
        units: 1,
        userId: "user-1",
      }),
    ]);

    await assert.rejects(
      () =>
        service.reserveAiOperation({
          action: DOCUMENT_EMBEDDING_ACTION,
          credits: 1,
          model: "embedding-model",
          provider: "gemini",
          userId: "user-1",
        }),
      {
        code: "AI_IN_FLIGHT_LIMIT_REACHED",
        statusCode: 429,
      }
    );
  });

  it("records provider attempts before operation completion", async () => {
    const { repository, service } = setupUsageService();
    const reservation = await service.reserveAiOperation({
      action: DOCUMENT_EMBEDDING_ACTION,
      credits: 1,
      model: "embedding-model",
      provider: "gemini",
      userId: "user-1",
    });

    await service.recordAiOperationAttempt(reservation);

    assert.equal(repository.events[0].providerAttempts, 1);
  });

  it("releases reserved credits when the AI request fails", async () => {
    const { repository, service } = setupUsageService();
    const reservation = await service.reserveChatCredits(
      {
        guestId: "guest-1",
      },
      {
        ...CHAT_CREDIT_ESTIMATE,
        credits: 4,
      }
    );

    const failed = await service.failChatCredits(reservation, {
      model: "gemini-3.1-flash-lite",
      provider: "gemini",
    });

    assert.equal(failed.used, 0);
    assert.equal(failed.remaining, 20);
    assert.equal(repository.events[0].creditsUsed, 0);
    assert.equal(repository.events[0].units, 0);
    assert.equal(repository.events[0].status, "failed");
  });

  it("marks stale reservations unknown without erasing potentially billed usage", async () => {
    const staleReserved = createUsageEvent({
      createdAt: new Date("2026-05-19T11:20:00.000Z"),
      creditsReserved: 20,
      guestId: "guest-1",
      status: "reserved",
      units: 20,
    });
    const { repository, service } = setupUsageService([staleReserved]);

    await assert.rejects(
      () =>
        service.reserveChatCredits(
          {
            guestId: "guest-1",
          },
          CHAT_CREDIT_ESTIMATE
        ),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );

    assert.equal(repository.events[0].id, staleReserved.id);
    assert.equal(repository.events[0].status, "unknown");
    assert.equal(repository.events[0].creditsUsed, undefined);
    assert.equal(repository.events[0].units, 20);
    assert.equal(repository.events.length, 1);
  });

  it("does not clean recent reserved chat credits", async () => {
    const { repository, service } = setupUsageService([
      createUsageEvent({
        createdAt: new Date("2026-05-19T11:45:00.000Z"),
        guestId: "guest-1",
        status: "reserved",
        units: 18,
      }),
    ]);

    await service.cleanupStaleReservedChatCredits({
      guestId: "guest-1",
    });

    assert.equal(repository.events[0].status, "reserved");
    assert.equal(repository.events[0].units, 18);
  });

  it("does not clean completed or failed chat usage events", async () => {
    const { repository, service } = setupUsageService([
      createUsageEvent({
        createdAt: new Date("2026-05-19T11:00:00.000Z"),
        creditsUsed: 12,
        guestId: "guest-1",
        status: "completed",
        units: 12,
      }),
      createUsageEvent({
        createdAt: new Date("2026-05-19T11:00:00.000Z"),
        creditsUsed: 0,
        guestId: "guest-1",
        status: "failed",
        units: 0,
      }),
    ]);

    await service.cleanupStaleReservedChatCredits({
      guestId: "guest-1",
    });

    assert.equal(repository.events[0].status, "completed");
    assert.equal(repository.events[0].creditsUsed, 12);
    assert.equal(repository.events[0].units, 12);
    assert.equal(repository.events[1].status, "failed");
    assert.equal(repository.events[1].creditsUsed, 0);
    assert.equal(repository.events[1].units, 0);
  });

  it("does not clean stale reserved usage for a different signed-in user", async () => {
    const { repository, service } = setupUsageService([
      createUsageEvent({
        createdAt: new Date("2026-05-19T11:00:00.000Z"),
        status: "reserved",
        units: 8,
        userId: "user-2",
      }),
    ]);

    await service.cleanupStaleReservedChatCredits({
      userId: "user-1",
    });

    assert.equal(repository.events[0].status, "reserved");
    assert.equal(repository.events[0].units, 8);
  });

  it("summarizes current identity usage by model and status", async () => {
    const { service } = setupUsageService([
      createUsageEvent({
        creditsUsed: 3,
        guestId: "guest-1",
        model: "gemini-3.1-flash-lite",
        provider: "gemini",
        status: "completed",
        totalTokens: 2500,
        units: 3,
      }),
      createUsageEvent({
        creditsUsed: 0,
        guestId: "guest-1",
        model: "gemini-2.5-flash",
        provider: "gemini",
        status: "failed",
        units: 0,
      }),
      createUsageEvent({
        createdAt: new Date("2026-05-17T11:00:00.000Z"),
        guestId: "guest-1",
        units: 10,
      }),
      createUsageEvent({
        guestId: "guest-2",
        units: 8,
      }),
    ]);

    const summary = await service.getChatCreditInsights({
      guestId: "guest-1",
    });

    assert.equal(summary.identityType, "guest");
    assert.equal(summary.limit, 20);
    assert.equal(summary.used, 3);
    assert.equal(summary.remaining, 17);
    assert.deepEqual(summary.statusTotals, [
      {
        credits: 3,
        requests: 1,
        status: "completed",
      },
      {
        credits: 0,
        requests: 1,
        status: "failed",
      },
    ]);
    assert.equal(summary.modelTotals[0]?.model, "gemini-3.1-flash-lite");
    assert.equal(summary.modelTotals[0]?.credits, 3);
    assert.equal(summary.recentEvents.length, 2);
  });
});

function setupUsageService(
  initialEvents: FakeUsageEvent[] = [],
  options: UsageServiceTestOptions = {}
): UsageServiceTestContext {
  const repository = createFakeUsageRepository(initialEvents);
  const service = createUsageService({
    globalAiUsageGuard: options.globalAiUsageGuard,
    identityInFlightLimits: options.identityInFlightLimits,
    now: () => NOW,
    repository,
  });

  return {
    repository,
    service,
  };
}

interface UsageServiceTestContext {
  repository: FakeUsageRepository;
  service: ReturnType<typeof createUsageService>;
}

interface UsageServiceTestOptions {
  globalAiUsageGuard?: GlobalAiUsageGuardConfig;
  identityInFlightLimits?: IdentityInFlightLimits;
}

function createFakeUsageRepository(initialEvents: FakeUsageEvent[] = []): FakeUsageRepository {
  const repository: FakeUsageRepository = {
    events: [...initialEvents],
    reserveQueue: Promise.resolve(),

    async cleanupStaleReservedUsage(input: UsageCleanupStaleReservedInput): Promise<number> {
      let cleaned = 0;

      for (const event of repository.events) {
        if (!matchesStaleReservedCleanupInput(event, input)) continue;

        event.status = "unknown";
        cleaned += 1;
      }

      return cleaned;
    },

    async countUsage(input: UsageCountInput): Promise<number> {
      return repository.events
        .filter((event: FakeUsageEvent) => {
          if (event.action !== input.action) return false;
          if (event.createdAt < input.since) return false;
          if (input.userId !== undefined && event.userId !== input.userId) return false;
          if (input.guestId !== undefined && event.guestId !== input.guestId) return false;
          if (input.ipHash !== undefined && event.ipHash !== input.ipHash) return false;

          return true;
        })
        .reduce((total, event) => total + event.units, 0);
    },

    async listUsageEvents(input: UsageListInput): Promise<UsageEventRecord[]> {
      return repository.events
        .filter((event: FakeUsageEvent) => {
          if (event.action !== input.action) return false;
          if (event.createdAt < input.since) return false;
          if (input.userId !== undefined) return event.userId === input.userId;

          const matchesGuest = input.guestId !== undefined && event.guestId === input.guestId;
          const matchesIp = input.ipHash !== undefined && event.ipHash === input.ipHash;

          return matchesGuest || matchesIp;
        })
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .map(toUsageEventRecord);
    },

    async recordUsage(input: UsageRecordInput): Promise<{ id: string }> {
      const event = createUsageEvent(input);
      repository.events.push(event);

      return {
        id: event.id,
      };
    },

    async recordUsageAttempt(id: string): Promise<void> {
      const event = repository.events.find((item) => item.id === id);

      if (event) {
        event.providerAttempts = (event.providerAttempts || 0) + 1;
      }
    },

    async reserveUsage(input: UsageReservationInput): Promise<UsageReservationRecord> {
      const result = repository.reserveQueue.then(() => reserveUsageWithFakeLock(repository, input));

      repository.reserveQueue = result.then(
        () => undefined,
        () => undefined
      );

      return result;
    },

    async updateUsage(input: UsageUpdateInput): Promise<void> {
      const event = repository.events.find((item) => item.id === input.id);

      if (!event) return;

      Object.assign(event, input);
    },
  };

  return repository;
}

async function reserveUsageWithFakeLock(
  repository: FakeUsageRepository,
  input: UsageReservationInput
): Promise<UsageReservationRecord> {
  if (input.globalGuard) {
    const windows = [input.globalGuard, ...(input.globalGuard.additionalWindows || [])];

    for (const window of windows) {
      const globalUsage = countGlobalUsage(repository, input, window.since);

      if (
        globalUsage.requestCount + 1 > window.requestLimit ||
        globalUsage.unitsUsed + input.requestedUnits > window.creditLimit
      ) {
        return {
          accepted: false,
          rejectionReason: "global_limit",
          usedAfter: globalUsage.unitsUsed,
          usedBefore: globalUsage.unitsUsed,
        };
      }
    }
  }

  const usedBefore = await countReservedScopeUsage(repository, input);

  if (usedBefore + input.requestedUnits > input.limit) {
    return {
      accepted: false,
      rejectionReason: "identity_limit",
      usedAfter: usedBefore,
      usedBefore,
    };
  }

  if (
    input.inFlightLimit !== undefined &&
    countInFlightScopeUsage(repository, input) >= input.inFlightLimit
  ) {
    return {
      accepted: false,
      rejectionReason: "identity_in_flight",
      usedAfter: usedBefore,
      usedBefore,
    };
  }

  const event = createUsageEvent(input.event);
  repository.events.push(event);

  return {
    accepted: true,
    eventId: event.id,
    usedAfter: usedBefore + input.requestedUnits,
    usedBefore,
  };
}

function countGlobalUsage(repository: FakeUsageRepository, input: UsageReservationInput, since: Date) {
  if (!input.globalGuard) {
    return {
      requestCount: 0,
      unitsUsed: 0,
    };
  }

  const events = repository.events.filter((event) =>
    matchesGlobalUsageGuardInput(event, input, since)
  );

  return {
    requestCount: events.length,
    unitsUsed: events.reduce((total, event) => total + event.units, 0),
  };
}

async function countReservedScopeUsage(
  repository: FakeUsageRepository,
  input: UsageReservationInput
) {
  if (input.isSignedIn) {
    return repository.events
      .filter((event) => matchesScopedUsageEvent(event, input))
      .reduce((total, event) => total + event.units, 0);
  }

  const counts = await Promise.all([
    input.guestId
      ? Promise.resolve(
          repository.events
            .filter(
              (event) =>
                matchesScopedUsageEvent(event, input) &&
                event.guestId === input.guestId
            )
            .reduce((total, event) => total + event.units, 0)
        )
      : 0,
    input.ipHash
      ? Promise.resolve(
          repository.events
            .filter(
              (event) =>
                matchesScopedUsageEvent(event, input) &&
                event.ipHash === input.ipHash
            )
            .reduce((total, event) => total + event.units, 0)
        )
      : 0,
  ]);

  return Math.max(...counts);
}

function countInFlightScopeUsage(
  repository: FakeUsageRepository,
  input: UsageReservationInput
) {
  return repository.events.filter((event) => {
    if (!matchesScopedUsageEvent(event, input)) return false;
    if (event.status !== "reserved") return false;
    if (
      input.globalGuard &&
      event.createdAt < input.globalGuard.staleReservedCutoff
    ) {
      return false;
    }

    if (input.isSignedIn) return event.userId === input.userId;

    return (
      (input.guestId !== undefined && event.guestId === input.guestId) ||
      (input.ipHash !== undefined && event.ipHash === input.ipHash)
    );
  }).length;
}

function matchesScopedUsageEvent(
  event: FakeUsageEvent,
  input: UsageReservationInput
) {
  const matchesAction = input.scopeActions?.length
    ? input.scopeActions.includes(event.action)
    : event.action === input.action;

  return matchesAction && event.createdAt >= input.since;
}

interface FakeUsageRepository extends UsageRepository {
  events: FakeUsageEvent[];
  reserveQueue: Promise<void>;
}

interface FakeUsageEvent extends UsageRecordInput {
  createdAt: Date;
  id: string;
}

function createUsageEvent(overrides: Partial<FakeUsageEvent> = {}): FakeUsageEvent {
  return {
    action: "chat_message",
    createdAt: NOW,
    id: `usage-${Math.random().toString(16).slice(2)}`,
    status: "completed",
    units: 1,
    ...overrides,
  };
}

function matchesStaleReservedCleanupInput(
  event: FakeUsageEvent,
  input: UsageCleanupStaleReservedInput
) {
  if (event.action !== input.action) return false;
  if (event.status !== "reserved") return false;
  if (event.createdAt >= input.cutoff) return false;

  if (input.userId) {
    return event.userId === input.userId;
  }

  const matchesGuest = input.guestId !== undefined && event.guestId === input.guestId;
  const matchesIp = input.ipHash !== undefined && event.ipHash === input.ipHash;

  return matchesGuest || matchesIp;
}

function matchesGlobalUsageGuardInput(
  event: FakeUsageEvent,
  input: UsageReservationInput,
  since = input.globalGuard?.since
) {
  if (!input.globalGuard) return false;
  if (!AI_USAGE_ACTIONS.includes(event.action as (typeof AI_USAGE_ACTIONS)[number])) return false;
  if (!since || event.createdAt < since) return false;

  return true;
}

function createGlobalGuard(
  overrides: Partial<GlobalAiUsageGuardConfig> = {}
): GlobalAiUsageGuardConfig {
  return {
    creditLimit: 100,
    dailyCreditLimit: 1_000,
    dailyRequestLimit: 1_000,
    monthlyCreditLimit: 10_000,
    monthlyRequestLimit: 10_000,
    requestLimit: 100,
    windowMs: 60 * 60 * 1000,
    ...overrides,
  };
}

function toUsageEventRecord(event: FakeUsageEvent): UsageEventRecord {
  return {
    attachmentCount: event.attachmentCount || 0,
    createdAt: event.createdAt,
    creditsReserved: event.creditsReserved ?? null,
    creditsUsed: event.creditsUsed ?? null,
    estimatedOutputTokens: event.estimatedOutputTokens ?? null,
    estimatedPromptTokens: event.estimatedPromptTokens ?? null,
    estimatedTotalTokens: event.estimatedTotalTokens ?? null,
    fileCount: event.fileCount || 0,
    id: event.id,
    imageCount: event.imageCount || 0,
    mode: event.mode ?? null,
    model: event.model ?? null,
    modelRoutingSource: event.modelRoutingSource ?? null,
    outputTokens: event.outputTokens ?? null,
    promptTokens: event.promptTokens ?? null,
    provider: event.provider ?? null,
    providerAttempts: event.providerAttempts || 0,
    status: event.status || "reserved",
    totalTokens: event.totalTokens ?? null,
    units: event.units,
    workflowIntent: event.workflowIntent ?? null,
    workflowSource: event.workflowSource ?? null,
  };
}
