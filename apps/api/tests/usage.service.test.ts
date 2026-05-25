import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUsageService } from "../src/modules/usage/usage.service.ts";
import type { UsageRepository } from "../src/modules/usage/usage.repository.ts";
import type {
  UsageCountInput,
  UsageEventRecord,
  UsageListInput,
  UsageRecordInput,
  UsageUpdateInput,
} from "../src/modules/usage/usage.types.ts";

const NOW = new Date("2026-05-19T12:00:00.000Z");
const CHAT_CREDIT_ESTIMATE = {
  attachmentCount: 0,
  credits: 2,
  estimatedOutputTokens: 700,
  estimatedPromptTokens: 250,
  estimatedTotalTokens: 950,
  fileCount: 0,
  imageCount: 0,
  mode: "general",
  model: "gemini-3.1-flash-lite",
  modelRoutingSource: "policy",
  provider: "gemini",
  workflowIntent: "general_qa",
  workflowSource: "fallback",
};

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

function setupUsageService(initialEvents: FakeUsageEvent[] = []): UsageServiceTestContext {
  const repository = createFakeUsageRepository(initialEvents);
  const service = createUsageService({
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

function createFakeUsageRepository(initialEvents: FakeUsageEvent[] = []): FakeUsageRepository {
  const repository: FakeUsageRepository = {
    events: [...initialEvents],

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

    async updateUsage(input: UsageUpdateInput): Promise<void> {
      const event = repository.events.find((item) => item.id === input.id);

      if (!event) return;

      Object.assign(event, input);
    },
  };

  return repository;
}

interface FakeUsageRepository extends UsageRepository {
  events: FakeUsageEvent[];
}

interface FakeUsageEvent extends UsageRecordInput {
  createdAt: Date;
  id: string;
}

function createUsageEvent(overrides: Partial<FakeUsageEvent> = {}): FakeUsageEvent {
  return {
    action: "chat_message",
    createdAt: new Date("2026-05-19T11:00:00.000Z"),
    id: `usage-${Math.random().toString(16).slice(2)}`,
    status: "reserved",
    units: 1,
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
    status: event.status || "reserved",
    totalTokens: event.totalTokens ?? null,
    units: event.units,
    workflowIntent: event.workflowIntent ?? null,
    workflowSource: event.workflowSource ?? null,
  };
}
