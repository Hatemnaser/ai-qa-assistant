import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createPrismaChatHistoryRepository } from "../src/modules/chat-history/chat-history.repository.ts";
import { assertCurrentTestRequest, lockQaSessionScope } from "../src/modules/test-sessions/test-sessions.guard.ts";
import { hash, parseProposal, selectProfile } from "../src/modules/test-sessions/test-sessions.repository.ts";
import { fixture, NOW, preparation, PROFILE, PROPOSAL, request, SCOPE, SNAPSHOT, TURN } from "./test-sessions.fixture.ts";

describe("Test session repository ownership and deterministic commands", () => {
  it("promotes a saved conversation with the same ID and no QA side effects", async () => {
    const f = fixture();
    f.tx.chat.findUnique = f.record("chat.findUnique", { id: SCOPE.sessionId, userId: SCOPE.userId, projectId: null,
      kind: "CONVERSATION", updatedAt: NOW, testSession: null });
    await f.repository.activate(SCOPE.userId, SCOPE.projectId, { chatId: SCOPE.sessionId,
      expectedUpdatedAt: NOW.toISOString(), expectedMessageCount: 1 });
    assert.deepEqual(f.call("chat.update").data, { kind: "TEST", projectId: SCOPE.projectId, testSession: { create: {} } });
    assert.equal(f.calls.some(({ operation }) => operation === "request.create" || operation === "run.create"), false);
  });

  it("rejects a stale promotion and foreign-project attachments before changing a chat", async () => {
    const f = fixture();
    f.tx.chat.findUnique = async () => ({ id: SCOPE.sessionId, userId: SCOPE.userId, projectId: null,
      kind: "CONVERSATION", updatedAt: NOW, testSession: null });
    await assert.rejects(f.repository.activate(SCOPE.userId, SCOPE.projectId, { chatId: SCOPE.sessionId,
      expectedUpdatedAt: NOW.toISOString(), expectedMessageCount: 0 }), { code: "TEST_ACTIVATION_STALE" });
    f.tx.messageAttachment.findMany = async () => [{ assetId: "foreign-asset" }];
    f.tx.storedAsset.findUnique = async () => ({ ownerId: SCOPE.userId, projectId: "other-project", purpose: "CHAT_ATTACHMENT", status: "READY" });
    await assert.rejects(f.repository.activate(SCOPE.userId, SCOPE.projectId, { chatId: SCOPE.sessionId,
      expectedUpdatedAt: NOW.toISOString(), expectedMessageCount: 1 }), { code: "TEST_ATTACHMENT_SCOPE_CONFLICT" });
    assert.equal(f.calls.some(({ operation }) => operation === "chat.update"), false);
  });
  it("lists summary-only selections without loading transcripts, attachments, turns or preparations", async () => {
    const f = fixture();
    f.tx.chat.findMany = f.record("chat.findMany", [{
      id: SCOPE.sessionId, projectId: SCOPE.projectId, title: "Login", createdAt: NOW, updatedAt: NOW,
      testSession: { version: 3, archivedAt: null, currentRequestId: "request-2",
        requests: [{ id: "request-1", phase: "APPROVED" }, { id: "request-2", phase: "READY_FOR_REVIEW" }] },
    }]);
    f.tx.qaRequest.findMany = f.record("request.findMany", [request({ id: "unlinked-1", testSessionId: null })]);

    const result = await f.repository.list(SCOPE.userId, SCOPE.projectId);

    const query = f.call("chat.findMany");
    assert.deepEqual(query.where, { userId: SCOPE.userId, projectId: SCOPE.projectId, kind: "TEST" });
    assert.equal(query.include, undefined);
    assert.deepEqual(query.select, {
      id: true, projectId: true, title: true, createdAt: true, updatedAt: true,
      testSession: { select: {
        version: true, archivedAt: true, currentRequestId: true,
        requests: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, phase: true } },
      } },
    });
    assert.deepEqual(f.call("request.findMany").select, {
      id: true, projectId: true, title: true, objective: true, phase: true, version: true, createdAt: true, updatedAt: true,
    });
    assert.deepEqual(result.sessions, [{
      id: SCOPE.sessionId, projectId: SCOPE.projectId, title: "Login", version: 3, archivedAt: null,
      createdAt: NOW.toISOString(), updatedAt: NOW.toISOString(), currentRequestId: "request-2",
      phase: "READY_FOR_REVIEW", requestIds: ["request-1", "request-2"],
    }]);
    assert.equal(result.unlinkedRequests[0].id, "unlinked-1");
    assert.equal(f.writes().length, 0);
  });

  it("scopes reads by owner, project, session ID, and server-owned kind", async () => {
    const f = fixture();
    await f.repository.get(SCOPE);
    assert.deepEqual(f.call("chat.findFirst").where, { id: SCOPE.sessionId, userId: SCOPE.userId, projectId: SCOPE.projectId, kind: { in: ["TEST", "SESSION"] } });
    f.tx.chat.findFirst = async () => null;
    await assert.rejects(f.repository.get({ ...SCOPE, userId: "intruder" }), { code: "TEST_SESSION_NOT_FOUND", statusCode: 404 });
    assert.equal(f.writes().length, 0);
  });

  it("checks project ownership again under lifecycle locks before mutation", async () => {
    const f = fixture();
    f.tx.project.findFirst = f.record("project.findFirst", null);
    await assert.rejects(f.repository.queueTurn(SCOPE, TURN), { code: "PROJECT_NOT_FOUND", statusCode: 404 });
    assert.deepEqual(f.calls.map(({ operation }) => operation), ["lock", "lock", "project.findFirst"]);
    assert.deepEqual(f.call("project.findFirst").where, { id: SCOPE.projectId, ownerId: SCOPE.userId });
    assert.equal(f.writes().length, 0);
  });

  it("replays create without creating another chat and never claims another owner's identifier", async () => {
    const f = fixture();
    f.tx.chat.findUnique = f.record("chat.findUnique", f.row);
    assert.equal(await f.repository.create(SCOPE.userId, SCOPE.projectId, { clientSessionId: SCOPE.sessionId }), SCOPE.sessionId);
    assert.equal(f.writes().length, 0);
    for (const override of [{ userId: "intruder" }, { projectId: "other-project" }, { kind: "CONVERSATION" }]) {
      f.tx.chat.findUnique = async () => ({ ...f.row, ...override });
      await assert.rejects(f.repository.create(SCOPE.userId, SCOPE.projectId, { clientSessionId: SCOPE.sessionId }), { code: "TEST_SESSION_NOT_FOUND" });
    }
    assert.equal(f.writes().length, 0);
  });

  it("creates a TEST with server-owned state and links existing requests only in the same project", async () => {
    const f = fixture();
    f.tx.qaRequest.findFirst = f.record("request.findFirst", request({ testSessionId: null }));
    await f.repository.create(SCOPE.userId, SCOPE.projectId, { clientSessionId: SCOPE.sessionId, requestId: "request-1" });
    assert.deepEqual(f.call("request.findFirst").where, { id: "request-1", projectId: SCOPE.projectId });
    assert.equal(f.call("chat.create").data.kind, "TEST");
    assert.deepEqual(f.call("chat.create").data.testSession, { create: { currentRequestId: "request-1" } });
    assert.deepEqual(f.call("request.update"), { where: { id: "request-1" }, data: { testSessionId: SCOPE.sessionId } });
    assert.equal(f.calls.some(({ operation }) => operation === "operation.create"), false);
  });

  it("does not overwrite an existing session with a different linked request", async () => {
    const f = fixture();
    f.tx.qaRequest.findFirst = async () => request({ testSessionId: null });
    f.tx.chat.findUnique = async () => f.row;
    await assert.rejects(f.repository.create(SCOPE.userId, SCOPE.projectId, { clientSessionId: SCOPE.sessionId, requestId: "request-1" }), { code: "TEST_SESSION_ID_CONFLICT" });
    assert.equal(f.writes().length, 0);
  });

  it("replays exact durable turns before stale-version checking and rejects changed content", async () => {
    const f = fixture();
    f.row.testSession.version = 4;
    f.tx.testSessionTurn.findUnique = async () => ({ id: "turn-existing", inputHash: hash({ content: TURN.content, attachments: [], model: null }) });
    assert.equal(await f.repository.queueTurn(SCOPE, TURN), "turn-existing");
    await assert.rejects(f.repository.queueTurn(SCOPE, { ...TURN, content: "Changed intent" }), { code: "TEST_TURN_CONFLICT" });
    assert.equal(f.writes().length, 0);
  });

  it("queues a durable user turn without creating a QA request, approval, or run", async () => {
    const f = fixture();
    await f.repository.queueTurn(SCOPE, { ...TURN, content: "APPROVE and run now", attachments: [{ assetId: "asset-1" }] });
    assert.deepEqual(f.call("message.create").data.attachments, { create: [{ assetId: "asset-1", ordinal: 0 }] });
    assert.equal(f.call("turn.create").data.clientTurnId, TURN.clientTurnId);
    assert.equal(f.call("turn.create").data.messageId, "message-new");
    assert.deepEqual(f.writes().map(({ operation }) => operation), ["chat.update", "message.create", "turn.create", "testSession.update", "chat.update"]);
    assert.equal(f.call("message.create").data.timelinePosition, 2);
  });

  for (const overrides of [{ ownerId: "intruder" }, { projectId: "other-project" }, { projectId: null }, { purpose: "QA_EVIDENCE" }, { status: "PENDING" }]) {
    it(`rejects out-of-scope or unusable attachment ${JSON.stringify(overrides)}`, async () => {
      const f = fixture();
      f.tx.storedAsset.findUnique = async () => ({ ownerId: SCOPE.userId, projectId: SCOPE.projectId, purpose: "CHAT_ATTACHMENT", status: "READY", messageAttachment: null, ...overrides });
      await assert.rejects(f.repository.queueTurn(SCOPE, { ...TURN, attachments: [{ assetId: "asset-1" }] }), { code: "ASSET_NOT_FOUND", statusCode: 404 });
      assert.equal(f.writes().length, 0);
    });
  }

  it("rejects duplicated and already-consumed stored attachments before any write", async () => {
    const f = fixture();
    await assert.rejects(f.repository.queueTurn(SCOPE, { ...TURN, attachments: [{ assetId: "asset-1" }, { assetId: "asset-1" }] }), { code: "ASSET_DUPLICATE_REFERENCE" });
    f.tx.storedAsset.findUnique = async () => ({ ownerId: SCOPE.userId, projectId: SCOPE.projectId, purpose: "CHAT_ATTACHMENT", status: "READY", messageAttachment: { messageId: "old-message" } });
    await assert.rejects(f.repository.queueTurn(SCOPE, { ...TURN, attachments: [{ assetId: "asset-1" }] }), { code: "ASSET_ALREADY_ATTACHED" });
    assert.equal(f.writes().length, 0);
  });

  it("prepares only an exact confirmed proposal and creates checklist work, never a run", async () => {
    const f = fixture();
    const requestId = await f.repository.prepare(SCOPE, { proposalId: PROPOSAL.id, expectedSessionVersion: 1 }, SNAPSHOT);
    assert.equal(requestId, "request-new");
    assert.equal(f.call("request.create").data.phase, "GENERATING");
    assert.equal(f.call("request.create").data.testSessionId, SCOPE.sessionId);
    assert.deepEqual(f.call("operation.create").data, { idempotencyKeyHash: hash({ sessionId: SCOPE.sessionId, proposalId: PROPOSAL.id }), kind: "CHECKLIST_GENERATION", requestId });
    assert.equal(f.call("preparation.create").data.status, "CHECKLIST");
    assert.match(f.call("message.create").data.content, /No test run has been authorized/u);
    assert.equal(f.calls.filter(({ operation }) => operation === "request.create").length, 1);
  });

  it("replays preparation without touching snapshot, version, selected profile or prior request", async () => {
    const f = fixture();
    f.row.testSession.version = 9;
    f.tx.testSessionPreparation.findUnique = async () => ({ requestId: "request-existing" });
    assert.equal(await f.repository.prepare(SCOPE, { proposalId: PROPOSAL.id, expectedSessionVersion: 1, runnerRegistrationId: "different", profileKey: "different" }, SNAPSHOT), "request-existing");
    assert.equal(f.writes().length, 0);
    assert.equal(f.calls.some(({ operation }) => operation === "runner.findFirst"), false);
  });

  for (const phase of ["READY_FOR_REVIEW", "EVIDENCE_NEEDED", "CHANGES_REQUESTED", "APPROVED", "CANCELLED"]) {
    it(`allows a new brief after ${phase} without fabricating or altering human review`, async () => {
      const f = fixture();
      f.row.testSession.currentRequestId = "request-1";
      f.row.testSession.requests = [request({ phase })];
      await f.repository.prepare(SCOPE, { proposalId: PROPOSAL.id, expectedSessionVersion: 1 }, SNAPSHOT);
      assert.equal(f.row.testSession.requests[0].phase, phase);
      assert.equal(f.calls.some(({ operation }) => operation === "request.update"), false);
      assert.equal(f.call("testSession.update").data.currentRequestId, "request-new");
    });
  }

  for (const delegate of ["testSessionTurn", "qaRun", "qaGenerationExecution", "testSessionPreparation"]) {
    it(`blocks new preparation when ${delegate} is active`, async () => {
      const f = fixture();
      f.tx[delegate].findFirst = async () => ({ id: "active-work" });
      await assert.rejects(f.repository.prepare(SCOPE, { proposalId: PROPOSAL.id, expectedSessionVersion: 1 }, SNAPSHOT), { code: "TEST_SESSION_BUSY" });
      assert.equal(f.writes().length, 0);
    });
  }

  it("refuses deleting historical QA records or modifying a stale session", async () => {
    const f = fixture();
    f.row.testSession.requests = [request()];
    await assert.rejects(f.repository.deleteDraft(SCOPE, 1), { code: "TEST_SESSION_HAS_RECORDS" });
    await assert.rejects(f.repository.update(SCOPE, { expectedSessionVersion: 2, title: "Changed" }), { code: "TEST_SESSION_VERSION_CONFLICT" });
    assert.equal(f.writes().length, 0);
  });

  it("requires a server-resolved Runner/profile pair within the same project", async () => {
    const f = fixture();
    assert.equal(await selectProfile(f.tx, SCOPE.projectId, {}), null);
    await assert.rejects(selectProfile(f.tx, SCOPE.projectId, { profileKey: PROFILE.profileKey }), { code: "TEST_PROFILE_REQUIRED" });
    const selected = await selectProfile(f.tx, SCOPE.projectId, { runnerRegistrationId: "runner-1", profileKey: PROFILE.profileKey });
    assert.equal(selected?.profile.manifestHash, PROFILE.manifestHash);
    assert.equal(f.call("runner.findFirst").where.projectId, SCOPE.projectId);
    assert.equal(f.call("runner.findFirst").where.connectionToken.revokedAt, null);
    f.tx.qaRunnerRegistration.findFirst = async () => null;
    await assert.rejects(selectProfile(f.tx, SCOPE.projectId, { runnerRegistrationId: "other-runner", profileKey: PROFILE.profileKey }), { code: "QA_RUNNER_NOT_FOUND" });
  });

  it("invalidates the previous Recipe when an explicitly reselected profile drifts", async () => {
    const f = fixture();
    f.row.testSession.currentRequestId = "request-1";
    f.row.testSession.requests = [request()];
    f.row.testSession.preparations = [preparation({ status: "READY", recipeId: "old-recipe", profileManifest: { ...PROFILE, manifestHash: "a".repeat(64) } })];
    await f.repository.choosePreparation(SCOPE, { expectedSessionVersion: 1, action: "resume", runnerRegistrationId: "runner-1", profileKey: PROFILE.profileKey });
    assert.equal(f.call("preparation.update").data.recipeId, null);
    assert.equal(f.call("preparation.update").data.profileManifest.manifestHash, PROFILE.manifestHash);
    assert.equal(f.call("preparation.update").data.status, "RECIPE");
  });
});

describe("Test session fences across generic chat and QA transports", () => {
  for (const operation of ["PUT", "move", "delete"]) {
    it(`blocks generic chat ${operation} before messages, assets or chat state are changed`, async () => {
      const f = fixture();
      f.tx.chat.findUnique = async () => f.row;
      const repository = createPrismaChatHistoryRepository(f.database);
      await assert.rejects(operation === "delete" ? repository.deleteUserChat(SCOPE.userId, SCOPE.sessionId) : repository.saveUserChat({
        userId: SCOPE.userId, createdAt: NOW, updatedAt: NOW, messages: [],
        chat: { id: SCOPE.sessionId, title: "Overwrite", projectId: operation === "move" ? "different-project" : SCOPE.projectId, mode: "general", model: "test-model", messages: [] },
      } as Parameters<typeof repository.saveUserChat>[0]), { code: "TEST_SESSION_SERVER_OWNED", statusCode: 409 });
      assert.equal(f.writes().length, 0);
    });
  }

  it("locks project before session before caller's request lock", async () => {
    const f = fixture();
    await lockQaSessionScope(f.tx, "request-1");
    assert.equal(f.calls.length, 2);
    assert.match(f.calls[0].input.join(""), /project-lifecycle/u);
    assert.match(f.calls[1].input.join(""), /oddpath:chat/u);
  });

  for (const change of [{ archivedAt: NOW }, { currentRequestId: "other-request" }]) {
    it(`fences archived or historical request mutation ${JSON.stringify(change)}`, async () => {
      const f = fixture();
      Object.assign(f.row.testSession, { currentRequestId: "request-1" }, change);
      await assert.rejects(assertCurrentTestRequest(f.tx, request()), { code: "TEST_REQUEST_NOT_CURRENT" });
      assert.equal(f.writes().length, 0);
    });
  }

  it("fences an active sibling and active preparation without affecting ordinary requests", async () => {
    const f = fixture();
    f.row.testSession.currentRequestId = "request-1";
    await assertCurrentTestRequest(f.tx, { id: "ordinary", testSessionId: null });
    assert.equal(f.calls.length, 0);
    f.tx.qaRequest.findFirst = async () => ({ id: "sibling" });
    await assert.rejects(assertCurrentTestRequest(f.tx, request()), { code: "TEST_SESSION_BUSY" });
    f.tx.qaRequest.findFirst = async () => null;
    f.tx.testSessionPreparation.findFirst = async () => ({ id: "preparing" });
    await assert.rejects(assertCurrentTestRequest(f.tx, request()), { code: "TEST_SESSION_PREPARING" });
  });

  it("rejects malformed saved proposals instead of trusting executable fields", () => {
    assert.deepEqual(parseProposal(PROPOSAL), PROPOSAL);
    for (const input of [null, [], { ...PROPOSAL, approved: true }, { ...PROPOSAL, sourceMessageIds: [null] }, { ...PROPOSAL, ready: "yes" }]) assert.equal(parseProposal(input), null);
  });
});
