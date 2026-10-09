import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { assertPostgresIntegrationTarget } from "./helpers/postgresIntegrationTarget.ts";

// This module is imported by the guarded DB suite, never by test:api.
// Validate the explicit disposable target before loading the application's client.
const target = assertPostgresIntegrationTarget(process.env);
const { prisma } = await import("../src/db/prisma.ts");
const { createTestSessionsRepository } = await import("../src/modules/test-sessions/test-sessions.repository.ts");
const { createPrismaQaRequestRepository } = await import("../src/modules/qa-requests/qa-requests.repository.ts");
const { createPrismaChatHistoryRepository } = await import("../src/modules/chat-history/chat-history.repository.ts");
const { createTestSessionsWorker } = await import("../src/modules/test-sessions/test-sessions.worker.ts");
const { createSessionsService } = await import('../src/modules/sessions/sessions.service.ts');
const { readFile } = await import('node:fs/promises');

const prefix = `session-dbit-${randomUUID()}`;
const ownerId = `${prefix}-owner`;
const otherOwnerId = `${prefix}-other`;
const projectId = `${prefix}-project`;
const otherProjectId = `${prefix}-other-project`;
const repository = createTestSessionsRepository(prisma);
const qaRepository = createPrismaQaRequestRepository(prisma);
const proposal = { id: "proposal-1", title: "Login", objective: "Verify valid login", target: "https://example.test",
  environment: "staging", acceptanceNotes: null, ready: true, sourceMessageIds: [] };
const snapshot = { degraded: false, payload: {}, payloadHash: "test-hash", retrievalMode: "NONE", sourceManifest: {} };
const actor = { kind: "USER" as const, transport: "WEB" as const, userId: ownerId };
let sequence = 0;

describe("Test sessions real PostgreSQL concurrency and authority", { concurrency: false }, () => {
  before(async () => {
    const identity = await prisma.$queryRaw<Array<{ name: string }>>`SELECT current_database() AS name`;
    assert.equal(identity[0].name, target.databaseName);
    await prisma.user.createMany({ data: [{ id: ownerId, email: `${ownerId}@example.test` }, { id: otherOwnerId, email: `${otherOwnerId}@example.test` }] });
    await prisma.project.createMany({ data: [{ id: projectId, ownerId, name: "Session integration" }, { id: otherProjectId, ownerId: otherOwnerId, name: "Other owner" }] });
  });

  after(async () => {
    // Exact generated fixture IDs only; the caller guard forbids a working database.
    await prisma.qaRequest.deleteMany({ where: { projectId: { in: [projectId, otherProjectId] } } });
    await prisma.project.deleteMany({ where: { id: { in: [projectId, otherProjectId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherOwnerId] } } });
    await prisma.$disconnect();
  });

  async function newSession() {
    const sessionId = `${prefix}-session-${++sequence}`;
    await repository.create(ownerId, projectId, { clientSessionId: sessionId });
    return { userId: ownerId, projectId, sessionId };
  }

  it('creates an account-scoped projectless SESSION idempotently and adopts an old chat in place', async () => {
    const service = createSessionsService({ repository, preparation: { prepare() { assert.fail('No implicit QA'); }, resume() { assert.fail('No implicit QA'); } } as any });
    const id = `${prefix}-managed`;
    await Promise.all([service.create(ownerId, { clientSessionId: id }), service.create(ownerId, { clientSessionId: id })]);
    const created = await service.read(ownerId, id);
    assert.equal(created.projectId, null); assert.equal(created.managed, true);
    assert.equal((await prisma.chat.findUniqueOrThrow({ where: { id } })).kind, 'SESSION');
    const turn = await service.turn(ownerId, id, { clientTurnId: 'write-report', expectedSessionVersion: 1, content: 'Write test cases, do not execute', attachments: [], mode: 'general' });
    const replay = await service.turn(ownerId, id, { clientTurnId: 'write-report', expectedSessionVersion: 1, content: 'Write test cases, do not execute', attachments: [], mode: 'general' });
    assert.equal(turn.turnId, replay.turnId);
    assert.equal(await prisma.message.count({ where: { chatId: id } }), 1);
    assert.equal(await prisma.qaRequest.count({ where: { testSessionId: id } }), 0);
    await assert.rejects(service.read(otherOwnerId, id), { code: 'TEST_SESSION_NOT_FOUND' });
    await assert.rejects(service.prepare(ownerId, id, { proposalId: 'none', expectedSessionVersion: 2 }), { code: 'PROJECT_REQUIRED' });
    const legacy = await prisma.chat.create({ data: { id: `${prefix}-legacy-session`, userId: ownerId, projectId, title: 'Existing table', messages: { create: { id: `${prefix}-legacy-message`, role: 'ASSISTANT', content: '| preserved | table |', timelinePosition: 1 } }, nextTimelinePosition: 2 } });
    await assert.rejects(service.turn(ownerId, legacy.id, { clientTurnId: 'stale', expectedSessionVersion: 1, content: 'hello', attachments: [], mode: 'general', expectedUpdatedAt: new Date(0).toISOString() }), { code: 'TEST_ACTIVATION_STALE' });
    assert.equal((await prisma.chat.findUniqueOrThrow({ where: { id: legacy.id } })).kind, 'CONVERSATION');
    await service.turn(ownerId, legacy.id, { clientTurnId: 'new', expectedSessionVersion: 1, content: 'Explain the table', attachments: [], mode: 'general', expectedUpdatedAt: legacy.updatedAt.toISOString() });
    const adopted = await service.read(ownerId, legacy.id);
    assert.equal(adopted.title, legacy.title); assert.equal(adopted.projectId, projectId);
    assert.equal(adopted.messages[0].id, `${prefix}-legacy-message`); assert.equal(adopted.messages[0].content, '| preserved | table |');
    assert.deepEqual(adopted.messages.map(row => row.timelinePosition), [1, 2]);
  });

  it('backfills old mixed history transactionally without rewriting identities, content or outcomes', async () => {
    const migration = await readFile(new URL('../prisma/migrations/20261003090000_unified_session_timeline/migration.sql', import.meta.url), 'utf8');
    const { Pool } = await import('pg');
    const pool = new Pool({ connectionString: target.connectionString });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      // Disposable database only. Roll back this rehearsal, including DDL and fixtures.
      await client.query('ALTER TABLE "Chat" DROP COLUMN "nextTimelinePosition"; ALTER TABLE "Message" DROP COLUMN "timelinePosition"; ALTER TABLE "QaWorkflowEvent" DROP COLUMN "timelinePosition"; ALTER TABLE "TestSessionTurn" DROP COLUMN "providerStartedAt", DROP COLUMN "lastRetryKey"');
      const id = `${prefix}-backfill`, at = new Date('2026-01-01T00:00:00.000Z');
      await client.query('INSERT INTO "Chat" (id, "userId", title, "updatedAt") VALUES ($1,$2,$3,$4)', [id, ownerId, 'Original', at]);
      await client.query('INSERT INTO "TestSession" (id) VALUES ($1)', [id]);
      await client.query('INSERT INTO "QaRequest" (id,"projectId","testSessionId",title,objective,"updatedAt") VALUES ($1,$2,$3,$4,$5,$6)', [`${id}-request`, projectId, id, 'QA', 'Original scope', at]);
      await client.query('INSERT INTO "Message" (id,"chatId",role,content,"createdAt") VALUES ($1,$2,$3,$4,$5),($6,$2,$3,$7,$8)', [`${id}-a`, id, 'ASSISTANT', 'Original table', at, `${id}-z`, 'Later report', new Date(at.getTime() + 1000)]);
      await client.query('INSERT INTO "QaWorkflowEvent" (id,"requestId",sequence,type,"actorKind",transport,"createdAt") VALUES ($1,$2,1,$3,$4,$5,$6)', [`${id}-event`, `${id}-request`, 'run_results_submitted', 'SYSTEM', 'SYSTEM', at]);
      await client.query(migration);
      const messages = await client.query('SELECT id, content, "createdAt", "timelinePosition" FROM "Message" WHERE "chatId"=$1 ORDER BY "timelinePosition"', [id]);
      assert.deepEqual(messages.rows.map(row => [row.id, row.content, row.timelinePosition]), [[`${id}-a`, 'Original table', 1], [`${id}-z`, 'Later report', 3]]);
      assert.equal(messages.rows[0].createdAt.toISOString(), at.toISOString());
      assert.equal((await client.query('SELECT "timelinePosition" FROM "QaWorkflowEvent" WHERE id=$1', [`${id}-event`])).rows[0].timelinePosition, 2);
      assert.equal((await client.query('SELECT "nextTimelinePosition" FROM "Chat" WHERE id=$1', [id])).rows[0].nextTimelinePosition, 4);
    } finally { await client.query('ROLLBACK'); client.release(); await pool.end(); }
  });

  it("activates one saved conversation in place, preserves its transcript, and fences stale snapshots", async () => {
    const chatId = `${prefix}-promoted-${++sequence}`;
    const chat = await prisma.chat.create({ data: { id: chatId, userId: ownerId, title: "Discuss login", kind: "CONVERSATION",
      messages: { create: [{ role: "USER", content: "Check the login", mode: "general" }, { role: "ASSISTANT", content: "Which environment?", mode: "general" }] } } });
    const input = { chatId, expectedUpdatedAt: chat.updatedAt.toISOString(), expectedMessageCount: 2 };
    await Promise.all([repository.activate(ownerId, projectId, input), repository.activate(ownerId, projectId, input)]);
    const promoted = await prisma.chat.findUniqueOrThrow({ where: { id: chatId }, include: { testSession: true, messages: true } });
    assert.equal(promoted.kind, "TEST");
    assert.equal(promoted.projectId, projectId);
    assert.equal(promoted.testSession?.version, 1);
    assert.deepEqual(promoted.messages.map(message => message.content).sort(), ["Check the login", "Which environment?"].sort());
    assert.equal(await prisma.qaRequest.count({ where: { testSessionId: chatId } }), 0);
    await assert.rejects(createPrismaChatHistoryRepository(prisma).deleteUserChat(ownerId, chatId), { code: "TEST_SESSION_SERVER_OWNED" });

    const staleId = `${prefix}-stale-${++sequence}`;
    const stale = await prisma.chat.create({ data: { id: staleId, userId: ownerId, title: "Unsaved change" } });
    await prisma.message.create({ data: { chatId: staleId, role: "USER", content: "Arrived after snapshot" } });
    await assert.rejects(repository.activate(ownerId, projectId, { chatId: staleId, expectedUpdatedAt: stale.updatedAt.toISOString(), expectedMessageCount: 0 }), { code: "TEST_ACTIVATION_STALE" });
    assert.equal((await prisma.chat.findUniqueOrThrow({ where: { id: staleId } })).kind, "CONVERSATION");
    await assert.rejects(repository.activate(otherOwnerId, otherProjectId, input), { code: "TEST_SESSION_NOT_FOUND" });
  });

  async function readyRequest() {
    const scope = await newSession();
    await prisma.testSession.update({ where: { id: scope.sessionId }, data: { pendingProposal: proposal } });
    const requestId = await repository.prepare(scope, { proposalId: proposal.id, expectedSessionVersion: 1 }, snapshot);
    const context = await prisma.qaContextSnapshot.findFirstOrThrow({ where: { requestId } });
    const artifact = await prisma.qaArtifact.create({ data: { requestId, snapshotId: context.id, revision: 1, origin: "ODDPATH_GENERATED", title: "Login checks", canonicalJson: {} } });
    await prisma.qaGenerationExecution.updateMany({ where: { requestId }, data: { status: "SUCCEEDED", completedAt: new Date() } });
    await prisma.testSessionPreparation.update({ where: { requestId }, data: { status: "READY" } });
    await prisma.qaRequest.update({ where: { id: requestId }, data: { phase: "READY_TO_RUN", selectedArtifactId: artifact.id } });
    return { scope, requestId, artifactId: artifact.id };
  }

  it("serializes concurrent create and prepare retries into one session, request and operation", async () => {
    const sessionId = `${prefix}-concurrent-create`;
    const creates = await Promise.all(Array.from({ length: 4 }, () => repository.create(ownerId, projectId, { clientSessionId: sessionId })));
    assert.deepEqual(new Set(creates), new Set([sessionId]));
    await prisma.testSession.update({ where: { id: sessionId }, data: { pendingProposal: proposal } });
    const scope = { userId: ownerId, projectId, sessionId };
    const requests = await Promise.all(Array.from({ length: 4 }, () => repository.prepare(scope, { proposalId: proposal.id, expectedSessionVersion: 1 }, snapshot)));
    assert.equal(new Set(requests).size, 1);
    assert.equal(await prisma.qaRequest.count({ where: { testSessionId: sessionId } }), 1);
    assert.equal(await prisma.qaGenerationExecution.count({ where: { requestId: requests[0] } }), 1);
    assert.equal(await prisma.qaRun.count({ where: { requestId: requests[0] } }), 0);
    assert.equal(await prisma.qaHumanReview.count({ where: { requestId: requests[0] } }), 0);
  });

  it("serializes duplicate and competing turns without duplicating durable messages", async () => {
    const scope = await newSession();
    const input = { clientTurnId: "same-turn", expectedSessionVersion: 1, content: "Approve and execute", attachments: [] };
    const turns = await Promise.all(Array.from({ length: 4 }, () => repository.queueTurn(scope, input)));
    assert.equal(new Set(turns).size, 1);
    assert.equal(await prisma.message.count({ where: { chatId: scope.sessionId } }), 1);
    assert.equal(await prisma.testSessionTurn.count({ where: { sessionId: scope.sessionId } }), 1);
    assert.equal(await prisma.qaRequest.count({ where: { testSessionId: scope.sessionId } }), 0);
    await assert.rejects(repository.queueTurn(scope, { ...input, content: "different" }), { code: "TEST_TURN_CONFLICT" });
    await assert.rejects(repository.queueTurn(scope, { ...input, clientTurnId: "competing", expectedSessionVersion: 2 }), { code: "TEST_TURN_IN_PROGRESS" });
  });

  it("enforces owner/project isolation and generic-chat immutability against real records", async () => {
    const scope = await newSession();
    await assert.rejects(repository.get({ ...scope, userId: otherOwnerId }), { code: "TEST_SESSION_NOT_FOUND" });
    await assert.rejects(repository.get({ ...scope, projectId: otherProjectId }), { code: "TEST_SESSION_NOT_FOUND" });
    await assert.rejects(repository.create(otherOwnerId, otherProjectId, { clientSessionId: scope.sessionId }), { code: "TEST_SESSION_NOT_FOUND" });
    await assert.rejects(createPrismaChatHistoryRepository(prisma).deleteUserChat(ownerId, scope.sessionId), { code: "TEST_SESSION_SERVER_OWNED" });
    assert.equal((await repository.get(scope)).version, 1);
  });

  it("allows exactly one explicit run command while fencing competing session work", async () => {
    const { scope, requestId } = await readyRequest();
    const results = await Promise.allSettled([
      qaRepository.startRun({ actor, projectId, requestId }),
      qaRepository.startRun({ actor, projectId, requestId }),
    ]);
    assert.equal(results.filter(({ status }) => status === "fulfilled").length, 1);
    const rejected = results.find((result) => result.status === "rejected") as PromiseRejectedResult;
    assert.equal(rejected.reason.code, "TEST_SESSION_BUSY");
    assert.equal(await prisma.qaRun.count({ where: { requestId, status: "ACTIVE" } }), 1);
    await repository.queueTurn(scope, { clientTurnId: "during-run", expectedSessionVersion: 2, content: "Explain the run; do not prepare another test", attachments: [] });
    assert.equal(await prisma.qaRun.count({ where: { requestId, status: "ACTIVE" } }), 1);
    assert.equal(await prisma.qaHumanReview.count({ where: { requestId } }), 0);
  });

  it("lets a human-review-pending record coexist with a new brief without approving prior results", async () => {
    const { scope, requestId, artifactId } = await readyRequest();
    await prisma.qaRun.create({ data: { requestId, artifactId, status: "RESULTS_SUBMITTED", outcome: "PASS" } });
    await prisma.qaRequest.update({ where: { id: requestId }, data: { phase: "READY_FOR_REVIEW" } });
    await prisma.testSession.update({ where: { id: scope.sessionId }, data: { pendingProposal: { ...proposal, id: "followup" } } });
    const next = await repository.prepare(scope, { expectedSessionVersion: 2, proposalId: "followup" }, snapshot);
    assert.notEqual(next, requestId);
    assert.equal((await prisma.qaRequest.findUniqueOrThrow({ where: { id: requestId } })).phase, "READY_FOR_REVIEW");
    assert.equal(await prisma.qaHumanReview.count({ where: { requestId } }), 0);
    assert.equal((await repository.get(scope)).currentRequestId, next);
    await assert.rejects(qaRepository.startRun({ actor, projectId, requestId }), { code: "TEST_REQUEST_NOT_CURRENT" });
  });

  it('shares one timeline lock across discussion and QA events, without blocking a run', async () => {
    const { scope, requestId } = await readyRequest();
    await Promise.all([
      repository.queueTurn(scope, { clientTurnId: 'discuss-and-run', expectedSessionVersion: 2, content: 'Explain the scope', attachments: [] }),
      qaRepository.startRun({ actor, projectId, requestId }),
    ]);
    const messages = await prisma.message.findMany({ where: { chatId: scope.sessionId } });
    const events = await prisma.qaWorkflowEvent.findMany({ where: { requestId } });
    const positions = [...messages, ...events].map(row => row.timelinePosition).sort((a, b) => a! - b!);
    assert.ok(positions.length >= 3); assert.equal(new Set(positions).size, positions.length);
    assert.ok(positions.every(value => typeof value === 'number'));
    assert.equal((await prisma.chat.findUniqueOrThrow({ where: { id: scope.sessionId } })).nextTimelinePosition, positions.at(-1)! + 1);
    assert.equal(await prisma.qaRun.count({ where: { requestId, status: 'ACTIVE' } }), 1);
    await assert.rejects(repository.moveOwned(scope, null, 3), { code: 'TEST_SESSION_HAS_RECORDS' });
    await assert.rejects(repository.deleteDraft(scope, 3), { code: 'TEST_SESSION_HAS_RECORDS' });
  });

  it('marks uncertain provider calls failed and retries explicitly without duplicating the user message', async () => {
    const scope = await newSession();
    const turnId = await repository.queueTurn(scope, { clientTurnId: 'unknown-provider', expectedSessionVersion: 1, content: 'Write a report', attachments: [] });
    await prisma.testSessionTurn.updateMany({ where: { sessionId: { not: scope.sessionId }, session: { chat: { userId: ownerId } } }, data: { status: 'FAILED' } });
    await prisma.testSessionTurn.update({ where: { id: turnId }, data: { status: 'PROCESSING', providerStartedAt: new Date(), attempts: 1, leaseToken: 'lost', leaseExpiresAt: new Date(0) } });
    const worker = createTestSessionsWorker({ database: prisma, intelligence: { async discuss() { assert.fail('Unknown call cannot replay'); } }, recipes: {} as any });
    await worker.processTurn();
    assert.equal((await prisma.testSessionTurn.findUniqueOrThrow({ where: { id: turnId } })).errorCode, 'SESSION_TURN_OUTCOME_UNKNOWN');
    const before = await repository.get(scope);
    const retry = { turnId, clientRetryId: 'explicit-retry', expectedSessionVersion: before.version };
    await Promise.all([repository.retryTurn(scope, retry), repository.retryTurn(scope, retry)]);
    assert.equal(await prisma.message.count({ where: { chatId: scope.sessionId, role: 'USER' } }), 1);
    const stored = await prisma.testSessionTurn.findUniqueOrThrow({ where: { id: turnId } });
    assert.equal(stored.status, 'PENDING'); assert.equal(stored.providerStartedAt, null);
  });

  it("recovers an expired turn lease once under two competing workers", async () => {
    const scope = await newSession();
    const turnId = await repository.queueTurn(scope, { clientTurnId: "crashed", expectedSessionVersion: 1, content: "Test login", attachments: [] });
    await prisma.testSessionTurn.update({ where: { id: turnId }, data: { status: "PROCESSING", attempts: 1, leaseToken: "crashed-token", leaseExpiresAt: new Date(Date.now() - 60_000) } });
    let providerCalls = 0;
    const intelligence = { async discuss() { providerCalls += 1; return { response: { reply: "What environment?", proposal: null }, model: "fake-model" }; } };
    const recipes = { async queueGeneration() { assert.fail("No recipe generation for a conversation"); }, async queueReviewRetry() { assert.fail("No review retry for a conversation"); } } as any;
    const workers = [createTestSessionsWorker({ database: prisma, intelligence, recipes }), createTestSessionsWorker({ database: prisma, intelligence, recipes })];
    // Other tests intentionally retain queued turns; focus workers on this earliest job.
    await prisma.testSessionTurn.updateMany({ where: { sessionId: { not: scope.sessionId }, session: { chat: { userId: ownerId } } }, data: { status: "FAILED" } });
    await Promise.all(workers.map((worker) => worker.processTurn()));
    const stored = await prisma.testSessionTurn.findUniqueOrThrow({ where: { id: turnId } });
    assert.equal(providerCalls, 1);
    assert.equal(stored.status, "SUCCEEDED");
    assert.equal(stored.attempts, 2);
    assert.equal(stored.leaseToken, null);
    assert.equal(await prisma.message.count({ where: { chatId: scope.sessionId, role: "ASSISTANT" } }), 1);
  });

  it("preserves account-deletion cascades with linked server-owned Test records", async () => {
    const sessionId = `${prefix}-account-delete`;
    await repository.create(otherOwnerId, otherProjectId, { clientSessionId: sessionId });
    await prisma.testSession.update({ where: { id: sessionId }, data: { pendingProposal: proposal } });
    const requestId = await repository.prepare({ userId: otherOwnerId, projectId: otherProjectId, sessionId },
      { expectedSessionVersion: 1, proposalId: proposal.id }, snapshot);
    await prisma.user.delete({ where: { id: otherOwnerId } });
    assert.equal(await prisma.project.count({ where: { id: otherProjectId } }), 0);
    assert.equal(await prisma.chat.count({ where: { id: sessionId } }), 0);
    assert.equal(await prisma.testSession.count({ where: { id: sessionId } }), 0);
    assert.equal(await prisma.qaRequest.count({ where: { id: requestId } }), 0);
    assert.equal(await prisma.qaGenerationExecution.count({ where: { requestId } }), 0);
  });
});
