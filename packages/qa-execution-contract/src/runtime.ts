import { z } from "zod";
import { isoDateTimeSchema, sha256HexSchema } from "./common.js";

export const runtimeRegistrationV2Schema = z.object({
  runtimeId: z.string().uuid(),
  imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  preparationDeadlineAt: isoDateTimeSchema.optional(),
}).strict();
export const runtimeExitV2Schema = z.object({
  runtimeId: z.string().uuid(),
  processExited: z.literal(true),
  observedAt: isoDateTimeSchema,
}).strict();
export const browserViewerGrantSchema = z.object({
  schemaVersion: z.literal(1),
  executionId: z.string().min(1).max(120),
  runtimeId: z.string().uuid(),
  ownerId: z.string().min(1).max(120),
  projectId: z.string().min(1).max(120),
  bindingHash: sha256HexSchema,
  nonce: z.string().uuid(),
  expiresAt: z.number().int().positive(),
  mode: z.literal("VIEW"),
}).strict();
export type BrowserViewerGrant = z.infer<typeof browserViewerGrantSchema>;

export const browserLoginGrantSchema = browserViewerGrantSchema.extend({
  mode: z.literal("LOGIN"), controlEpoch: z.string().uuid(),
}).strict();
export const browserAccessGrantSchema = z.union([browserViewerGrantSchema, browserLoginGrantSchema]);
export const runtimeLoginAckSchema = z.object({
  runtimeId: z.string().uuid(), controlEpoch: z.string().uuid(), phase: z.enum(["LOGIN", "READY"]),
}).strict();
