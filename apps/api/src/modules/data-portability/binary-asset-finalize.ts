import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { UploadedPortableBinaryAsset } from "./binary-asset-restore.types.js";
import type { ValidatedPortableBinaryAsset } from "./binary-assets.js";

export interface ImportedMessageAssetTarget {
  messageId: string;
  projectId: string | null;
}

export interface ImportedDocumentAssetTarget {
  documentId: string;
  projectId: string;
}

export interface BinaryAssetFinalizeTargets {
  documentsBySourceId: ReadonlyMap<string, ImportedDocumentAssetTarget>;
  messagesBySourceId: ReadonlyMap<string, ImportedMessageAssetTarget>;
}

export function assertUploadedAssetsMatchPackage(
  expectedAssets: readonly ValidatedPortableBinaryAsset[],
  uploadedAssets: readonly UploadedPortableBinaryAsset[]
) {
  if (expectedAssets.length !== uploadedAssets.length) throwFinalizeFailure();

  const uploadedBySourceId = new Map(
    uploadedAssets.map((asset) => [asset.descriptor.sourceAssetId, asset])
  );
  if (uploadedBySourceId.size !== uploadedAssets.length) throwFinalizeFailure();

  for (const expected of expectedAssets) {
    const uploaded = uploadedBySourceId.get(expected.sourceAssetId);
    if (!uploaded || !sameDescriptor(expected, uploaded.descriptor)) {
      throwFinalizeFailure();
    }
  }
}

/**
 * Promotes previously uploaded staging rows and binds them to imported data in
 * the caller's transaction. Any mismatch aborts that same transaction; the
 * staging deletion jobs therefore remain available for cleanup.
 */
export async function finalizeStagedBinaryAssets(
  tx: Prisma.TransactionClient,
  ownerId: string,
  uploadedAssets: readonly UploadedPortableBinaryAsset[],
  targets: BinaryAssetFinalizeTargets,
  readyAt = new Date()
) {
  if (uploadedAssets.length === 0) return;

  assertUniqueRestorePlan(uploadedAssets);
  const fence = uploadedAssets[0]!.fence;
  const assetIds = uploadedAssets.map((asset) => asset.assetId);
  const objectKeys = uploadedAssets.map((asset) => asset.objectKey);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset-restore:${fence.sessionId}`}, 0))`;
  for (const assetId of [...assetIds].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
  }
  const [restoreSession, stagedRows, deletionJobs] = await Promise.all([
    tx.binaryAssetRestoreSession.findFirst({
      select: { id: true },
      where: {
        attempt: fence.attempt,
        attemptToken: fence.attemptToken,
        id: fence.sessionId,
        leaseExpiresAt: { gt: readyAt },
        ownerId,
      },
    }),
    tx.storedAsset.findMany({
      select: {
        checksumSha256: true,
        declaredMimeType: true,
        expectedSizeBytes: true,
        id: true,
        objectKey: true,
        originalName: true,
        ownerId: true,
        projectId: true,
        purpose: true,
        restoreAttempt: true,
        restoreSessionId: true,
        status: true,
      },
      where: {
        ownerId,
        restoreAttempt: fence.attempt,
        restoreSessionId: fence.sessionId,
        status: "PENDING",
      },
    }),
    tx.objectDeletionJob.findMany({
      select: { objectKey: true },
      where: { objectKey: { in: objectKeys } },
    }),
  ]);

  const stagedById = new Map(stagedRows.map((row) => [row.id, row]));
  const jobKeys = new Set(deletionJobs.map((job) => job.objectKey));
  if (
    !restoreSession ||
    stagedRows.length !== uploadedAssets.length ||
    deletionJobs.length !== uploadedAssets.length
  ) {
    throwFinalizeFailure();
  }

  for (const uploaded of uploadedAssets) {
    const descriptor = uploaded.descriptor;
    const staged = stagedById.get(uploaded.assetId);
    if (
      !staged ||
      staged.ownerId !== ownerId ||
      staged.projectId !== null ||
      staged.status !== "PENDING" ||
      staged.objectKey !== uploaded.objectKey ||
      staged.purpose !== descriptor.purpose ||
      staged.declaredMimeType !== descriptor.mimeType ||
      staged.expectedSizeBytes !== descriptor.sizeBytes ||
      staged.checksumSha256 !== descriptor.checksumSha256 ||
      staged.originalName !== descriptor.originalName ||
      staged.restoreAttempt !== fence.attempt ||
      staged.restoreSessionId !== fence.sessionId ||
      !jobKeys.has(uploaded.objectKey) ||
      uploaded.storedObject.contentLength !== descriptor.sizeBytes ||
      uploaded.storedObject.contentType !== descriptor.mimeType ||
      uploaded.storedObject.checksumSha256 !== descriptor.checksumSha256
    ) {
      throwFinalizeFailure();
    }

    const target = resolveTarget(descriptor.binding, targets);
    const promoted = await tx.storedAsset.updateMany({
      data: {
        detectedMimeType: descriptor.mimeType,
        etag: uploaded.storedObject.etag,
        projectId: target.projectId,
        readyAt,
        restoreAttempt: null,
        restoreSessionId: null,
        sizeBytes: descriptor.sizeBytes,
        status: "READY",
        uploadExpiresAt: null,
        validationStartedAt: null,
      },
      where: {
        id: uploaded.assetId,
        messageAttachment: null,
        objectKey: uploaded.objectKey,
        ownerId,
        restoreAttempt: fence.attempt,
        restoreSessionId: fence.sessionId,
        sourceDocument: null,
        status: "PENDING",
      },
    });
    if (promoted.count !== 1) throwFinalizeFailure();

    if (descriptor.binding.kind === "message_attachment") {
      await tx.messageAttachment.create({
        data: {
          assetId: uploaded.assetId,
          messageId: target.targetId,
          ordinal: descriptor.binding.ordinal,
        },
      });
    } else {
      const linked = await tx.projectDocument.updateMany({
        data: { sourceAssetId: uploaded.assetId },
        where: {
          id: target.targetId,
          projectId: target.projectId!,
          sourceAssetId: null,
        },
      });
      if (linked.count !== 1) throwFinalizeFailure();
    }

    const released = await tx.objectDeletionJob.deleteMany({
      where: { objectKey: uploaded.objectKey },
    });
    if (released.count !== 1) throwFinalizeFailure();
  }

  const completed = await tx.binaryAssetRestoreSession.deleteMany({
    where: {
      attempt: fence.attempt,
      attemptToken: fence.attemptToken,
      id: fence.sessionId,
      leaseExpiresAt: { gt: readyAt },
      ownerId,
    },
  });
  if (completed.count !== 1) throwFinalizeFailure();
}

function resolveTarget(
  binding: UploadedPortableBinaryAsset["descriptor"]["binding"],
  targets: BinaryAssetFinalizeTargets
) {
  if (binding.kind === "message_attachment") {
    const target = targets.messagesBySourceId.get(binding.sourceMessageId);
    if (!target) throwFinalizeFailure();
    return { projectId: target.projectId, targetId: target.messageId };
  }

  const target = targets.documentsBySourceId.get(binding.sourceDocumentId);
  if (!target) throwFinalizeFailure();
  return { projectId: target.projectId, targetId: target.documentId };
}

function assertUniqueRestorePlan(
  assets: readonly UploadedPortableBinaryAsset[]
) {
  const assetIds = new Set<string>();
  const objectKeys = new Set<string>();
  const sourceAssetIds = new Set<string>();
  const bindings = new Set<string>();
  const fence = assets[0]?.fence;
  if (
    !fence ||
    !Number.isSafeInteger(fence.attempt) ||
    fence.attempt < 1 ||
    !fence.attemptToken ||
    !fence.sessionId
  ) {
    throwFinalizeFailure();
  }

  for (const asset of assets) {
    const binding = asset.descriptor.binding;
    const bindingKey =
      binding.kind === "message_attachment"
        ? `message:${binding.sourceMessageId}:${binding.ordinal}`
        : `document:${binding.sourceDocumentId}`;
    if (
      assetIds.has(asset.assetId) ||
      objectKeys.has(asset.objectKey) ||
      sourceAssetIds.has(asset.descriptor.sourceAssetId) ||
      bindings.has(bindingKey) ||
      asset.fence.attempt !== fence.attempt ||
      asset.fence.attemptToken !== fence.attemptToken ||
      asset.fence.sessionId !== fence.sessionId
    ) {
      throwFinalizeFailure();
    }
    assetIds.add(asset.assetId);
    objectKeys.add(asset.objectKey);
    sourceAssetIds.add(asset.descriptor.sourceAssetId);
    bindings.add(bindingKey);
  }
}

function sameDescriptor(
  expected: ValidatedPortableBinaryAsset,
  actual: UploadedPortableBinaryAsset["descriptor"]
) {
  const expectedBinding = expected.binding;
  const actualBinding = actual.binding;
  const sameBinding =
    expectedBinding.kind === actualBinding.kind &&
    (expectedBinding.kind === "message_attachment" &&
    actualBinding.kind === "message_attachment"
      ? expectedBinding.sourceMessageId === actualBinding.sourceMessageId &&
        expectedBinding.ordinal === actualBinding.ordinal
      : expectedBinding.kind === "project_document_source" &&
          actualBinding.kind === "project_document_source" &&
          expectedBinding.sourceDocumentId === actualBinding.sourceDocumentId);

  return (
    sameBinding &&
    expected.checksumSha256 === actual.checksumSha256 &&
    expected.file.path === actual.file.path &&
    expected.file.sha256 === actual.file.sha256 &&
    expected.file.sizeBytes === actual.file.sizeBytes &&
    expected.mimeType === actual.mimeType &&
    expected.originalName === actual.originalName &&
    expected.purpose === actual.purpose &&
    expected.sizeBytes === actual.sizeBytes &&
    expected.sourceAssetId === actual.sourceAssetId &&
    expected.sourceProjectId === actual.sourceProjectId
  );
}

function throwFinalizeFailure(): never {
  throw new AppError(
    "Private assets could not be finalized safely.",
    409,
    "ASSET_RESTORE_STATE_INVALID"
  );
}
