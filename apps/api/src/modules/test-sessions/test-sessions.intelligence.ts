import type { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { createChatReply } from "../chat/chat.service.js";
import { testSessionAiResponseSchema } from "./test-sessions.schema.js";
import type { TestSessionDetail } from "./test-sessions.types.js";
import type { ChatRequest } from "../chat/chat.types.js";
import { QA_CHAT_MODES } from "../chat/chat.schema.js";

export interface TestSessionIntelligenceInput {
  userId: string;
  projectId: string;
  session: TestSessionDetail;
  content: string;
  attachments: NonNullable<ChatRequest["attachments"]>;
  recordedResults?: unknown;
  model?: string;
  mode?: typeof QA_CHAT_MODES[number];
}
export function createTestSessionIntelligence(reply = createChatReply) {
  return {
    async discuss(input: TestSessionIntelligenceInput): Promise<{ response: z.infer<typeof testSessionAiResponseSchema>; model: string }> {
      const response = await reply({
        chatId: input.session.id, projectId: input.projectId || undefined, history: [],
        mode: input.mode || "general", model: input.model, attachments: input.attachments,
        message: input.content || "Please examine the attached material and ask what help is needed.",
      }, { userId: input.userId, sessionContext: {
        projectId: input.projectId || null,
        currentRequestId: input.session.currentRequestId,
        requests: input.session.requests.slice(-5).map(request => ({ ...request, objective: request.objective.slice(0, 1_000) })),
        recordedResults: input.recordedResults ?? [], preparation: input.session.preparation,
        previousProposal: input.session.pendingProposal,
      } });
      let parsed: unknown;
      try { parsed = JSON.parse(response.reply.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "")); }
      catch { throw new AppError("The assistant returned an unusable reply. Retry this turn.", 502, "TEST_TURN_OUTPUT_INVALID"); }
      const validated = testSessionAiResponseSchema.safeParse(parsed);
      if (!validated.success || (validated.data.proposalAction === "replace" && !validated.data.proposal)) throw new AppError("The assistant returned an unusable reply. Retry this turn.", 502, "TEST_TURN_OUTPUT_INVALID");
      return { response: validated.data, model: response.model };
    },
  };
}
export const testSessionIntelligence = createTestSessionIntelligence();
