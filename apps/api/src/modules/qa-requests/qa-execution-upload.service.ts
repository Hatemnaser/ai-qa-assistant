import type { QaIntegrationAuth } from "../project-connections/project-connections.middleware.js";
import { assetsService } from "../assets/assets.service.js";
import type { CompleteAssetInput } from "../assets/assets.types.js";
import { qaExecutionRepository } from "./qa-execution.repository.js";
import type { QaExecutionLease } from "./qa-execution.types.js";
import type { InitiateQaExecutionUploadInput } from "./qa-execution-upload.schema.js";

export function createQaExecutionUploadService() {
  async function initiate(
    auth: QaIntegrationAuth,
    executionId: string,
    lease: QaExecutionLease,
    input: InitiateQaExecutionUploadInput
  ) {
    await qaExecutionRepository.prepareEvidenceUpload({
      checklistItemId: input.checklistItemId,
      connectionTokenId: auth.connectionId,
      executionId,
      lease,
      requirementId: input.requirementId,
    });
    const initiated = await assetsService.initiateUpload(auth.ownerId, {
      checksumSha256: input.checksumSha256,
      declaredMimeType: input.declaredMimeType,
      expectedSizeBytes: input.expectedSizeBytes,
      originalName: input.originalName,
      projectId: auth.projectId,
      purpose: "QA_EVIDENCE",
    });
    try {
      await qaExecutionRepository.reserveEvidenceUpload({
        assetId: initiated.asset.id,
        checklistItemId: input.checklistItemId,
        connectionTokenId: auth.connectionId,
        executionId,
        lease,
        requirementId: input.requirementId,
      });
    } catch (error) {
      await assetsService.cancelUpload(auth.ownerId, initiated.asset.id).catch(() => {});
      throw error;
    }
    return initiated;
  }

  async function complete(
    auth: QaIntegrationAuth,
    executionId: string,
    assetId: string,
    lease: QaExecutionLease,
    input: CompleteAssetInput
  ) {
    await qaExecutionRepository.assertEvidenceUpload({
      assetId,
      connectionTokenId: auth.connectionId,
      executionId,
      lease,
    });
    return assetsService.completeUpload(auth.ownerId, assetId, input);
  }

  return { complete, initiate };
}

export const qaExecutionUploadService = createQaExecutionUploadService();
