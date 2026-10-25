import { z } from "zod";

import { boundedIdSchema, hasUniqueValues, isoDateTimeSchema, sha256HexSchema } from "./common.js";
import { executionClaimReceiptV1Schema, executionTaskV1Schema } from "./execution.js";
import { profileManifestV1Schema } from "./profile.js";
import { runnerRegistrationV1Schema } from "./runner.js";
import { authenticationIdentityV2Schema, executionLimitsV2Schema, targetSnapshotV2Schema } from "./target.js";

export const profileManifestV2Schema = z.object({
  authentication: authenticationIdentityV2Schema,
  environmentKind: z.enum(["LOCAL", "TEST", "STAGING", "PRODUCTION"]),
  evidenceKinds: z.array(z.enum(["TEXT", "SCREENSHOT"])).min(1).max(2),
  executionLimits: executionLimitsV2Schema,
  executorKey: z.literal("playwright"),
  label: z.string().trim().min(1).max(120),
  manifestHash: sha256HexSchema.optional(),
  profileKey: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/u),
  recipeSchemaVersions: z.array(z.literal(1)).length(1),
  schemaVersion: z.literal(2),
  target: targetSnapshotV2Schema,
  valueReferences: z.array(z.object({ key: z.string().regex(/^[a-z][a-z0-9._-]{0,119}$/u), secret: z.boolean() }).strict()).max(100),
}).strict().superRefine((value, context) => {
  if (value.environmentKind !== value.target.environmentKind) context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile and target environments must match.", path: ["environmentKind"] });
  if (!hasUniqueValues(value.evidenceKinds) || !hasUniqueValues(value.valueReferences.map(({ key }) => key))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile capabilities and value references must be unique." });
  if (value.authentication.kind === "SAVED_STATE" && value.authentication.targetRevisionId !== value.target.revisionId) context.addIssue({ code: z.ZodIssueCode.custom, message: "Authentication must belong to the target revision.", path: ["authentication"] });
});

export const profileManifestSchema = z.union([profileManifestV1Schema, profileManifestV2Schema]);

export const executionApprovalV2Schema = z.object({
  approvedAt: isoDateTimeSchema,
  artifactId: boundedIdSchema,
  bindingHash: sha256HexSchema,
  expiresAt: isoDateTimeSchema,
  id: boundedIdSchema,
  profileManifestHash: sha256HexSchema,
  recipeHash: sha256HexSchema,
  recipeId: boundedIdSchema,
  requestVersion: z.number().int().positive(),
  targetRevisionId: boundedIdSchema,
  targetHash: sha256HexSchema,
  verificationId: boundedIdSchema,
}).strict();

export const executionBindingV2Schema = executionApprovalV2Schema.omit({ bindingHash: true }).extend({
  authentication: authenticationIdentityV2Schema,
  executionLimits: executionLimitsV2Schema,
  candidate: targetSnapshotV2Schema.shape.candidate,
}).strict();

export const executionTaskV2Schema = z.object({
  approval: executionApprovalV2Schema,
  artifact: executionTaskV1Schema.shape.artifact,
  deadlineAt: isoDateTimeSchema,
  executionId: boundedIdSchema,
  profile: profileManifestV2Schema.refine((value) => Boolean(value.manifestHash), "Resolved profile hash required."),
  projectId: boundedIdSchema,
  recipe: executionTaskV1Schema.shape.recipe,
  requestId: boundedIdSchema,
  runId: boundedIdSchema,
  runVersion: z.number().int().positive(),
  schemaVersion: z.literal(2),
}).strict().superRefine((value, context) => {
  const a = value.approval;
  if (a.artifactId !== value.artifact.id || a.recipeId !== value.recipe.id
    || a.recipeHash !== value.recipe.hash || a.profileManifestHash !== value.profile.manifestHash
    || a.targetRevisionId !== value.profile.target.revisionId || a.targetHash !== value.profile.target.targetHash
    || new Date(a.expiresAt) <= new Date(a.approvedAt)
    || new Date(value.deadlineAt) <= new Date(a.approvedAt)
    || new Date(a.expiresAt).getTime() > new Date(a.approvedAt).getTime() + value.profile.executionLimits.executionTimeoutMs
      + (value.profile.authentication.kind !== "NONE" ? value.profile.executionLimits.preparationTimeoutMs : 0)
    || new Date(value.deadlineAt) > new Date(a.expiresAt)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Task must match its exact approval and deadline.", path: ["approval"] });
  }
  const itemIds = value.artifact.items.map(({ id }) => id).sort();
  const recipeIds = value.recipe.bundle.items.map(({ checklistItemId }) => checklistItemId).sort();
  if (JSON.stringify(itemIds) !== JSON.stringify(recipeIds)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Recipe must cover the checklist exactly.", path: ["recipe"] });
});

export const executionTaskSchema = z.union([executionTaskV1Schema, executionTaskV2Schema]);
export const executionClaimResponseSchema = z.union([
  z.object({ claim: z.null() }).strict(),
  z.object({ claim: executionClaimReceiptV1Schema, task: executionTaskSchema }).strict(),
]);

export const runnerRegistrationV2Schema = z.object({
  displayName: z.string().trim().min(1).max(120),
  executorKeys: z.array(z.literal("playwright")).min(1).max(4),
  instanceId: boundedIdSchema,
  profiles: z.array(profileManifestV2Schema).min(1).max(20),
  protocolVersions: z.array(z.literal(2)).length(1),
  runnerVersion: z.string().trim().min(1).max(80),
  schemaVersion: z.literal(2),
}).strict().refine((value) => hasUniqueValues(value.profiles.map(({ profileKey }) => profileKey)) && hasUniqueValues(value.executorKeys), "Profile keys and engines must be unique.");
export const runnerRegistrationSchema = z.union([runnerRegistrationV1Schema, runnerRegistrationV2Schema]);

export const runnerRegistrationReceiptV2Schema = z.object({
  heartbeatAfterMs: z.number().int().min(5_000).max(60_000),
  profiles: z.array(profileManifestV2Schema),
  projectId: boundedIdSchema,
  registeredAt: isoDateTimeSchema,
  registrationId: boundedIdSchema,
  schemaVersion: z.literal(2),
}).strict();

// Termination receipts are a separate runtime contract. None of these values
// can be inferred from a database cancellation or an expired heartbeat.
export const stopReceiptV2Schema = z.object({
  executionId: boundedIdSchema,
  status: z.enum(["STOP_REQUESTED", "STOP_CONFIRMED", "STOP_UNCONFIRMED"]),
  requestedAt: isoDateTimeSchema,
  confirmedAt: isoDateTimeSchema.nullable(),
  runtimeId: boundedIdSchema,
  terminationProof: z.object({ processExited: z.literal(true), observedAt: isoDateTimeSchema }).strict().nullable(),
}).strict().superRefine((value, context) => {
  const confirmed = value.status === "STOP_CONFIRMED";
  if (confirmed ? !value.confirmedAt || !value.terminationProof : value.confirmedAt !== null || value.terminationProof !== null) context.addIssue({ code: z.ZodIssueCode.custom, message: "Only confirmed Stop carries runtime termination proof." });
  if (value.confirmedAt && new Date(value.confirmedAt) < new Date(value.requestedAt)) context.addIssue({ code: z.ZodIssueCode.custom, message: "Stop cannot be confirmed before it was requested." });
  if (value.terminationProof && value.confirmedAt && (new Date(value.terminationProof.observedAt) < new Date(value.requestedAt) || new Date(value.terminationProof.observedAt) > new Date(value.confirmedAt))) context.addIssue({ code: z.ZodIssueCode.custom, message: "Termination must be observed between Stop request and confirmation." });
});

export type ProfileManifestV2 = z.infer<typeof profileManifestV2Schema>;
export type ProfileManifest = z.infer<typeof profileManifestSchema>;
export type ExecutionTaskV2 = z.infer<typeof executionTaskV2Schema>;
export type RunnerRegistration = z.infer<typeof runnerRegistrationSchema>;
export type RunnerRegistrationReceiptV2 = z.infer<typeof runnerRegistrationReceiptV2Schema>;
