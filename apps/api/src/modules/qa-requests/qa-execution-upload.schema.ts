import { z } from "zod";

import { completeAssetSchema, initiateAssetSchema } from "../assets/assets.schema.js";

const shortId = z.string().trim().min(1).max(120);

export const initiateQaExecutionUploadSchema = initiateAssetSchema
  .omit({ projectId: true, purpose: true })
  .extend({
    checklistItemId: shortId,
    declaredMimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    requirementId: shortId,
  })
  .strict();

export const completeQaExecutionUploadSchema = completeAssetSchema;

export const qaExecutionUploadParamsSchema = z.object({
  assetId: shortId.optional(),
  executionId: shortId,
}).strict();

export type InitiateQaExecutionUploadInput = z.infer<typeof initiateQaExecutionUploadSchema>;
