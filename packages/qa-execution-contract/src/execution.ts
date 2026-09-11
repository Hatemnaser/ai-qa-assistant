import { z } from "zod";

import { boundedIdSchema, isoDateTimeSchema, profileKeySchema, sha256HexSchema } from "./common.js";
import { resolvedProfileManifestV1Schema } from "./profile.js";
import { recipeBundleV1Schema } from "./recipe.js";

export const executionEvidenceRequirementV1Schema = z.object({
  description: z.string().trim().min(1).max(1_000),
  id: boundedIdSchema,
  kind: z.enum(["TEXT", "SCREENSHOT"]),
  required: z.boolean(),
}).strict();

export const executionChecklistItemV1Schema = z.object({
  clientRef: z.string().trim().min(1).max(120).nullable(),
  evidenceRequirements: z.array(executionEvidenceRequirementV1Schema).min(1).max(2),
  expectedResult: z.string().trim().min(1).max(2_000),
  id: boundedIdSchema,
  ordinal: z.number().int().min(0).max(79),
  title: z.string().trim().min(1).max(500),
}).strict().superRefine((value, context) => {
  const requiredByKind = new Map<string, number>();
  for (const requirement of value.evidenceRequirements) {
    if (!requirement.required) continue;
    requiredByKind.set(requirement.kind, (requiredByKind.get(requirement.kind) || 0) + 1);
  }
  for (const [kind, count] of requiredByKind) {
    if (count > 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `RecipeV1 supports at most one required ${kind} requirement per item.`,
        path: ["evidenceRequirements"],
      });
    }
  }
});

export const executionTaskV1Schema = z.object({
  artifact: z.object({
    id: boundedIdSchema,
    items: z.array(executionChecklistItemV1Schema).min(1).max(80),
    revision: z.number().int().positive(),
    title: z.string().trim().min(1).max(180),
  }).strict(),
  deadlineAt: isoDateTimeSchema,
  executionId: boundedIdSchema,
  profile: resolvedProfileManifestV1Schema,
  projectId: boundedIdSchema,
  recipe: z.object({
    bundle: recipeBundleV1Schema,
    hash: sha256HexSchema,
    id: boundedIdSchema,
    revision: z.number().int().positive(),
  }).strict(),
  requestId: boundedIdSchema,
  runId: boundedIdSchema,
  runVersion: z.number().int().positive(),
  schemaVersion: z.literal(1),
}).strict().superRefine((value, context) => {
  if (value.profile.executorKey !== value.recipe.bundle.engine) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Execution profile and recipe engine do not match.", path: ["profile", "executorKey"] });
  }
  const checklistIds = value.artifact.items.map(({ id }) => id).sort();
  const recipeIds = value.recipe.bundle.items.map(({ checklistItemId }) => checklistItemId).sort();
  if (JSON.stringify(checklistIds) !== JSON.stringify(recipeIds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Recipe must cover the execution checklist exactly.", path: ["recipe", "bundle", "items"] });
  }
});

export const executionReceiptV1Schema = z.object({
  executionId: boundedIdSchema,
  leaseExpiresAt: isoDateTimeSchema.nullable().optional(),
  requestPhase: z.enum(["RUNNING", "READY_TO_RUN", "EVIDENCE_NEEDED", "READY_FOR_REVIEW"]),
  runId: boundedIdSchema,
  runVersion: z.number().int().positive(),
  status: z.enum(["QUEUED", "CLAIMED", "RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]),
}).strict();

export const executionClaimReceiptV1Schema = z.object({
  artifactId: boundedIdSchema,
  artifactRevision: z.number().int().positive(),
  claimId: boundedIdSchema,
  executionId: boundedIdSchema,
  leaseExpiresAt: isoDateTimeSchema,
  leaseToken: z.string().min(32).max(240),
  recipeHash: sha256HexSchema,
}).strict();

export const executionClaimRequestV1Schema = z.object({
  instanceId: boundedIdSchema,
  registrationId: boundedIdSchema,
}).strict();

export const executionClaimResponseV1Schema = z.union([
  z.object({ claim: z.null() }).strict(),
  z.object({
    claim: executionClaimReceiptV1Schema,
    task: executionTaskV1Schema,
  }).strict(),
]);

export const executionFailureV1Schema = z.object({
  code: z.string().trim().regex(/^[A-Z][A-Z0-9_-]{0,63}$/u),
  message: z.string().trim().min(1).max(2_000),
}).strict();

export const executionFinishV1Schema = z.object({
  expectedRunVersion: z.number().int().positive(),
}).strict();

export const executionItemSubmissionV1Schema = z.object({
  evidence: z.array(z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("TEXT"),
      requirementId: boundedIdSchema.nullable(),
      textContent: z.string().trim().min(1).max(50_000),
    }).strict(),
    z.object({
      assetId: boundedIdSchema,
      kind: z.literal("SCREENSHOT"),
      requirementId: boundedIdSchema.nullable(),
    }).strict(),
  ])).min(1).max(3),
  expectedRunVersion: z.number().int().positive(),
  notes: z.string().trim().max(10_000).optional(),
  observedResult: z.string().trim().min(1).max(10_000),
  status: z.enum(["PASS", "FAIL", "BLOCKED"]),
}).strict();

export type ExecutionClaimReceiptV1 = z.infer<typeof executionClaimReceiptV1Schema>;
export type ExecutionClaimRequestV1 = z.infer<typeof executionClaimRequestV1Schema>;
export type ExecutionClaimResponseV1 = z.infer<typeof executionClaimResponseV1Schema>;
export type ExecutionFailureV1 = z.infer<typeof executionFailureV1Schema>;
export type ExecutionFinishV1 = z.infer<typeof executionFinishV1Schema>;
export type ExecutionItemSubmissionV1 = z.infer<typeof executionItemSubmissionV1Schema>;
export type ExecutionReceiptV1 = z.infer<typeof executionReceiptV1Schema>;
export type ExecutionTaskV1 = z.infer<typeof executionTaskV1Schema>;
