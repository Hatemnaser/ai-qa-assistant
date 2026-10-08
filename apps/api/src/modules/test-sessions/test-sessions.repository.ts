import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import { profileManifestV1Schema } from "@oddpath/qa-execution-contract";
import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import { nextTimelinePosition } from "../chat-history/chat-timeline.js";
import { createQaRequestInTransaction } from "../qa-requests/qa-requests.repository.js";
import { resolveProfileManifest } from "../qa-requests/qa-execution-recipes.repository.js";
import type { QaContextSnapshotInput } from "../qa-requests/qa-requests.types.js";
import { lockTestProject, lockTestSession } from "./test-sessions.guard.js";
import { testSessionProposalSchema, type activateTestSessionSchema, type createTestSessionSchema, type TestTurnInput, type updateTestSessionSchema } from "./test-sessions.schema.js";
import type { TestSessionDetail, TestSessionProposal, TestSessionRequestSummary, TestSessionSummary } from "./test-sessions.types.js";

export const sessionInclude = {
  messages: { orderBy: [{ timelinePosition: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }, { id: "asc" }], take: DATA_LIMITS.messagesPerChat,
    include: { attachments: { orderBy: { ordinal: "asc" }, include: { asset: true } } } },
  testSession: { include: {
    requests: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { events: { orderBy: { sequence: "asc" } } } },
    turns: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1 },
    preparations: { orderBy: { createdAt: "desc" } },
  } },
} satisfies Prisma.ChatInclude;
type SessionRow = Prisma.ChatGetPayload<{ include: typeof sessionInclude }>;
// Sidebar polls need only the summary, never transcript bodies or attachment payloads.
const sessionSummarySelect = {
  id: true, projectId: true, title: true, createdAt: true, updatedAt: true,
  testSession: { select: {
    version: true, archivedAt: true, currentRequestId: true,
    requests: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, phase: true } },
  } },
} satisfies Prisma.ChatSelect;
type SessionSummaryRow = Prisma.ChatGetPayload<{ select: typeof sessionSummarySelect }>;
type Scope = { userId: string; projectId: string; sessionId: string };

export function createTestSessionsRepository(database: typeof prisma = prisma) {
  return {
    async listAccount(userId: string) {
      const [rows, unlinked] = await Promise.all([
        database.chat.findMany({ where: { userId }, select: sessionSummarySelect, orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: DATA_LIMITS.chatsPerUser }),
        database.qaRequest.findMany({ where: { project: { ownerId: userId }, testSessionId: null },
          select: { id: true, projectId: true, title: true, objective: true, phase: true, version: true, createdAt: true, updatedAt: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: DATA_LIMITS.chatsPerUser }),
      ]);
      return { sessions: rows.map(toSummary), unlinkedRequests: unlinked.map(toRequestSummary) };
    },
    async readOwned(userId: string, sessionId: string) {
      const row = await database.chat.findFirst({ where: { id: sessionId, userId }, include: sessionInclude });
      if (!row) throw notFound();
      return row;
    },
    async createManaged(userId: string, projectId: string | null, input: { clientSessionId: string; title?: string }) {
      return database.$transaction(async tx => {
        if (projectId) { await lockTestProject(tx, projectId); await requireOwner(tx, userId, projectId); }
        await lockTestSession(tx, input.clientSessionId);
        const existing = await tx.chat.findUnique({ where: { id: input.clientSessionId } });
        if (existing) {
          if (existing.userId !== userId || existing.projectId !== projectId || existing.kind !== "SESSION") throw notFound();
          return existing.id;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
        if (await tx.chat.count({ where: { userId } }) >= DATA_LIMITS.chatsPerUser) throw conflict("Chat limit reached.", "CHAT_LIMIT_REACHED");
        const row = await tx.chat.create({ data: { id: input.clientSessionId, userId, projectId, kind: "SESSION", title: input.title || "New QA Chat", testSession: { create: {} } } });
        return row.id;
      });
    },
    async adoptOwned(scope: Scope, expectedUpdatedAt?: string) {
      await database.$transaction(async tx => {
        if (scope.projectId) { await lockTestProject(tx, scope.projectId); await requireOwner(tx, scope.userId, scope.projectId); }
        await lockTestSession(tx, scope.sessionId);
        const row = await tx.chat.findFirst({ where: { id: scope.sessionId, userId: scope.userId, projectId: scope.projectId || null } });
        if (!row) throw notFound();
        if (row.kind !== "CONVERSATION") return;
        if (!expectedUpdatedAt || row.updatedAt.toISOString() !== new Date(expectedUpdatedAt).toISOString()) throw conflict("Refresh the conversation before continuing.", "TEST_ACTIVATION_STALE");
        await tx.chat.update({ where: { id: row.id }, data: { kind: "SESSION", testSession: { create: {} } } });
      });
    },
    async retryTurn(scope: Scope, input: { turnId: string; clientRetryId: string; expectedSessionVersion: number }) {
      return database.$transaction(async tx => {
        const row = await lockOwnedSession(tx, scope);
        const turn = await tx.testSessionTurn.findFirst({ where: { id: input.turnId, sessionId: row.id } });
        if (!turn) throw notFound();
        if (turn.lastRetryKey === input.clientRetryId) return turn.id;
        assertVersion(row.testSession!.version, input.expectedSessionVersion);
        assertNotArchived(row);
        if (turn.status !== "FAILED") throw conflict("Only a failed reply can be retried.", "TEST_TURN_RETRY_INVALID");
        if (row.testSession!.turns[0]?.id !== turn.id) throw conflict("Only the latest failed reply can be retried.", "TEST_TURN_RETRY_INVALID");
        if (await tx.testSessionTurn.findFirst({ where: { sessionId: row.id, status: { in: ["PENDING", "PROCESSING"] } }, select: { id: true } })) throw conflict("A reply is already pending.", "TEST_TURN_IN_PROGRESS");
        await tx.testSessionTurn.update({ where: { id: turn.id }, data: { status: "PENDING", attempts: 0, availableAt: new Date(), completedAt: null, errorCode: null, providerStartedAt: null, leaseToken: null, leaseExpiresAt: null, lastRetryKey: input.clientRetryId } });
        await bump(tx, row.id);
        return turn.id;
      });
    },
    async list(userId: string, projectId: string) {
      const [sessions, unlinked] = await Promise.all([
        database.chat.findMany({ where: { userId, projectId, kind: "TEST" }, select: sessionSummarySelect, orderBy: { updatedAt: "desc" }, take: DATA_LIMITS.chatsPerUser }),
        database.qaRequest.findMany({ where: { projectId, testSessionId: null },
          select: { id: true, projectId: true, title: true, objective: true, phase: true, version: true, createdAt: true, updatedAt: true },
          orderBy: [{ updatedAt: "desc" }, { id: "desc" }], take: DATA_LIMITS.qaRequestsPerProject }),
      ]);
      return { sessions: sessions.map(toSummary), unlinkedRequests: unlinked.map(toRequestSummary) };
    },
    async get(scope: Scope) { return toDetail(await requireSession(database, scope)); },
    async load(scope: Scope) { return requireSession(database, scope); },
    async activate(userId: string, projectId: string, input: z.infer<typeof activateTestSessionSchema>) {
      return database.$transaction(async (tx) => {
        await lockTestProject(tx, projectId);
        await lockTestSession(tx, input.chatId);
        await requireOwner(tx, userId, projectId);
        const chat = await tx.chat.findUnique({ where: { id: input.chatId }, select: {
          id: true, userId: true, projectId: true, kind: true, updatedAt: true, testSession: { select: { id: true } },
        } });
        if (!chat || chat.userId !== userId) throw notFound();
        // Replays are safe after a response is lost. Never repurpose another
        // project's conversation, even if the caller owns both projects.
        if (chat.kind === "TEST") {
          if (chat.projectId !== projectId || !chat.testSession) throw notFound();
          return;
        }
        if (chat.kind !== "CONVERSATION") throw conflict("This conversation cannot become a Test.", "TEST_ACTIVATION_INVALID");
        if (chat.projectId && chat.projectId !== projectId) throw conflict("The conversation belongs to a different project.", "TEST_PROJECT_CONFLICT");
        if (chat.updatedAt.toISOString() !== new Date(input.expectedUpdatedAt).toISOString())
          throw conflict("The conversation changed. Refresh it before starting a Test.", "TEST_ACTIVATION_STALE");
        if (await tx.message.count({ where: { chatId: chat.id } }) !== input.expectedMessageCount)
          throw conflict("The conversation changed. Refresh it before starting a Test.", "TEST_ACTIVATION_STALE");
        const attachments = await tx.messageAttachment.findMany({ where: { message: { chatId: chat.id } }, select: { assetId: true } });
        for (const assetId of attachments.map(({ assetId }) => assetId).sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
          const asset = await tx.storedAsset.findUnique({ where: { id: assetId }, select: { ownerId: true, projectId: true, purpose: true, status: true } });
          if (!asset || asset.ownerId !== userId || asset.purpose !== "CHAT_ATTACHMENT" || asset.status !== "READY" ||
            (asset.projectId !== null && asset.projectId !== projectId))
            throw conflict("An attachment cannot be used in this project's Test.", "TEST_ATTACHMENT_SCOPE_CONFLICT");
          if (asset.projectId === null) await tx.storedAsset.update({ where: { id: assetId }, data: { projectId } });
        }
        await tx.chat.update({ where: { id: chat.id }, data: { kind: "TEST", projectId, testSession: { create: {} } } });
      });
    },
    async create(userId: string, projectId: string, input: z.infer<typeof createTestSessionSchema>) {
      return database.$transaction(async (tx) => {
        await lockTestProject(tx, projectId);
        await requireOwner(tx, userId, projectId);
        if (input.requestId) {
          const existing = await tx.qaRequest.findFirst({ where: { id: input.requestId, projectId } });
          if (!existing) throw new AppError("QA request was not found.", 404, "QA_REQUEST_NOT_FOUND");
          if (existing.testSessionId) return existing.testSessionId;
        }
        const id = input.clientSessionId || randomUUID();
        await lockTestSession(tx, id);
        const replay = await tx.chat.findUnique({ where: { id } });
        if (replay) {
          if (replay.userId !== userId || replay.projectId !== projectId || replay.kind !== "TEST") throw notFound();
          const state = await tx.testSession.findUnique({ where: { id } });
          if (input.requestId && state?.currentRequestId !== input.requestId) throw conflict("Session identifier was used for another intent.", "TEST_SESSION_ID_CONFLICT");
          return id;
        }
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:chats:${userId}`}, 0))`;
        if (await tx.chat.count({ where: { userId } }) >= DATA_LIMITS.chatsPerUser) throw conflict("Chat limit reached.", "CHAT_LIMIT_REACHED");
        const request = input.requestId ? await tx.qaRequest.findFirst({ where: { id: input.requestId, projectId } }) : null;
        await tx.chat.create({ data: {
          id, userId, projectId, kind: "TEST", title: input.title || request?.title || "New Test", mode: "general",
          testSession: { create: { currentRequestId: request?.id || null } },
        } });
        if (request) {
          await tx.qaRequest.update({ where: { id: request.id }, data: { testSessionId: id } });
          await tx.message.create({ data: { chatId: id, timelinePosition: await nextTimelinePosition(tx, id), role: "SYSTEM", content: `Existing QA record: ${request.title}. Its saved results and approvals are unchanged.`, metadata: json({ requestId: request.id, event: "EXISTING_REQUEST_LINKED" }) } });
        }
        return id;
      });
    },
    async update(scope: Scope, input: z.infer<typeof updateTestSessionSchema>) {
      await database.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, scope);
        assertVersion(session.testSession!.version, input.expectedSessionVersion);
        if (input.archived) await assertNoSessionWork(tx, session.id);
        await tx.chat.update({ where: { id: session.id }, data: { ...(input.title ? { title: input.title } : {}), updatedAt: new Date() } });
        await tx.testSession.update({ where: { id: session.id }, data: { version: { increment: 1 }, ...(input.archived !== undefined ? { archivedAt: input.archived ? new Date() : null } : {}) } });
      });
    },
    async deleteDraft(scope: Scope, expectedVersion: number) {
      await database.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, scope);
        assertVersion(session.testSession!.version, expectedVersion);
        if (session.testSession!.requests.length) throw conflict("A Test with QA records must be archived, not deleted.", "TEST_SESSION_HAS_RECORDS");
        await assertNoSessionWork(tx, session.id);
        const assets = session.messages.flatMap((message) => message.attachments.map(({ asset }) => asset));
        await enqueueAssetDeletionJobs(tx, assets);
        if (assets.length) await tx.storedAsset.updateMany({ where: { id: { in: assets.map(({ id }) => id) } }, data: { status: "DELETE_PENDING" } });
        await tx.chat.delete({ where: { id: session.id } });
      });
    },
    async queueTurn(scope: Scope, input: TestTurnInput) {
      return database.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, scope);
        const mode = input.mode || "general";
        const inputHash = hash({ content: input.content, attachments: input.attachments, model: input.model || null,
          ...(mode === "general" ? {} : { mode }) });
        const replay = await tx.testSessionTurn.findUnique({ where: { sessionId_clientTurnId: { sessionId: session.id, clientTurnId: input.clientTurnId } } });
        if (replay) {
          if (replay.inputHash !== inputHash) throw conflict("Turn identifier was used with different content.", "TEST_TURN_CONFLICT");
          return replay.id;
        }
        assertVersion(session.testSession!.version, input.expectedSessionVersion);
        assertNotArchived(session);
        const active = await tx.testSessionTurn.findFirst({ where: { sessionId: session.id, status: { in: ["PENDING", "PROCESSING"] } } });
        if (active) throw conflict("A Test reply is already being prepared.", "TEST_TURN_IN_PROGRESS");
        const bytes = session.messages.reduce((total, message) => total + Buffer.byteLength(message.content, "utf8") + Buffer.byteLength(JSON.stringify(message.attachment ?? []), "utf8"), 0)
          + Buffer.byteLength(input.content, "utf8") + Buffer.byteLength(JSON.stringify(input.attachments), "utf8");
        // Reserve space for the maximum UTF-8 reply and the explicit confirmation event.
        if (session.messages.length + 3 > DATA_LIMITS.messagesPerChat || bytes > DATA_LIMITS.chatMessageContentBytesPerChat - 85_000) throw conflict("Test conversation limit reached.", "CHAT_SIZE_LIMIT_REACHED");
        const ids = input.attachments.filter((value): value is { assetId: string } => "assetId" in value).map(({ assetId }) => assetId);
        if (new Set(ids).size !== ids.length) throw conflict("An attachment can only be included once.", "ASSET_DUPLICATE_REFERENCE");
        for (const assetId of [...ids].sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
          const asset = await tx.storedAsset.findUnique({ where: { id: assetId }, include: { messageAttachment: true } });
          if (!asset || asset.ownerId !== scope.userId || asset.projectId !== (scope.projectId || null) || asset.purpose !== "CHAT_ATTACHMENT" || asset.status !== "READY") throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
          if (asset.messageAttachment) throw conflict("Attachment is already linked to another message.", "ASSET_ALREADY_ATTACHED");
        }
        const message = await tx.message.create({ data: {
          chatId: session.id, timelinePosition: await nextTimelinePosition(tx, session.id), role: "USER", content: input.content, mode, model: input.model,
          attachment: json(input.attachments.filter((value) => !("assetId" in value))),
          attachments: { create: ids.map((assetId, ordinal) => ({ assetId, ordinal })) },
        } });
        const turn = await tx.testSessionTurn.create({ data: { sessionId: session.id, clientTurnId: input.clientTurnId, inputHash, messageId: message.id, model: input.model } });
        await bump(tx, session.id);
        if (session.kind === "SESSION" && session.messages.length === 0 && session.title === "New QA Chat") await tx.chat.update({ where: { id: session.id }, data: { title: input.content.slice(0, 80) || "New QA Chat" } });
        return turn.id;
      });
    },
    async moveOwned(scope: Scope, nextProjectId: string | null, expectedVersion: number) {
      await database.$transaction(async tx => {
        for (const id of [...new Set([scope.projectId, nextProjectId].filter((id): id is string => Boolean(id)))].sort()) {
          await lockTestProject(tx, id); await requireOwner(tx, scope.userId, id);
        }
        await lockTestSession(tx, scope.sessionId);
        const row = await requireSession(tx, scope);
        assertVersion(row.testSession!.version, expectedVersion);
        assertNotArchived(row);
        if (row.testSession!.requests.length) throw conflict("A session with QA records cannot move projects.", "TEST_SESSION_HAS_RECORDS");
        await assertNoSessionWork(tx, row.id);
        const assets = row.messages.flatMap(message => message.attachments.map(attachment => attachment.assetId)).sort();
        for (const assetId of assets) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
          const asset = await tx.storedAsset.findUnique({ where: { id: assetId } });
          if (!asset || asset.ownerId !== scope.userId || asset.projectId !== (scope.projectId || null) || asset.purpose !== "CHAT_ATTACHMENT" || asset.status !== "READY") throw conflict("Attachment scope changed.", "TEST_ATTACHMENT_SCOPE_CONFLICT");
          await tx.storedAsset.update({ where: { id: assetId }, data: { projectId: nextProjectId } });
        }
        await tx.chat.update({ where: { id: row.id }, data: { projectId: nextProjectId } });
        await tx.testSession.update({ where: { id: row.id }, data: { version: { increment: 1 }, ...(scope.projectId ? { pendingProposal: Prisma.JsonNull } : {}) } });
      });
    },
    async prepare(scope: Scope, input: { proposalId: string; expectedSessionVersion: number; runnerRegistrationId?: string; profileKey?: string }, snapshot: QaContextSnapshotInput) {
      return database.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, scope);
        const replay = await tx.testSessionPreparation.findUnique({ where: { sessionId_proposalId: { sessionId: session.id, proposalId: input.proposalId } } });
        if (replay) return replay.requestId;
        assertVersion(session.testSession!.version, input.expectedSessionVersion);
        assertNotArchived(session);
        await assertNoSessionWork(tx, session.id);
        if (session.testSession!.turns[0] && session.testSession!.turns[0].status !== "SUCCEEDED") throw conflict("Wait for a successful reply before confirming its brief.", "TEST_PROPOSAL_STALE");
        const proposal = parseProposal(session.testSession!.pendingProposal);
        if (!proposal || proposal.id !== input.proposalId || !proposal.ready) throw conflict("Review the current Test brief before preparing.", "TEST_PROPOSAL_STALE");
        const current = session.testSession!.requests.find(({ id }) => id === session.testSession!.currentRequestId);
        if (current && !["APPROVED", "CANCELLED", "PROCESSING_FAILED", "READY_FOR_REVIEW", "EVIDENCE_NEEDED", "CHANGES_REQUESTED"].includes(current.phase)) {
          const settledRun = await tx.qaRun.findFirst({ where: { requestId: current.id, status: { in: ["RESULTS_SUBMITTED", "CANCELLED"] } }, select: { id: true } });
          if (!settledRun) throw conflict("Complete or stop the current preparation before starting a different Test request.", "TEST_REQUEST_UNRESOLVED");
        }
        const profile = await selectProfile(tx, scope.projectId, input);
        const requestId = await createQaRequestInTransaction(tx, {
          actor: { kind: "USER", transport: "WEB", userId: scope.userId }, projectId: scope.projectId,
          title: proposal.title, objective: proposal.objective, target: proposal.target || undefined,
          environment: proposal.environment || undefined, acceptanceNotes: proposal.acceptanceNotes || undefined,
          checklistMode: "ODDPATH_GENERATED", snapshot, testSessionId: session.id,
          idempotencyKeyHash: hash({ sessionId: session.id, proposalId: proposal.id }),
        });
        await tx.testSessionPreparation.create({ data: {
          sessionId: session.id, requestId, proposalId: proposal.id, status: "CHECKLIST",
          ...(profile ? { runnerRegistrationId: profile.runnerRegistrationId, profileKey: profile.profile.profileKey, profileManifest: json(profile.profile) } : {}),
        } });
        await tx.testSession.update({ where: { id: session.id }, data: { currentRequestId: requestId, pendingProposal: Prisma.JsonNull, version: { increment: 1 } } });
        await tx.chat.update({ where: { id: session.id }, data: { updatedAt: new Date(), ...(session.title === "New Test" ? { title: proposal.title } : {}) } });
        await tx.message.create({ data: { chatId: session.id, timelinePosition: await nextTimelinePosition(tx, session.id), role: "SYSTEM", content: "Brief confirmed. Preparing the checklist and reviewed execution Recipe. No test run has been authorized.", metadata: json({ event: "PREPARATION_CONFIRMED", requestId }) } });
        return requestId;
      });
    },
    async choosePreparation(scope: Scope, input: { expectedSessionVersion: number; action: "resume" | "retry"; runnerRegistrationId?: string; profileKey?: string }) {
      return database.$transaction(async (tx) => {
        const session = await lockOwnedSession(tx, scope);
        assertVersion(session.testSession!.version, input.expectedSessionVersion);
        assertNotArchived(session);
        const preparation = session.testSession!.preparations.find(({ requestId }) => requestId === session.testSession!.currentRequestId);
        if (!preparation) throw conflict("There is no preparation to resume.", "TEST_PREPARATION_MISSING");
        if (!["WAITING_PROFILE", "FAILED", "READY"].includes(preparation.status)) throw conflict("Preparation is already active.", "TEST_SESSION_PREPARING");
        const request = session.testSession!.requests.find(({ id }) => id === preparation.requestId)!;
        if (!["PROCESSING_FAILED", "READY_TO_RUN", "CHANGES_REQUESTED"].includes(request.phase)) throw conflict("The current request cannot be prepared now.", "QA_PHASE_INVALID");
        await assertNoSessionWork(tx, session.id);
        const profile = await selectProfile(tx, scope.projectId, input);
        const existing = preparation.profileManifest ? profileManifestV1Schema.parse(preparation.profileManifest) : null;
        const changed = profile && existing?.manifestHash !== profile.profile.manifestHash;
        if (input.action === "retry" && preparation.status !== "FAILED") throw conflict("Only failed preparation can be retried.", "TEST_PREPARATION_RETRY_INVALID");
        if (request.phase === "PROCESSING_FAILED") {
          const failed = await tx.qaGenerationExecution.findFirst({ where: { requestId: request.id, kind: "CHECKLIST_GENERATION", status: "FAILED" }, orderBy: { createdAt: "desc" } });
          if (!failed) throw conflict("Checklist retry is unavailable.", "TEST_PREPARATION_RETRY_INVALID");
          await tx.qaGenerationExecution.create({ data: { requestId: request.id, kind: "CHECKLIST_GENERATION", idempotencyKeyHash: hash({ preparationId: preparation.id, attempt: preparation.attempt + 1 }) } });
          await tx.qaRequest.update({ where: { id: request.id }, data: { phase: "GENERATING", version: { increment: 1 } } });
        }
        await tx.testSessionPreparation.update({ where: { id: preparation.id }, data: {
          status: request.phase === "PROCESSING_FAILED" ? "CHECKLIST" : "RECIPE", errorCode: null,
          attempt: { increment: 1 }, operationId: null,
          ...(changed ? { recipeId: null } : {}),
          ...(profile ? { runnerRegistrationId: profile.runnerRegistrationId, profileKey: profile.profile.profileKey, profileManifest: json(profile.profile) } : {}),
        } });
        await bump(tx, session.id);
        return preparation.id;
      });
    },
  };
}

export const testSessionsRepository = createTestSessionsRepository();

export async function requireOwner(tx: Prisma.TransactionClient, userId: string, projectId: string) {
  if (!await tx.project.findFirst({ where: { id: projectId, ownerId: userId }, select: { id: true } })) throw new AppError("Project was not found.", 404, "PROJECT_NOT_FOUND");
}
export async function lockOwnedSession(tx: Prisma.TransactionClient, scope: Scope) {
  if (scope.projectId) await lockTestProject(tx, scope.projectId);
  await lockTestSession(tx, scope.sessionId);
  if (scope.projectId) await requireOwner(tx, scope.userId, scope.projectId);
  return requireSession(tx, scope);
}
async function requireSession(tx: Pick<Prisma.TransactionClient, "chat">, scope: Scope) {
  const session = await tx.chat.findFirst({ where: { id: scope.sessionId, userId: scope.userId, projectId: scope.projectId || null, kind: { in: ["TEST", "SESSION"] } }, include: sessionInclude });
  if (!session?.testSession) throw notFound();
  return session;
}
export async function assertNoSessionWork(tx: Prisma.TransactionClient, sessionId: string) {
  const [turn, job, operation, preparation] = await Promise.all([
    tx.testSessionTurn.findFirst({ select: { id: true }, where: { sessionId, status: { in: ["PENDING", "PROCESSING"] } } }),
    tx.qaRun.findFirst({ select: { id: true }, where: { request: { testSessionId: sessionId }, status: { in: ["CREATED", "ACTIVE"] } } }),
    tx.qaGenerationExecution.findFirst({ select: { id: true }, where: { request: { testSessionId: sessionId }, status: { in: ["PENDING", "PROCESSING"] } } }),
    tx.testSessionPreparation.findFirst({ select: { id: true }, where: { sessionId, status: { in: ["CHECKLIST", "RECIPE", "REVIEW"] } } }),
  ]);
  if (turn || job || operation || preparation) throw conflict("Wait for active Test work to finish.", "TEST_SESSION_BUSY");
}
export async function selectProfile(tx: Prisma.TransactionClient, projectId: string, input: { runnerRegistrationId?: string; profileKey?: string }) {
  if (!input.runnerRegistrationId && !input.profileKey) return null;
  if (!input.runnerRegistrationId || !input.profileKey) throw conflict("Choose a Runner and its profile.", "TEST_PROFILE_REQUIRED");
  const runner = await tx.qaRunnerRegistration.findFirst({ where: { id: input.runnerRegistrationId, projectId,
    connectionToken: { revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
  } });
  if (!runner) throw new AppError("Runner was not found.", 404, "QA_RUNNER_NOT_FOUND");
  if (!runner.protocolVersions.includes(1) || !runner.executorKeys.includes("playwright")) throw conflict("Runner is incompatible.", "QA_RUNNER_INCOMPATIBLE");
  const profile = profileManifestV1Schema.array().parse(runner.publicProfiles).find(({ profileKey }) => profileKey === input.profileKey);
  if (!profile) throw conflict("Runner profile was not found.", "QA_PROFILE_NOT_FOUND");
  return { runnerRegistrationId: runner.id, profile: resolveProfileManifest(profile) };
}
export function parseProposal(value: unknown): TestSessionProposal | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { id, sourceMessageIds, ...rest } = value as Record<string, unknown>;
  const parsed = testSessionProposalSchema.safeParse(rest);
  return parsed.success && typeof id === "string" && Array.isArray(sourceMessageIds) && sourceMessageIds.every((entry) => typeof entry === "string")
    ? { ...parsed.data, id, sourceMessageIds } : null;
}
export function toSummary(row: SessionSummaryRow): TestSessionSummary {
  const state = row.testSession || { version: 1, archivedAt: null, currentRequestId: null, requests: [] };
  return { id: row.id, projectId: row.projectId || "", title: row.title, version: state.version, archivedAt: state.archivedAt?.toISOString() || null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), currentRequestId: state.currentRequestId,
    phase: state.requests.find(({ id }) => id === state.currentRequestId)?.phase || "DRAFT", requestIds: state.requests.map(({ id }) => id) };
}
export function toDetail(row: SessionRow): TestSessionDetail {
  const state = row.testSession || { turns: [], preparations: [], requests: [], currentRequestId: null, pendingProposal: null };
  const turn = state.turns[0];
  const preparation = state.preparations.find(({ requestId }) => requestId === state.currentRequestId);
  return { ...toSummary(row),
    messages: row.messages.map((message) => ({ id: message.id, timelinePosition: message.timelinePosition, role: message.role.toLowerCase() as "user" | "assistant" | "system", content: message.content, mode: message.mode || "general",
      createdAt: message.createdAt.toISOString(), model: message.model,
      attachments: [...(Array.isArray(message.attachment) ? message.attachment : []), ...message.attachments.map(({ asset }) => ({
        assetId: asset.id, type: (asset.detectedMimeType || asset.declaredMimeType).startsWith("image/") ? "image" : "file",
        name: asset.originalName, mimeType: asset.detectedMimeType || asset.declaredMimeType,
      }))] })),
    events: state.requests.flatMap(request => (request.events || []).map(event => ({ id: event.id, requestId: request.id, title: request.title, type: event.type, sequence: event.sequence, timelinePosition: event.timelinePosition, createdAt: event.createdAt.toISOString(), metadata: event.metadata }))),
    requests: state.requests.map(toRequestSummary), pendingProposal: parseProposal(state.pendingProposal),
    turnStatus: turn ? { id: turn.id, status: turn.status as NonNullable<TestSessionDetail["turnStatus"]>["status"], errorCode: turn.errorCode } : null,
    preparation: preparation ? { id: preparation.id, requestId: preparation.requestId, status: preparation.status as NonNullable<TestSessionDetail["preparation"]>["status"],
      recipeId: preparation.recipeId, operationId: preparation.operationId, runnerRegistrationId: preparation.runnerRegistrationId, profileKey: preparation.profileKey, errorCode: preparation.errorCode } : null,
  };
}
export function toRequestSummary(row: { id: string; projectId: string; title: string; objective: string; phase: TestSessionRequestSummary["phase"]; version: number; createdAt: Date; updatedAt: Date }): TestSessionRequestSummary {
  return { id: row.id, projectId: row.projectId, title: row.title, objective: row.objective, phase: row.phase, version: row.version, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export async function bump(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.testSession.update({ where: { id: sessionId }, data: { version: { increment: 1 } } });
  await tx.chat.update({ where: { id: sessionId }, data: { updatedAt: new Date() } });
}
function assertNotArchived(row: SessionRow) { if (row.testSession!.archivedAt) throw conflict("Restore this Test before continuing.", "TEST_SESSION_ARCHIVED"); }
export function assertVersion(actual: number, expected: number) { if (actual !== expected) throw conflict("This Test changed. Refresh before continuing.", "TEST_SESSION_VERSION_CONFLICT"); }
function notFound() { return new AppError("Test session was not found.", 404, "TEST_SESSION_NOT_FOUND"); }
export function conflict(message: string, code: string) { return new AppError(message, 409, code); }
export function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function json(value: unknown): Prisma.InputJsonValue { return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue; }
