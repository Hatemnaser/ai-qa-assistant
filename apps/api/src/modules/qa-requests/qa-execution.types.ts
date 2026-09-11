import type {
  ExecutionClaimRequestV1,
  ExecutionFailureV1,
  ExecutionFinishV1,
  ExecutionItemSubmissionV1,
} from "@oddpath/qa-execution-contract";

import type { QaActor } from "./qa-requests.types.js";

export interface QaExecutionLease {
  claimId: string;
  leaseToken: string;
}

export interface QaExecutionRepository {
  assertEvidenceUpload(input: {
    assetId: string;
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
  }): Promise<void>;
  accept(input: {
    actor: QaActor;
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
  }): Promise<unknown>;
  cancel(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    runId: string;
  }): Promise<void>;
  claim(input: {
    actor: QaActor;
    connectionTokenId: string;
    leaseExpiresAt: Date;
    leaseToken: string;
    request: ExecutionClaimRequestV1;
  }): Promise<unknown | null>;
  fail(input: {
    actor: QaActor;
    connectionTokenId: string;
    executionId: string;
    failure: ExecutionFailureV1;
    lease: QaExecutionLease;
  }): Promise<unknown>;
  finish(input: {
    actor: QaActor;
    connectionTokenId: string;
    executionId: string;
    finish: ExecutionFinishV1;
    lease: QaExecutionLease;
  }): Promise<unknown>;
  heartbeat(input: {
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
    leaseExpiresAt: Date;
  }): Promise<unknown>;
  prepareEvidenceUpload(input: {
    checklistItemId: string;
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
    requirementId: string;
  }): Promise<void>;
  recordItem(input: {
    actor: QaActor;
    checklistItemId: string;
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
    submission: ExecutionItemSubmissionV1;
  }): Promise<unknown>;
  reserveEvidenceUpload(input: {
    assetId: string;
    checklistItemId: string;
    connectionTokenId: string;
    executionId: string;
    lease: QaExecutionLease;
    requirementId: string;
  }): Promise<void>;
  start(input: {
    actor: QaActor;
    confirmProduction: boolean;
    expectedRequestVersion: number;
    profileKey: string;
    projectId: string;
    recipeHash: string;
    recipeId: string;
    requestId: string;
    runnerRegistrationId: string;
  }): Promise<{ executionId: string; runId: string }>;
}
