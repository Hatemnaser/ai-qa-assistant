import { z } from "zod";
import { targetDefinitionSchema } from "@oddpath/qa-execution-contract";

const id = z.string().trim().min(1).max(120);
export const targetParamsSchema = z.object({ projectId: id, targetId: id.optional(), verificationId: id.optional() }).strict();
export const createTargetSchema = z.object({
  acknowledgeAuthority: z.literal(true),
  definition: targetDefinitionSchema,
  label: z.string().trim().min(1).max(120),
}).strict();
export const reviseTargetSchema = createTargetSchema.extend({ expectedRevision: z.number().int().positive() }).strict();
export const challengeTargetSchema = z.object({ expectedRevision: z.number().int().positive(), method: z.enum(["DNS_TXT", "HTTPS_FILE"]) }).strict();
export type CreateTargetInput = z.infer<typeof createTargetSchema>;
