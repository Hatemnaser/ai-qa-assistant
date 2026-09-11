import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { AppError } from "../src/lib/errors.ts";
import {
  createExternalIdempotencyService,
} from "../src/modules/project-connections/external-idempotency.service.ts";

describe("external mutation idempotency", () => {
  it("runs an operation once and replays its stored response for the same intent", async () => {
    const database = createDatabase();
    const service = createExternalIdempotencyService(database.client);
    let calls = 0;

    const first = await service.execute(
      {
        credentialId: "connection-1",
        key: "checkout-run-001",
        operation: "qa.run.start",
        request: { requestId: "request-1", source: { b: 2, a: 1 } },
      },
      async () => {
        calls += 1;
        return { body: { runId: "run-1" }, status: 201 };
      }
    );
    const replay = await service.execute(
      {
        credentialId: "connection-1",
        key: "checkout-run-001",
        operation: "qa.run.start",
        request: { source: { a: 1, b: 2 }, requestId: "request-1" },
      },
      async () => {
        calls += 1;
        return { body: { runId: "duplicate" }, status: 201 };
      }
    );

    assert.equal(calls, 1);
    assert.deepEqual(first, { body: { runId: "run-1" }, replayed: false, status: 201 });
    assert.deepEqual(replay, { body: { runId: "run-1" }, replayed: true, status: 201 });
    assert.equal(database.records[0]?.keyHash === "checkout-run-001", false);
  });

  it("rejects key reuse with different request data", async () => {
    const database = createDatabase();
    const service = createExternalIdempotencyService(database.client);
    const execute = (requestId: string) => service.execute(
      {
        credentialId: "connection-1",
        key: "shared-key-001",
        operation: "qa.request.create",
        request: { requestId },
      },
      async () => ({ body: { requestId }, status: 201 })
    );

    await execute("request-1");
    await assert.rejects(() => execute("request-2"), hasCode("IDEMPOTENCY_KEY_REUSED"));
  });

  it("stores and replays a domain rejection without running the action twice", async () => {
    const database = createDatabase();
    const service = createExternalIdempotencyService(database.client);
    const input = {
      credentialId: "connection-1",
      key: "retry-key-001",
      operation: "qa.evidence.add",
      request: { evidence: "log" },
    };

    let calls = 0;
    await assert.rejects(
      () => service.execute(input, async () => {
        calls += 1;
        throw new AppError("Evidence is invalid.", 422, "EVIDENCE_INVALID");
      }),
      hasCode("EVIDENCE_INVALID")
    );
    await assert.rejects(
      () => service.execute(input, async () => {
        calls += 1;
        return { body: { evidenceId: "evidence-1" }, status: 201 };
      }),
      hasCode("EVIDENCE_INVALID")
    );
    assert.equal(calls, 1);
    assert.equal(database.records[0]?.responseStatus, 422);
  });

  it("keeps an ambiguous failure fenced instead of risking a duplicate mutation", async () => {
    const database = createDatabase();
    const service = createExternalIdempotencyService(database.client);
    const input = {
      credentialId: "connection-1",
      key: "ambiguous-key-001",
      operation: "qa.request.create",
      request: { title: "Checkout" },
    };

    await assert.rejects(
      () => service.execute(input, async () => { throw new Error("connection lost"); }),
      /connection lost/
    );
    assert.equal(database.records.length, 1);
    await assert.rejects(
      () => service.execute(input, async () => ({ body: { id: "duplicate" }, status: 201 })),
      hasCode("IDEMPOTENCY_IN_PROGRESS")
    );
  });

  it("requires a key for every external mutation", async () => {
    const database = createDatabase();
    const service = createExternalIdempotencyService(database.client);
    await assert.rejects(
      () => service.execute(
        {
          credentialId: "connection-1",
          operation: "qa.request.create",
          request: { title: "Checkout" },
        },
        async () => ({ body: { id: "request-1" }, status: 201 })
      ),
      hasCode("IDEMPOTENCY_KEY_REQUIRED")
    );
    assert.equal(database.records.length, 0);
  });
});

interface StoredIdempotencyRecord {
  id: string;
  credentialId: string;
  operation: string;
  keyHash: string;
  requestHash: string;
  responseStatus: number | null;
  responseBody: unknown;
  state: "PENDING" | "COMPLETED" | "LEGACY_AMBIGUOUS";
}

function createDatabase() {
  const records: StoredIdempotencyRecord[] = [];
  const externalIdempotencyRecord = {
    async findUnique(input: {
      where: { credentialId_operation_keyHash: {
        credentialId: string;
        operation: string;
        keyHash: string;
      } };
    }) {
      const key = input.where.credentialId_operation_keyHash;
      return records.find((record) =>
        record.credentialId === key.credentialId &&
        record.operation === key.operation &&
        record.keyHash === key.keyHash
      ) || null;
    },
    async create(input: {
      data: Omit<StoredIdempotencyRecord, "id" | "responseBody" | "responseStatus">;
    }) {
      if (records.some((record) =>
        record.credentialId === input.data.credentialId &&
        record.operation === input.data.operation &&
        record.keyHash === input.data.keyHash
      )) throw new Error("unique conflict");
      const record = {
        ...input.data,
        id: `record-${records.length + 1}`,
        responseBody: null,
        responseStatus: null,
      };
      records.push(record);
      return { id: record.id };
    },
    async updateMany(input: {
      data: {
        completedAt?: Date;
        responseBody: unknown;
        responseStatus: number;
        state?: "PENDING" | "COMPLETED" | "LEGACY_AMBIGUOUS";
      };
      where: { id: string; responseStatus: null; state?: "PENDING" };
    }) {
      const record = records.find((candidate) =>
        candidate.id === input.where.id && candidate.responseStatus === null
      );
      if (!record) return { count: 0 };
      record.responseBody = input.data.responseBody;
      record.responseStatus = input.data.responseStatus;
      record.state = input.data.state || record.state;
      return { count: 1 };
    },
    async deleteMany(input: { where: { id: string; responseStatus: null } }) {
      const index = records.findIndex((record) =>
        record.id === input.where.id && record.responseStatus === null
      );
      if (index === -1) return { count: 0 };
      records.splice(index, 1);
      return { count: 1 };
    },
  };

  return {
    client: { externalIdempotencyRecord } as unknown as typeof prisma,
    records,
  };
}

function hasCode(expected: string) {
  return (error: unknown) => Boolean(
    error && typeof error === "object" && "code" in error && error.code === expected
  );
}
