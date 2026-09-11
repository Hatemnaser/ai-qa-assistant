import type { QaGenerationKind } from "../../generated/prisma/client.js";

export interface ClaimedQaProcessingJob {
  artifactId: string | null;
  attempts: number;
  id: string;
  kind: QaGenerationKind;
  leaseExpiresAt: Date;
  leaseToken: string;
  profileManifest: unknown;
  profileManifestHash: string | null;
  recipeId: string | null;
  requestId: string;
}

export interface QaProcessingOperationDto {
  artifactId: string | null;
  attempts: number;
  availableAt: string | null;
  completedAt: string | null;
  errorCode: string | null;
  kind: QaGenerationKind;
  operationId: string;
  recipeId: string | null;
  requestId: string;
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED";
}

export interface QaProcessingHandler {
  fail(job: ClaimedQaProcessingJob, errorCode: string): Promise<void>;
  run(job: ClaimedQaProcessingJob, signal: AbortSignal): Promise<void>;
}

export type QaProcessingHandlers = Partial<Record<QaGenerationKind, QaProcessingHandler>>;

export interface QaProcessingRepository {
  claimNext(input: {
    kinds: QaGenerationKind[];
    leaseExpiresAt: Date;
    leaseToken: string;
    now: Date;
  }): Promise<ClaimedQaProcessingJob | null>;
  countQueue(now: Date): Promise<{ pending: number; processing: number; stale: number }>;
  getOperation(projectId: string, operationId: string): Promise<QaProcessingOperationDto | null>;
  getRequestOperation(input: {
    artifactId?: string;
    kind: QaGenerationKind;
    recipeId?: string;
    requestId: string;
  }): Promise<QaProcessingOperationDto | null>;
  markTerminal(input: {
    errorCode: string;
    id: string;
    leaseToken: string;
  }): Promise<boolean>;
  scheduleRetry(input: {
    availableAt: Date;
    errorCode: string;
    id: string;
    leaseToken: string;
  }): Promise<boolean>;
}
