import type { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { testSessionsRepository, toDetail } from "../test-sessions/test-sessions.repository.js";
import { testSessionsService } from "../test-sessions/test-sessions.service.js";
import type { prepareTestSessionSchema, resumeTestPreparationSchema } from "../test-sessions/test-sessions.schema.js";
import type { createSessionSchema, sessionTurnSchema, updateSessionSchema, retrySessionTurnSchema } from "./sessions.schema.js";

/** Account-scoped facade over the existing durable session/QA services. */
export function createSessionsService(deps = { repository: testSessionsRepository, preparation: testSessionsService }) {
  async function owned(userId: string, sessionId: string, adopt = false, expectedUpdatedAt?: string) {
    const row = await deps.repository.readOwned(userId, sessionId);
    const scope = { userId, sessionId, projectId: row.projectId || "" };
    if (adopt) await deps.repository.adoptOwned(scope, expectedUpdatedAt);
    return { row, scope };
  }
  async function read(userId: string, sessionId: string) {
    const row = await deps.repository.readOwned(userId, sessionId);
    return { ...toDetail(row), projectId: row.projectId, managed: row.kind !== "CONVERSATION" };
  }
  return {
    list: (userId: string) => deps.repository.listAccount(userId), read,
    async create(userId: string, input: z.infer<typeof createSessionSchema>) {
      if (input.requestId && !input.projectId) throw new AppError("Choose a project.", 422, "PROJECT_REQUIRED");
      const id = input.requestId
        ? await deps.repository.create(userId, input.projectId!, input)
        : await deps.repository.createManaged(userId, input.projectId || null, input);
      return read(userId, id);
    },
    async turn(userId: string, sessionId: string, input: z.infer<typeof sessionTurnSchema>) {
      const { scope } = await owned(userId, sessionId, true, input.expectedUpdatedAt);
      const turnId = await deps.repository.queueTurn(scope, input);
      return { session: await read(userId, sessionId), turnId };
    },
    async retry(userId: string, sessionId: string, turnId: string, input: z.infer<typeof retrySessionTurnSchema>) {
      const { scope } = await owned(userId, sessionId);
      await deps.repository.retryTurn(scope, { ...input, turnId });
      return read(userId, sessionId);
    },
    async update(userId: string, sessionId: string, input: z.infer<typeof updateSessionSchema>) {
      if (input.projectId !== undefined && (input.title !== undefined || input.archived !== undefined)) throw new AppError("Change project separately.", 422, "SESSION_UPDATE_INVALID");
      const { scope } = await owned(userId, sessionId, true, input.expectedUpdatedAt);
      if (input.projectId !== undefined && input.projectId !== (scope.projectId || null)) await deps.repository.moveOwned(scope, input.projectId, input.expectedSessionVersion);
      else await deps.repository.update(scope, input);
      return read(userId, sessionId);
    },
    async remove(userId: string, sessionId: string, input: { expectedSessionVersion: number; expectedUpdatedAt?: string }) {
      const { scope } = await owned(userId, sessionId, true, input.expectedUpdatedAt);
      await deps.repository.deleteDraft(scope, input.expectedSessionVersion);
    },
    async prepare(userId: string, sessionId: string, input: z.infer<typeof prepareTestSessionSchema>) {
      const { scope } = await owned(userId, sessionId);
      if (!scope.projectId) throw new AppError("Choose a project before preparing a test.", 422, "PROJECT_REQUIRED");
      return deps.preparation.prepare(userId, scope.projectId, sessionId, input);
    },
    async resume(userId: string, sessionId: string, input: z.infer<typeof resumeTestPreparationSchema>) {
      const { scope } = await owned(userId, sessionId);
      if (!scope.projectId) throw new AppError("Choose a project before preparing a test.", 422, "PROJECT_REQUIRED");
      return deps.preparation.resume(userId, scope.projectId, sessionId, input);
    },
  };
}
export const sessionsService = createSessionsService();
