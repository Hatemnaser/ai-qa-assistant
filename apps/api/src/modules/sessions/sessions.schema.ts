import { z } from "zod";
import { testSessionTurnSchema, updateTestSessionSchema } from "../test-sessions/test-sessions.schema.js";

const id = z.string().trim().min(1).max(191);
export const sessionParams = z.object({ sessionId: id });
export const createSessionSchema = z.object({ clientSessionId: id, projectId: id.nullable().optional(), title: z.string().trim().min(1).max(180).optional(), requestId: id.optional() }).strict();
export const sessionTurnSchema = testSessionTurnSchema.innerType().extend({
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  content: z.string().trim().max(20_000),
}).strict().superRefine((input, ctx) => {
  if (!input.content && !input.attachments.length) ctx.addIssue({ code: "custom", message: "Write a message or attach a file.", path: ["content"] });
  if (JSON.stringify(input.attachments).length > 4_000_000) ctx.addIssue({ code: "custom", message: "Attachments exceed the turn limit.", path: ["attachments"] });
});
export const updateSessionSchema = updateTestSessionSchema.extend({ projectId: id.nullable().optional(), expectedUpdatedAt: z.string().datetime({ offset: true }).optional() }).strict();
export const retrySessionTurnSchema = z.object({ expectedSessionVersion: z.number().int().positive(), clientRetryId: id }).strict();
