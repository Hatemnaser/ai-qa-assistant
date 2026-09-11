import type {
  ProfileManifestV1,
  RecipeBundleV1,
} from "@oddpath/qa-execution-contract";

import type { QaActor, QaContextSnapshotInput, QaProcessingLease } from "./qa-requests.types.js";

export interface QaRecipeGenerationInput {
  artifact: QaRecipePlanningArtifact;
  profileManifest: ProfileManifestV1;
  requestId: string;
  signal?: AbortSignal;
  snapshot: QaContextSnapshotInput;
  userId?: string;
}

export interface QaRecipeReviewInput extends QaRecipeGenerationInput {
  recipeId: string;
  bundle: RecipeBundleV1;
}

export interface QaRecipePlanningArtifact {
  id: string;
  revision: number;
  title: string;
  items: Array<{
    clientRef: string | null;
    evidenceRequirements: Array<{
      description: string;
      id: string;
      kind: "TEXT" | "SCREENSHOT" | "LOG" | "TRACE" | "FILE" | "REFERENCE";
      required: boolean;
    }>;
    expectedResult: string;
    id: string;
    ordinal: number;
    preconditions: string[];
    steps: string[];
    title: string;
  }>;
}

export interface QaExecutionRecipeGenerator {
  generate(input: QaRecipeGenerationInput): Promise<{
    bundle: RecipeBundleV1;
    model?: string;
    provider?: string;
    title: string;
  }>;
}

export interface QaExecutionRecipeReviewer {
  review(input: QaRecipeReviewInput): Promise<{
    model?: string;
    provider?: string;
    status: "PASSED" | "SUGGESTIONS";
    suggestions: Array<Record<string, unknown>>;
    summary?: string;
  }>;
}

export interface SubmitQaExecutionRecipeCommand {
  actor: QaActor;
  artifactId: string;
  bundle: RecipeBundleV1;
  model?: string;
  origin: "ODDPATH_GENERATED" | "AGENT_PROVIDED";
  processing?: QaProcessingLease;
  profileManifest: ProfileManifestV1;
  projectId: string;
  provider?: string;
  requestId: string;
  supersedesRecipeId?: string;
  title: string;
}

export interface QaExecutionRecipeRepository {
  completeAssessment(input: {
    actor: QaActor;
    model?: string;
    processing: QaProcessingLease;
    projectId: string;
    provider?: string;
    recipeId: string;
    requestId: string;
    status: "PASSED" | "SUGGESTIONS";
    suggestions: Array<Record<string, unknown>>;
    summary?: string;
  }): Promise<void>;
  failAssessment(input: {
    actor: QaActor;
    errorCode: string;
    processing: QaProcessingLease;
    projectId: string;
    recipeId: string;
    requestId: string;
  }): Promise<void>;
  failGeneration(input: {
    actor: QaActor;
    errorCode: string;
    processing: QaProcessingLease;
    projectId: string;
    requestId: string;
  }): Promise<void>;
  getRecipe(projectId: string, requestId: string, recipeId: string): Promise<unknown | null>;
  listRecipes(projectId: string, requestId: string): Promise<unknown[]>;
  queueGeneration(input: {
    actor: QaActor;
    artifactId?: string;
    profileManifest: ProfileManifestV1;
    projectId: string;
    requestId: string;
  }): Promise<string>;
  queueReviewRetry(input: {
    actor: QaActor;
    assessmentId: string;
    projectId: string;
    recipeId: string;
    requestId: string;
  }): Promise<string>;
  submitRecipe(command: SubmitQaExecutionRecipeCommand): Promise<string>;
}
