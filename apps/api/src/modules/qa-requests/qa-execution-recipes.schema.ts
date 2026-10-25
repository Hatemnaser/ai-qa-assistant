import {
  profileManifestSchema,
  recipeBundleV1Schema,
} from "@oddpath/qa-execution-contract";
import { z } from "zod";

const shortId = z.string().trim().min(1).max(120);

export const qaRecipeParamsSchema = z.object({
  artifactId: shortId.optional(),
  projectId: shortId,
  recipeId: shortId.optional(),
  requestId: shortId,
}).strict();

export const generateQaExecutionRecipeSchema = z.object({
  artifactId: shortId.optional(),
  profileManifest: profileManifestSchema,
}).strict();

export const submitQaExecutionRecipeSchema = z.object({
  artifactId: shortId,
  bundle: recipeBundleV1Schema,
  profileManifest: profileManifestSchema,
  supersedesRecipeId: shortId.optional(),
  title: z.string().trim().min(1).max(180),
}).strict();

export const retryQaExecutionRecipeReviewSchema = z.object({
  assessmentId: shortId,
}).strict();

export type GenerateQaExecutionRecipeInput = z.infer<typeof generateQaExecutionRecipeSchema>;
export type RetryQaExecutionRecipeReviewInput = z.infer<typeof retryQaExecutionRecipeReviewSchema>;
export type SubmitQaExecutionRecipeInput = z.infer<typeof submitQaExecutionRecipeSchema>;
