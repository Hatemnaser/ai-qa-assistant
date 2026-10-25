import { z } from "zod";

import { boundedIdSchema, hasUniqueValues, sha256HexSchema } from "./common.js";

export const environmentKindSchema = z.enum(["LOCAL", "TEST", "STAGING", "PRODUCTION"]);

export function normalizeTargetUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password
    || /[?#\\\u0000-\u0020\u007f]/u.test(value) || url.port
    || !url.hostname.includes(".") || /^[\d.]+$/u.test(url.hostname)
    || url.hostname.endsWith(".") || url.hostname.includes(":")
    || url.hostname.length > 253
    || !url.hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/iu.test(label))) {
    throw new Error("Use a public HTTPS hostname without credentials, port, query or fragment.");
  }
  return url.href;
}

export const targetUrlSchema = z.string().trim().max(2_000).transform((value, context) => {
  try { return normalizeTargetUrl(value); }
  catch { context.addIssue({ code: z.ZodIssueCode.custom, message: "A public HTTPS URL without credentials, port, query or fragment is required." }); return z.NEVER; }
});

export const targetOriginSchema = targetUrlSchema.pipe(
  z.string().refine(
    (value) => new URL(value).pathname === "/", "Dependency URLs must be exact origins."
  ).transform((value) => new URL(value).origin)
);

const originsSchema = z.array(targetOriginSchema).max(20).refine(hasUniqueValues, "Origins must be unique.");

export const targetDefinitionSchema = z.object({
  authenticationOrigins: originsSchema.default([]),
  baseUrl: targetUrlSchema,
  candidate: z.object({ reference: z.string().trim().min(1).max(240), source: z.literal("DECLARED") }).strict().nullable().default(null),
  environmentKind: environmentKindSchema,
  resourceOrigins: originsSchema.default([]),
}).strict();

export const targetSnapshotV2Schema = targetDefinitionSchema.extend({
  revision: z.number().int().positive(),
  revisionId: boundedIdSchema,
  targetId: boundedIdSchema,
  targetHash: sha256HexSchema,
}).strict();

export const authenticationIdentityV2Schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("NONE") }).strict(),
  z.object({ kind: z.literal("MANUAL") }).strict(),
  z.object({ kind: z.literal("SAVED_STATE"), id: boundedIdSchema, revision: z.number().int().positive(), targetRevisionId: boundedIdSchema }).strict(),
]);

export const executionLimitsV2Schema = z.object({
  executionTimeoutMs: z.number().int().min(1_000).max(600_000),
  preparationTimeoutMs: z.number().int().min(1_000).max(300_000),
}).strict();

export type TargetDefinition = z.infer<typeof targetDefinitionSchema>;
export type TargetSnapshotV2 = z.infer<typeof targetSnapshotV2Schema>;
