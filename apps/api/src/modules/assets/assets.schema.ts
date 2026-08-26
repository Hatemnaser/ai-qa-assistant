import { z } from "zod";

const sha256Base64Schema = z
  .string()
  .trim()
  .regex(/^[A-Za-z0-9+/]{43}=$/, "A base64 SHA-256 checksum is required.");

export const initiateAssetSchema = z.object({
  checksumSha256: sha256Base64Schema,
  declaredMimeType: z.string().trim().min(1).max(120).transform((value) => value.toLowerCase()),
  expectedSizeBytes: z.number().int().min(1),
  originalName: z.string().trim().min(1).max(180).refine(
    (value) => !/[\u0000-\u001f\u007f/\\]/u.test(value),
    "File name contains unsupported characters."
  ),
  projectId: z.string().trim().min(1).max(120).nullish().transform((value) => value || null),
  purpose: z.enum(["CHAT_ATTACHMENT", "PROJECT_DOCUMENT_SOURCE"]),
}).strict();

export const completeAssetSchema = z.object({
  checksumSha256: sha256Base64Schema,
}).strict();

export const assetIdParamsSchema = z.object({
  assetId: z.string().trim().min(1).max(120),
}).strict();
