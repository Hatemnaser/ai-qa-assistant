import assert from "node:assert/strict";
import type { prisma } from "../src/db/prisma.ts";
import { resolveProfileManifest } from "../src/modules/qa-requests/qa-execution-recipes.repository.ts";
import { createTestSessionsRepository } from "../src/modules/test-sessions/test-sessions.repository.ts";

export const NOW = new Date("2026-09-23T12:00:00.000Z");
export const SCOPE = { userId: "owner-1", projectId: "project-1", sessionId: "session-1" };
export const PROFILE = resolveProfileManifest({
  environmentKind: "TEST", evidenceKinds: ["TEXT"], executorKey: "playwright",
  label: "Local test", profileKey: "local-test", recipeSchemaVersions: [1], schemaVersion: 1,
  valueReferences: [],
});
export const PROPOSAL = {
  id: "proposal-1", title: "Login", objective: "Verify valid login", target: "https://app.example.test",
  environment: "staging", acceptanceNotes: null, ready: true, sourceMessageIds: ["message-1"],
};
export const SNAPSHOT = { degraded: false, payload: {}, payloadHash: "snapshot-hash", retrievalMode: "NONE", sourceManifest: {} };
export const TURN = { clientTurnId: "client-turn-1", expectedSessionVersion: 1, content: "Test login", attachments: [] };

export function request(overrides: Record<string, unknown> = {}) {
  return { id: "request-1", projectId: SCOPE.projectId, testSessionId: SCOPE.sessionId,
    title: "Login", objective: "Verify login", phase: "READY_TO_RUN", version: 1,
    selectedArtifactId: "artifact-1", events: [], createdAt: NOW, updatedAt: NOW, ...overrides };
}
export function preparation(overrides: Record<string, unknown> = {}) {
  return { id: "preparation-1", sessionId: SCOPE.sessionId, requestId: "request-1", proposalId: PROPOSAL.id,
    status: "CHECKLIST", attempt: 1, recipeId: null, operationId: null, runnerRegistrationId: "runner-1",
    profileKey: PROFILE.profileKey, profileManifest: PROFILE, errorCode: null, createdAt: NOW, updatedAt: NOW, ...overrides };
}
export function session(overrides: Record<string, unknown> = {}): any {
  return { id: SCOPE.sessionId, userId: SCOPE.userId, projectId: SCOPE.projectId, kind: "TEST", title: "New Test",
    mode: "general", model: null, nextTimelinePosition: 2, createdAt: NOW, updatedAt: NOW,
    messages: [{ id: "message-1", role: "USER", content: "Test login", createdAt: NOW, model: null, attachment: [], attachments: [] }],
    testSession: { id: SCOPE.sessionId, version: 1, archivedAt: null, currentRequestId: null,
      pendingProposal: PROPOSAL, requests: [], turns: [], preparations: [] }, ...overrides };
}

// Every delegate is in memory. An unexpected persistence operation fails loudly.
export function fixture(row = session()) {
  const calls: Array<{ operation: string; input: any }> = [];
  const record = (operation: string, result: any = null) => async (input: any) => {
    calls.push({ operation, input });
    return typeof result === "function" ? result(input) : result;
  };
  const tx: any = {
    $executeRaw: record("lock", 1),
    project: { findFirst: record("project.findFirst", { id: SCOPE.projectId }) },
    chat: {
      findFirst: record("chat.findFirst", row), findUnique: record("chat.findUnique", null),
      findMany: record("chat.findMany", [row]), count: record("chat.count", 0),
      create: record("chat.create", { id: row.id }), update: record("chat.update", (input: any) => {
        if (input.data.nextTimelinePosition?.increment) row.nextTimelinePosition += input.data.nextTimelinePosition.increment;
        return { ...row };
      }), delete: record("chat.delete", {}),
    },
    testSession: { findUnique: record("testSession.findUnique", row.testSession), update: record("testSession.update", {}) },
    testSessionTurn: { findUnique: record("turn.findUnique"), findFirst: record("turn.findFirst"),
      create: record("turn.create", { id: "turn-1" }), updateMany: record("turn.updateMany", { count: 1 }), update: record("turn.update", {}) },
    testSessionPreparation: { findUnique: record("preparation.findUnique"), findFirst: record("preparation.findFirst"),
      findMany: record("preparation.findMany", []), create: record("preparation.create", { id: "preparation-1" }),
      update: record("preparation.update", {}), updateMany: record("preparation.updateMany", { count: 1 }) },
    qaRequest: { findUnique: record("request.findUnique", { testSessionId: row.id }), findFirst: record("request.findFirst"), findMany: record("request.findMany", []), count: record("request.count", 0),
      create: record("request.create", { id: "request-new" }), update: record("request.update", {}) },
    qaRun: { findFirst: record("run.findFirst"), findMany: record("run.findMany", []) },
    qaGenerationExecution: { findFirst: record("operation.findFirst"), findUnique: record("operation.findUnique"), create: record("operation.create", {}) },
    qaExecutionRecipeAssessment: { findFirst: record("assessment.findFirst") },
    qaRunnerRegistration: { findFirst: record("runner.findFirst", { id: "runner-1", protocolVersions: [1], executorKeys: ["playwright"], publicProfiles: [PROFILE] }) },
    qaWorkflowEvent: { findFirst: record("event.findFirst"), create: record("event.create", {}) },
    message: { create: record("message.create", { id: "message-new" }), count: record("message.count", row.messages.length) },
    messageAttachment: { findMany: record("messageAttachment.findMany", []) },
    storedAsset: { findUnique: record("asset.findUnique", { id: "asset-1", ownerId: SCOPE.userId, projectId: SCOPE.projectId,
      purpose: "CHAT_ATTACHMENT", status: "READY", messageAttachment: null }) },
  };
  const database = { ...tx, $transaction: async (fn: (transaction: typeof tx) => unknown) => fn(tx) } as unknown as typeof prisma;
  return { row, tx, database, calls, record, repository: createTestSessionsRepository(database),
    writes: () => calls.filter(({ operation }) => /\.(?:create|update|updateMany|delete)$/u.test(operation)),
    call: (operation: string) => { const found = calls.find((call) => call.operation === operation); assert.ok(found, `Missing ${operation}`); return found.input; } };
}
