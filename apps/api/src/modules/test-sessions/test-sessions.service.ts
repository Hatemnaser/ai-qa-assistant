import type { z } from "zod";
import { projectAccessService } from "../projects/project-access.service.js";
import { projectQaContextBuilder } from "../qa-requests/project-qa-context.builder.js";
import { assertVersion, conflict, hash, parseProposal, testSessionsRepository } from "./test-sessions.repository.js";
import type { activateTestSessionSchema, createTestSessionSchema, deleteTestSessionSchema, prepareTestSessionSchema, resumeTestPreparationSchema, TestTurnInput, updateTestSessionSchema } from "./test-sessions.schema.js";

export function createTestSessionsService(deps = { repository: testSessionsRepository, projectAccess: projectAccessService, contextBuilder: projectQaContextBuilder }) {
  async function scope(userId: string, projectId: string, sessionId: string) {
    await deps.projectAccess.assertProjectAccess(userId, projectId);
    return { userId, projectId, sessionId };
  }
  return {
    async list(userId: string, projectId: string) {
      await deps.projectAccess.assertProjectAccess(userId, projectId);
      return deps.repository.list(userId, projectId);
    },
    async get(userId: string, projectId: string, sessionId: string) { return deps.repository.get(await scope(userId, projectId, sessionId)); },
    async create(userId: string, projectId: string, input: z.infer<typeof createTestSessionSchema>) {
      await deps.projectAccess.assertProjectAccess(userId, projectId);
      const sessionId = await deps.repository.create(userId, projectId, input);
      return deps.repository.get({ userId, projectId, sessionId });
    },
    async activate(userId: string, projectId: string, input: z.infer<typeof activateTestSessionSchema>) {
      await deps.projectAccess.assertProjectAccess(userId, projectId);
      await deps.repository.activate(userId, projectId, input);
      return deps.repository.get({ userId, projectId, sessionId: input.chatId });
    },
    async update(userId: string, projectId: string, sessionId: string, input: z.infer<typeof updateTestSessionSchema>) {
      const owned = await scope(userId, projectId, sessionId);
      await deps.repository.update(owned, input);
      return deps.repository.get(owned);
    },
    async delete(userId: string, projectId: string, sessionId: string, input: z.infer<typeof deleteTestSessionSchema>) {
      await deps.repository.deleteDraft(await scope(userId, projectId, sessionId), input.expectedSessionVersion);
    },
    async turn(userId: string, projectId: string, sessionId: string, input: TestTurnInput) {
      const owned = await scope(userId, projectId, sessionId);
      const turnId = await deps.repository.queueTurn(owned, input);
      return { session: await deps.repository.get(owned), turnId };
    },
    async prepare(userId: string, projectId: string, sessionId: string, input: z.infer<typeof prepareTestSessionSchema>) {
      const owned = await scope(userId, projectId, sessionId);
      const session = await deps.repository.load(owned);
      // Completed confirmation replays do not rebuild context or start another generation.
      if (session.testSession!.preparations.some(({ proposalId }) => proposalId === input.proposalId)) return deps.repository.get(owned);
      assertVersion(session.testSession!.version, input.expectedSessionVersion);
      if (session.testSession!.archivedAt) throw conflict("Restore this Test before continuing.", "TEST_SESSION_ARCHIVED");
      if (session.testSession!.turns[0] && session.testSession!.turns[0].status !== "SUCCEEDED") throw conflict("Wait for a successful reply before confirming its brief.", "TEST_PROPOSAL_STALE");
      const proposal = parseProposal(session.testSession!.pendingProposal);
      if (!proposal || proposal.id !== input.proposalId || !proposal.ready) throw conflict("Review the current Test brief first.", "TEST_PROPOSAL_STALE");
      const snapshot = await deps.contextBuilder.build({ userId, projectId, title: proposal.title, objective: proposal.objective,
        target: proposal.target || undefined, environment: proposal.environment || undefined, acceptanceNotes: proposal.acceptanceNotes || undefined });
      const sourceMessages = session.messages.filter(({ id, role }) => role === "USER" && proposal.sourceMessageIds.includes(id));
      const sources = sourceMessages.map((message) => ({
        messageId: message.id, role: message.role, contentHash: hash(message.content),
        attachments: message.attachments.map(({ asset }) => ({ assetId: asset.id, purpose: asset.purpose, checksumSha256: asset.checksumSha256 })),
        inlineAttachmentsHash: hash(message.attachment),
      }));
      snapshot.sourceManifest = { ...snapshot.sourceManifest, testSession: { sessionId, proposalId: proposal.id, sources } };
      snapshot.payload = { ...snapshot.payload, confirmedTestBrief: {
        proposalId: proposal.id, sourceMessageIds: proposal.sourceMessageIds,
        // Transcript text is frozen as context, never executable instructions or evidence.
        conversationContext: sourceMessages.map(({ id, content }) => ({ messageId: id, content: content.slice(0, 12_000) })),
      } };
      snapshot.payloadHash = hash(snapshot.payload);
      await deps.repository.prepare(owned, input, snapshot);
      return deps.repository.get(owned);
    },
    async resume(userId: string, projectId: string, sessionId: string, input: z.infer<typeof resumeTestPreparationSchema>) {
      const owned = await scope(userId, projectId, sessionId);
      await deps.repository.choosePreparation(owned, input);
      return deps.repository.get(owned);
    },
  };
}

export const testSessionsService = createTestSessionsService();
