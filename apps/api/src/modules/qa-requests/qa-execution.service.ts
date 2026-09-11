import { randomBytes } from "node:crypto";

import type {
  ExecutionClaimRequestV1,
  ExecutionFailureV1,
  ExecutionFinishV1,
  ExecutionItemSubmissionV1,
} from "@oddpath/qa-execution-contract";

import type { QaIntegrationAuth } from "../project-connections/project-connections.middleware.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { qaExecutionRepository } from "./qa-execution.repository.js";
import type {
  QaExecutionLease,
  QaExecutionRepository,
} from "./qa-execution.types.js";
import type { QaActor } from "./qa-requests.types.js";

const EXECUTION_LEASE_MS = 45_000;

export interface QaExecutionServiceDependencies {
  now?: () => Date;
  projectAccess: ProjectAccessService;
  randomLeaseToken?: () => string;
  repository: QaExecutionRepository;
}

export function createQaExecutionService({
  now = () => new Date(),
  projectAccess,
  randomLeaseToken = () => randomBytes(32).toString("base64url"),
  repository,
}: QaExecutionServiceDependencies) {
  async function start(
    userId: string,
    projectId: string,
    requestId: string,
    input: {
      confirmProduction?: boolean;
      expectedRequestVersion: number;
      profileKey: string;
      recipeHash: string;
      recipeId: string;
      runnerRegistrationId: string;
    }
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    return repository.start({
      actor: userActor(userId),
      confirmProduction: input.confirmProduction === true,
      expectedRequestVersion: input.expectedRequestVersion,
      profileKey: input.profileKey,
      projectId,
      recipeHash: input.recipeHash,
      recipeId: input.recipeId,
      requestId,
      runnerRegistrationId: input.runnerRegistrationId,
    });
  }

  async function cancel(userId: string, projectId: string, requestId: string, runId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    await repository.cancel({
      actor: userActor(userId),
      projectId,
      requestId,
      runId,
    });
  }

  async function claim(auth: QaIntegrationAuth, input: ExecutionClaimRequestV1) {
    const claimedAt = now();
    return repository.claim({
      actor: integrationActor(auth),
      connectionTokenId: auth.connectionId,
      leaseExpiresAt: new Date(claimedAt.getTime() + EXECUTION_LEASE_MS),
      leaseToken: randomLeaseToken(),
      request: input,
    });
  }

  async function accept(auth: QaIntegrationAuth, executionId: string, lease: QaExecutionLease) {
    return repository.accept({
      actor: integrationActor(auth),
      connectionTokenId: auth.connectionId,
      executionId,
      lease,
    });
  }

  async function heartbeat(auth: QaIntegrationAuth, executionId: string, lease: QaExecutionLease) {
    return repository.heartbeat({
      connectionTokenId: auth.connectionId,
      executionId,
      lease,
      leaseExpiresAt: new Date(now().getTime() + EXECUTION_LEASE_MS),
    });
  }

  async function recordItem(
    auth: QaIntegrationAuth,
    executionId: string,
    checklistItemId: string,
    lease: QaExecutionLease,
    submission: ExecutionItemSubmissionV1
  ) {
    return repository.recordItem({
      actor: integrationActor(auth),
      checklistItemId,
      connectionTokenId: auth.connectionId,
      executionId,
      lease,
      submission,
    });
  }

  async function finish(
    auth: QaIntegrationAuth,
    executionId: string,
    lease: QaExecutionLease,
    finishInput: ExecutionFinishV1
  ) {
    return repository.finish({
      actor: integrationActor(auth),
      connectionTokenId: auth.connectionId,
      executionId,
      finish: finishInput,
      lease,
    });
  }

  async function fail(
    auth: QaIntegrationAuth,
    executionId: string,
    lease: QaExecutionLease,
    failure: ExecutionFailureV1
  ) {
    return repository.fail({
      actor: integrationActor(auth),
      connectionTokenId: auth.connectionId,
      executionId,
      failure,
      lease,
    });
  }

  return { accept, cancel, claim, fail, finish, heartbeat, recordItem, start };
}

export const qaExecutionService = createQaExecutionService({
  projectAccess: projectAccessService,
  repository: qaExecutionRepository,
});

function userActor(userId: string): QaActor {
  return { kind: "USER", transport: "WEB", userId };
}

function integrationActor(auth: QaIntegrationAuth): QaActor {
  return {
    connectionTokenId: auth.connectionId,
    kind: "INTEGRATION",
    transport: "REST",
    userId: auth.ownerId,
  };
}
