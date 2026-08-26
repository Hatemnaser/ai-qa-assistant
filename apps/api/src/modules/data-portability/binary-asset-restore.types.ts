import type { StoredObjectMetadata } from "../assets/assets.types.js";
import type {
  PortableBinaryAssetDescriptor,
  ValidatedPortableBinaryAsset,
} from "./binary-assets.js";

export interface BinaryAssetRestoreReservation {
  assetId: string;
  descriptor: PortableBinaryAssetDescriptor;
  fence: BinaryAssetRestoreFence;
  objectKey: string;
}

export interface BinaryAssetRestoreFence {
  attempt: number;
  attemptToken: string;
  sessionId: string;
}

export interface UploadedPortableBinaryAsset
  extends BinaryAssetRestoreReservation {
  storedObject: StoredObjectMetadata;
}

export interface BinaryAssetRestoreRepository {
  assertAttemptActive(
    ownerId: string,
    reservations: readonly BinaryAssetRestoreReservation[],
    now: Date
  ): Promise<boolean>;
  markForCleanup(
    ownerId: string,
    reservations: readonly BinaryAssetRestoreReservation[],
    cleanupNotBefore: Date
  ): Promise<string[]>;
  stage(
    ownerId: string,
    reservations: readonly BinaryAssetRestoreReservation[],
    startedAt: Date,
    cleanupNotBefore: Date,
    userQuotaBytes: number
  ): Promise<void>;
}

export interface BinaryAssetRestoreService {
  runWithPreparedAssets<T>(
    ownerId: string,
    assets: readonly ValidatedPortableBinaryAsset[],
    commit: (
      uploadedAssets: readonly UploadedPortableBinaryAsset[]
    ) => Promise<T>
  ): Promise<T>;
}
