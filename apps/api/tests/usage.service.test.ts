import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createUsageService } from "../src/modules/usage/usage.service.ts";
import type { UsageRepository } from "../src/modules/usage/usage.repository.ts";
import type { UsageCountInput, UsageRecordInput } from "../src/modules/usage/usage.types.ts";

describe("usage service", () => {
  it("reserves guest chat credits with both guest and IP tracking", async () => {
    const repository = createFakeUsageRepository();
    const service = createUsageService({
      now: () => new Date("2026-05-19T12:00:00.000Z"),
      repository,
    });

    const reservation = await service.reserveChatMessage({
      guestId: "guest-1",
      ipAddress: "127.0.0.1",
    });

    assert.equal(reservation.limit, 3);
    assert.equal(reservation.remaining, 2);
    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].guestId, "guest-1");
    assert.ok(repository.events[0].ipHash);
    assert.equal(repository.events[0].userId, undefined);
  });

  it("rejects guests after the daily demo limit", async () => {
    const repository = createFakeUsageRepository([
      createUsageEvent({ guestId: "guest-1" }),
      createUsageEvent({ guestId: "guest-1" }),
      createUsageEvent({ guestId: "guest-1" }),
    ]);
    const service = createUsageService({
      now: () => new Date("2026-05-19T12:00:00.000Z"),
      repository,
    });

    await assert.rejects(
      () =>
        service.reserveChatMessage({
          guestId: "guest-1",
          ipAddress: "127.0.0.1",
        }),
      {
        code: "USAGE_LIMIT_REACHED",
        statusCode: 429,
      }
    );
    assert.equal(repository.events.length, 3);
  });

  it("uses user limits for signed-in users", async () => {
    const repository = createFakeUsageRepository();
    const service = createUsageService({
      now: () => new Date("2026-05-19T12:00:00.000Z"),
      repository,
    });

    const reservation = await service.reserveChatMessage({
      guestId: "guest-1",
      ipAddress: "127.0.0.1",
      userId: "user-1",
    });

    assert.equal(reservation.limit, 10);
    assert.equal(reservation.remaining, 9);
    assert.equal(repository.events.length, 1);
    assert.equal(repository.events[0].guestId, undefined);
    assert.equal(repository.events[0].ipHash, undefined);
    assert.equal(repository.events[0].userId, "user-1");
  });

  it("ignores old usage events outside the active window", async () => {
    const repository = createFakeUsageRepository([
      createUsageEvent({
        createdAt: new Date("2026-05-17T12:00:00.000Z"),
        guestId: "guest-1",
      }),
      createUsageEvent({
        createdAt: new Date("2026-05-19T10:00:00.000Z"),
        guestId: "guest-1",
      }),
    ]);
    const service = createUsageService({
      now: () => new Date("2026-05-19T12:00:00.000Z"),
      repository,
    });

    const reservation = await service.reserveChatMessage({
      guestId: "guest-1",
    });

    assert.equal(reservation.used, 2);
    assert.equal(reservation.remaining, 1);
  });
});

function createFakeUsageRepository(initialEvents: FakeUsageEvent[] = []) {
  const repository = {
    events: [...initialEvents],

    async countUsage(input: UsageCountInput) {
      return repository.events.filter((event) => {
        if (event.action !== input.action) return false;
        if (event.createdAt < input.since) return false;
        if (input.userId !== undefined && event.userId !== input.userId) return false;
        if (input.guestId !== undefined && event.guestId !== input.guestId) return false;
        if (input.ipHash !== undefined && event.ipHash !== input.ipHash) return false;

        return true;
      }).length;
    },

    async recordUsage(input: UsageRecordInput) {
      repository.events.push(createUsageEvent(input));
    },
  } satisfies UsageRepository & {
    events: FakeUsageEvent[];
  };

  return repository;
}

interface FakeUsageEvent extends UsageRecordInput {
  createdAt: Date;
}

function createUsageEvent(overrides: Partial<FakeUsageEvent> = {}): FakeUsageEvent {
  return {
    action: "chat_message",
    createdAt: new Date("2026-05-19T11:00:00.000Z"),
    units: 1,
    ...overrides,
  };
}
