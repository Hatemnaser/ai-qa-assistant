export type AssetPurpose = "CHAT_ATTACHMENT" | "PROJECT_DOCUMENT_SOURCE";
export type AssetStatus = "DELETE_PENDING" | "FAILED" | "PENDING" | "READY" | "VALIDATING";

export interface AssetRecord {
  id: string;
  ownerId: string;
  projectId: string | null;
  objectKey: string;
  purpose: AssetPurpose;
  status: AssetStatus;
  originalName: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  expectedSizeBytes: number;
  checksumSha256: string;
  sizeBytes: number | null;
  etag: string | null;
  uploadExpiresAt: Date | null;
  validationStartedAt: Date | null;
  readyAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreatePendingAssetInput extends InitiateAssetInput {
  maxPendingPerUser: number;
  objectKey: string;
  ownerId: string;
  uploadExpiresAt: Date;
  userQuotaBytes: number;
}

export interface InitiateAssetInput {
  checksumSha256: string;
  declaredMimeType: string;
  expectedSizeBytes: number;
  originalName: string;
  projectId: string | null;
  purpose: AssetPurpose;
}

export interface CompleteAssetInput {
  checksumSha256: string;
}

export interface StoredObjectMetadata {
  checksumSha256: string | null;
  contentLength: number;
  contentType: string | null;
  etag: string | null;
}

export interface StoredObjectSample {
  bytes: Uint8Array;
  metadata: StoredObjectMetadata;
}

export interface ImmutableStoredObjectInput {
  bytes: Uint8Array;
  checksumSha256: string;
  contentType: string;
  maximumBytes: number;
  objectKey: string;
}

export interface PresignedUploadRequest {
  checksumSha256: string;
  contentLength: number;
  contentType: string;
  expiresInSeconds: number;
  objectKey: string;
}

export interface CompleteAssetRecordInput {
  assetId: string;
  detectedMimeType: string;
  etag: string | null;
  ownerId: string;
  readyAt: Date;
  sizeBytes: number;
}

export interface CleanupAssetRecord {
  id: string;
  objectKey: string;
  status: AssetRecord["status"];
  uploadExpiresAt: Date | null;
}

export interface DeletionJobRecord {
  attempts: number;
  id: string;
  leaseUntil: Date;
  objectKey: string;
}

export interface ClaimedCleanupBatch {
  cleanupQueued: number;
  cleanupCandidatesMayRemain: boolean;
  deletionBacklog: number | null;
  dueDeletionBacklog: number | null;
  jobs: DeletionJobRecord[];
  lockAcquired: boolean;
}

export interface AssetsRepository {
  cancelPendingAsset(ownerId: string, assetId: string, now: Date): Promise<string | null>;
  claimPendingAssetForValidation(ownerId: string, assetId: string, now: Date): Promise<AssetRecord | null>;
  completeValidatingAsset(input: CompleteAssetRecordInput): Promise<AssetRecord | null>;
  createPendingAssetReservation(input: CreatePendingAssetInput): Promise<AssetRecord>;
  enqueueAssetDeletion(ownerId: string, assetId: string): Promise<string | null>;
  failValidatingAsset(ownerId: string, assetId: string, now: Date): Promise<string | null>;
  findOwnedAsset(ownerId: string, assetId: string): Promise<AssetRecord | null>;
  claimCleanupBatch(now: Date, leaseUntil: Date, limit: number): Promise<ClaimedCleanupBatch>;
  markAssetFailed(ownerId: string, assetId: string): Promise<void>;
  releaseValidationClaim(ownerId: string, assetId: string): Promise<void>;
  recordDeletionFailure(
    jobId: string,
    objectKey: string,
    leaseUntil: Date,
    attempts: number,
    nextAttemptAt: Date,
    lastError: string
  ): Promise<boolean>;
  removeDeletedObject(jobId: string, objectKey: string, leaseUntil: Date): Promise<boolean>;
  renewDeletionClaim(
    jobId: string,
    objectKey: string,
    currentLeaseUntil: Date,
    renewedLeaseUntil: Date
  ): Promise<boolean>;
}
