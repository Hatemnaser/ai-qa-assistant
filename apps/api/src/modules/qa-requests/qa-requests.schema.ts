import { z } from "zod";

import { DATA_LIMITS } from "../../config/data-limits.js";

const shortId = z.string().trim().min(1).max(120);
const boundedText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalBoundedText = (maximum: number) =>
  z.string().trim().max(maximum).optional().transform((value) => value || undefined);

export const qaProjectParamsSchema = z.object({ projectId: shortId }).strict();
export const qaRequestParamsSchema = z.object({ projectId: shortId, requestId: shortId }).strict();
export const qaOperationParamsSchema = z.object({ projectId: shortId, operationId: shortId }).strict();
export const qaArtifactParamsSchema = z.object({
  projectId: shortId,
  requestId: shortId,
  artifactId: shortId,
}).strict();
export const qaRunParamsSchema = z.object({
  projectId: shortId,
  requestId: shortId,
  runId: shortId,
}).strict();
export const qaCheckResultParamsSchema = z.object({
  projectId: shortId,
  requestId: shortId,
  runId: shortId,
  checklistItemId: shortId,
}).strict();

export const createQaRequestSchema = z.object({
  title: boundedText(180),
  objective: boundedText(DATA_LIMITS.qaRequestTextChars),
  target: optionalBoundedText(500),
  environment: optionalBoundedText(500),
  acceptanceNotes: optionalBoundedText(5_000),
  checklistMode: z.enum(["ODDPATH_GENERATED", "AGENT_PROVIDED"]).default("ODDPATH_GENERATED"),
}).strict();

export const createAgentQaRequestSchema = createQaRequestSchema.extend({
  checklistMode: z.literal("AGENT_PROVIDED").default("AGENT_PROVIDED"),
}).strict();

const evidenceRequirementSchema = z.object({
  kind: z.enum(["TEXT", "SCREENSHOT", "LOG", "TRACE", "FILE", "REFERENCE"]),
  description: boundedText(1_000),
  required: z.boolean().optional(),
}).strict();

const checklistItemSchema = z.object({
  clientRef: optionalBoundedText(120),
  title: boundedText(500),
  category: optionalBoundedText(120),
  priority: optionalBoundedText(40),
  preconditions: z.array(boundedText(1_000)).max(30).default([]),
  steps: z.array(boundedText(2_000)).min(1).max(50),
  expectedResult: boundedText(2_000),
  evidenceRequirements: z.array(evidenceRequirementSchema).min(1).max(20),
}).strict();

export const qaChecklistDraftSchema = z.object({
  title: boundedText(180),
  items: z.array(checklistItemSchema).min(1).max(DATA_LIMITS.qaChecklistItemsPerArtifact),
}).strict();

export const submitQaChecklistSchema = z.object({
  origin: z.literal("AGENT_PROVIDED").default("AGENT_PROVIDED"),
  supersedesArtifactId: shortId.optional(),
  checklist: qaChecklistDraftSchema,
}).strict();

export const selectQaArtifactSchema = z.object({
  expectedRequestVersion: z.number().int().positive(),
}).strict();

const startQaRunShape = {
  confirmProduction: z.boolean().optional(),
  sourceLabel: optionalBoundedText(120),
  externalRunRef: optionalBoundedText(240),
  commitSha: optionalBoundedText(120),
  executionMode: z.enum(["CONNECTED_AGENT", "PLAYWRIGHT"]).default("CONNECTED_AGENT"),
  expectedRequestVersion: z.number().int().positive().optional(),
  profileKey: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/u).optional(),
  recipeHash: z.string().regex(/^[a-f0-9]{64}$/u).optional(),
  recipeId: shortId.optional(),
  runnerRegistrationId: shortId.optional(),
};

function validatePlaywrightStart(
  value: z.infer<ReturnType<typeof createStartQaRunObjectSchema>>,
  context: z.RefinementCtx
) {
  if (value.executionMode !== "PLAYWRIGHT") return;
  for (const field of [
    "expectedRequestVersion",
    "profileKey",
    "recipeHash",
    "recipeId",
    "runnerRegistrationId",
  ] as const) {
    if (value[field] === undefined) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${field} is required for Playwright execution.`,
        path: [field],
      });
    }
  }
}

function createStartQaRunObjectSchema() {
  return z.object(startQaRunShape).strict();
}

export const startQaRunSchema = createStartQaRunObjectSchema().superRefine(validatePlaywrightStart);

export const startQaRunMcpSchema = z.object({
  ...startQaRunShape,
  idempotencyKey: z.string()
    .regex(/^[A-Za-z0-9._:-]{8,200}$/, "Use 8-200 URL-safe characters."),
  requestId: shortId,
}).strict().superRefine(validatePlaywrightStart);

export const recordQaCheckResultSchema = z.object({
  status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIPPED"]),
  observedResult: optionalBoundedText(10_000),
  notes: optionalBoundedText(10_000),
  expectedVersion: z.number().int().positive(),
}).strict();

export const addQaEvidenceSchema = z.object({
  checklistItemId: shortId.optional(),
  requirementId: shortId.optional(),
  kind: z.enum(["TEXT", "SCREENSHOT", "LOG", "TRACE", "FILE", "REFERENCE"]),
  textContent: optionalBoundedText(50_000),
  externalReference: optionalBoundedText(2_000),
  assetIds: z.array(shortId).max(4).default([]),
  metadata: z.record(z.unknown()).optional(),
}).strict().superRefine((value, context) => {
  if (value.metadata && JSON.stringify(value.metadata).length > 20_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence metadata is too large.",
      path: ["metadata"],
    });
  }
  if (!value.textContent && !value.externalReference && value.assetIds.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Evidence content, reference, or asset is required.",
    });
  }
  if (
    ["SCREENSHOT", "FILE"].includes(value.kind) &&
    value.assetIds.length === 0 &&
    !value.externalReference
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Screenshot and file evidence require an asset or external reference.",
      path: ["externalReference"],
    });
  }
  if (["SCREENSHOT", "FILE"].includes(value.kind) && value.externalReference) {
    try {
      const reference = new URL(value.externalReference);
      if (reference.protocol !== "https:" || reference.username || reference.password) {
        throw new Error();
      }
    } catch {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "External file evidence must use an HTTPS URL without credentials.",
        path: ["externalReference"],
      });
    }
  }
});

export const finishQaRunSchema = z.object({
  expectedVersion: z.number().int().positive(),
}).strict();

export const reviewQaRunSchema = z.object({
  decision: z.enum(["APPROVED", "CHANGES_REQUESTED"]),
  comment: optionalBoundedText(10_000),
  expectedRunVersion: z.number().int().positive(),
}).strict();

export const listQaRequestsQuerySchema = z.object({
  cursor: z.string().trim().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
}).strict();

export type CreateQaRequestInput = z.infer<typeof createQaRequestSchema>;
export type SubmitQaChecklistInput = z.infer<typeof submitQaChecklistSchema>;
export type StartQaRunInput = z.infer<typeof startQaRunSchema>;
export type RecordQaCheckResultInput = z.infer<typeof recordQaCheckResultSchema>;
export type AddQaEvidenceInput = z.infer<typeof addQaEvidenceSchema>;
export type FinishQaRunInput = z.infer<typeof finishQaRunSchema>;
export type ReviewQaRunInput = z.infer<typeof reviewQaRunSchema>;
