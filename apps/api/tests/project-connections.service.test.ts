import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import type { ProjectAccessService } from "../src/modules/projects/project-access.service.ts";
import {
  createProjectConnectionsService,
  hashConnectionToken,
} from "../src/modules/project-connections/project-connections.service.ts";
import { createProjectConnectionSchema } from "../src/modules/project-connections/project-connections.schema.ts";

const NOW = new Date("2026-08-29T00:00:00.000Z");

describe("project connection tokens", () => {
  it("returns the secret once, stores only its hash, and authenticates its scopes", async () => {
    const state = createDatabase();
    const accessChecks: string[] = [];
    const service = createProjectConnectionsService({
      database: state.client,
      now: () => NOW,
      projectAccess: createProjectAccess(accessChecks),
      randomToken: () => "fixed-connection-secret",
    });

    const created = await service.createConnection("user-1", "project-1", {
      expiresAt: null,
      name: "Claude runner",
      scopes: ["qa:write", "qa:read", "qa:write"],
    });

    assert.equal(created.token, "odp_live_fixed-connection-secret");
    assert.equal(state.connection?.tokenHash, hashConnectionToken(created.token));
    assert.equal(state.connection?.tokenHash.includes("fixed-connection-secret"), false);
    assert.deepEqual(created.connection.scopes, ["qa:read", "qa:write"]);
    assert.equal("tokenHash" in created.connection, false);
    assert.deepEqual(await service.authenticate(created.token), {
      connectionId: "connection-1",
      ownerId: "user-1",
      projectId: "project-1",
      scopes: ["qa:read", "qa:write"],
    });
    assert.deepEqual(accessChecks, ["user-1:project-1"]);
    assert.equal(state.lastUsedAt?.toISOString(), NOW.toISOString());
  });

  it("rejects expired tokens without exposing whether they existed", async () => {
    const state = createDatabase();
    const service = createProjectConnectionsService({
      database: state.client,
      now: () => NOW,
      projectAccess: createProjectAccess([]),
      randomToken: () => "fixed-connection-secret",
    });
    const created = await service.createConnection("user-1", "project-1", {
      expiresAt: "2026-08-29T00:01:00.000Z",
      name: "Short-lived agent",
      scopes: ["qa:read"],
    });
    state.connection!.expiresAt = new Date("2026-08-28T23:59:59.000Z");

    await assert.rejects(
      () => service.authenticate(created.token),
      hasCode("CONNECTION_TOKEN_INVALID")
    );
  });

  it("maps AGENT and RUNNER presets to least-privilege scope sets", async () => {
    const agentState = createDatabase();
    const runnerState = createDatabase();
    const agentService = createProjectConnectionsService({
      database: agentState.client,
      now: () => NOW,
      projectAccess: createProjectAccess([]),
      randomToken: () => "agent-secret",
    });
    const runnerService = createProjectConnectionsService({
      database: runnerState.client,
      now: () => NOW,
      projectAccess: createProjectAccess([]),
      randomToken: () => "runner-secret",
    });

    const agent = await agentService.createConnection("user-1", "project-1", {
      name: "Claude agent",
      preset: "AGENT",
    });
    const runner = await runnerService.createConnection("user-1", "project-1", {
      name: "Local runner",
      preset: "RUNNER",
    });

    assert.deepEqual(agent.connection.scopes, ["evidence:write", "qa:read", "qa:write"]);
    assert.equal(agent.connection.preset, "AGENT");
    assert.deepEqual(runner.connection.scopes, [
      "evidence:write",
      "execution:claim",
      "execution:write",
      "qa:read",
    ]);
    assert.equal(runner.connection.preset, "RUNNER");
    assert.equal(runner.connection.scopes.includes("qa:write"), false);
  });

  it("rejects ambiguous preset plus explicit scope input", () => {
    const parsed = createProjectConnectionSchema.safeParse({
      name: "Ambiguous connection",
      preset: "RUNNER",
      scopes: ["qa:read"],
    });

    assert.equal(parsed.success, false);
    if (!parsed.success) assert.equal(parsed.error.issues[0]?.path[0], "scopes");
  });
});

function createDatabase() {
  const state: {
    connection: ReturnType<typeof createRecord> | null;
    lastUsedAt: Date | null;
  } = { connection: null, lastUsedAt: null };
  const projectConnectionToken = {
    async count() { return state.connection && !state.connection.revokedAt ? 1 : 0; },
    async create(input: { data: {
      expiresAt: Date | null;
      name: string;
      ownerId: string;
      projectId: string;
      scopes: string[];
      tokenHash: string;
      tokenPrefix: string;
    } }) {
      state.connection = createRecord(input.data);
      return state.connection;
    },
    async findUnique(input: { where: { tokenHash: string } }) {
      return state.connection?.tokenHash === input.where.tokenHash ? state.connection : null;
    },
    async update(input: { data: { lastUsedAt: Date } }) {
      state.lastUsedAt = input.data.lastUsedAt;
      if (state.connection) state.connection.lastUsedAt = input.data.lastUsedAt;
      return state.connection;
    },
    async findMany() { return state.connection ? [state.connection] : []; },
    async updateMany() { return { count: 1 }; },
    async findFirst() { return state.connection; },
  };
  return {
    client: { projectConnectionToken } as unknown as typeof prisma,
    get connection() { return state.connection; },
    get lastUsedAt() { return state.lastUsedAt; },
  };
}

function createRecord(input: {
  expiresAt: Date | null;
  name: string;
  ownerId: string;
  projectId: string;
  scopes: string[];
  tokenHash: string;
  tokenPrefix: string;
}) {
  return {
    ...input,
    createdAt: NOW,
    id: "connection-1",
    lastUsedAt: null as Date | null,
    revokedAt: null as Date | null,
    updatedAt: NOW,
  };
}

function createProjectAccess(calls: string[]) {
  return {
    async assertProjectAccess(userId: string, projectId: string) {
      calls.push(`${userId}:${projectId}`);
    },
  } as unknown as ProjectAccessService;
}

function hasCode(expected: string) {
  return (error: unknown) => Boolean(
    error && typeof error === "object" && "code" in error && error.code === expected
  );
}
