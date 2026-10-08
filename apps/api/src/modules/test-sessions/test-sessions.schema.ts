import { z } from "zod";
import { chatAttachmentSchema } from "../chat/chat.schema.js";
import { QA_CHAT_MODES } from "../chat/chat.schema.js";
import { DATA_LIMITS } from "../../config/data-limits.js";

const id = z.string().trim().min(1).max(191);
const version = z.number().int().positive();
export const testSessionProjectParams = z.object({ projectId: id }).strict();
export const testSessionParams = testSessionProjectParams.extend({ sessionId: id }).strict();
export const createTestSessionSchema = z.object({
  clientSessionId: id.optional(),
  title: z.string().trim().min(1).max(180).optional(),
  requestId: id.optional(),
}).strict();
export const activateTestSessionSchema = z.object({
  chatId: id,
  expectedUpdatedAt: z.string().datetime({ offset: true }),
  expectedMessageCount: z.number().int().min(0).max(DATA_LIMITS.messagesPerChat),
}).strict();
export const updateTestSessionSchema = z.object({
  expectedSessionVersion: version,
  title: z.string().trim().min(1).max(180).optional(),
  archived: z.boolean().optional(),
}).strict();
export const deleteTestSessionSchema = z.object({ expectedSessionVersion: version }).strict();
export const testSessionTurnSchema = z.object({
  clientTurnId: id,
  expectedSessionVersion: version,
  content: z.string().trim().min(1).max(20_000),
  attachments: z.array(chatAttachmentSchema).max(8).default([]),
  model: z.string().trim().min(1).max(191).optional(),
  mode: z.enum(QA_CHAT_MODES).default("general"),
}).strict().superRefine((input, context) => {
  if (JSON.stringify(input.attachments).length > 4_000_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Attachments exceed the test turn size limit.", path: ["attachments"] });
  }
});
export type TestTurnInput = Omit<z.infer<typeof testSessionTurnSchema>, "mode"> & { mode?: z.infer<typeof testSessionTurnSchema>["mode"] };
const profileSelection = {
  runnerRegistrationId: id.optional(),
  profileKey: id.optional(),
};
export const prepareTestSessionSchema = z.object({
  expectedSessionVersion: version,
  proposalId: id,
  ...profileSelection,
}).strict();
export const resumeTestPreparationSchema = z.object({
  expectedSessionVersion: version,
  action: z.enum(["resume", "retry"]),
  ...profileSelection,
}).strict();
export const testSessionProposalSchema = z.object({
  title: z.string().trim().min(1).max(180),
  objective: z.string().trim().min(1).max(DATA_LIMITS.qaRequestTextChars),
  target: z.string().trim().max(500).nullable(),
  environment: z.string().trim().max(500).nullable(),
  acceptanceNotes: z.string().trim().max(5_000).nullable(),
  ready: z.boolean(),
}).strict();
export const testSessionAiResponseSchema = z.object({
  reply: z.string().trim().min(1).max(20_000),
  proposal: testSessionProposalSchema.nullable(),
  proposalAction: z.enum(["keep", "replace", "clear"]).optional(),
}).strict();
