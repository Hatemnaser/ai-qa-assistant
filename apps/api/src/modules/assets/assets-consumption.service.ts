import { createHash } from "node:crypto";

import { env } from "../../config/env.js";
import { AppError } from "../../lib/errors.js";
import { assetsRepository } from "./assets.repository.js";
import { assetStorage, type AssetStorage } from "./assets.storage.js";
import type { AssetPurpose, AssetRecord, AssetsRepository } from "./assets.types.js";

export interface ReadyAsset extends AssetRecord {
  detectedMimeType: string;
  readyAt: Date;
  sizeBytes: number;
  status: "READY";
}

export interface ReadReadyAsset {
  asset: ReadyAsset;
  bytes: Uint8Array;
}

export interface AssetConsumptionService {
  getReadyOwnedAsset(input: {
    assetId: string;
    ownerId: string;
    projectId: string | null;
    purpose: AssetPurpose;
  }): Promise<ReadyAsset>;
  readReadyOwnedAsset(input: {
    assetId: string;
    ownerId: string;
    projectId: string | null;
    purpose: AssetPurpose;
  }): Promise<ReadReadyAsset>;
}

export function createAssetConsumptionService({
  enabled,
  repository,
  storage,
}: {
  enabled: () => boolean;
  repository: AssetsRepository;
  storage: AssetStorage;
}): AssetConsumptionService {
  async function getReadyOwnedAsset(input: {
    assetId: string;
    ownerId: string;
    projectId: string | null;
    purpose: AssetPurpose;
  }): Promise<ReadyAsset> {
    assertEnabled();
    const asset = await repository.findOwnedAsset(input.ownerId, input.assetId);

    // Deliberately collapse ownership, lifecycle, purpose, and project failures
    // into one response so opaque asset ids cannot become an authorization
    // oracle.
    if (
      !asset ||
      asset.status !== "READY" ||
      asset.purpose !== input.purpose ||
      asset.projectId !== input.projectId ||
      !asset.detectedMimeType ||
      !asset.readyAt ||
      asset.sizeBytes === null ||
      asset.sizeBytes < 1
    ) {
      throw new AppError("Asset was not found.", 404, "ASSET_NOT_FOUND");
    }

    return asset as ReadyAsset;
  }

  async function readReadyOwnedAsset(input: {
    assetId: string;
    ownerId: string;
    projectId: string | null;
    purpose: AssetPurpose;
  }): Promise<ReadReadyAsset> {
    const asset = await getReadyOwnedAsset(input);

    try {
      const object = await storage.readObject(asset.objectKey, asset.sizeBytes);
      const checksum = createHash("sha256")
        .update(object.bytes)
        .digest("base64");

      if (
        object.bytes.byteLength !== asset.sizeBytes ||
        object.metadata.contentLength !== asset.sizeBytes ||
        object.metadata.contentType !== asset.detectedMimeType ||
        (object.metadata.checksumSha256 !== null &&
          object.metadata.checksumSha256 !== asset.checksumSha256) ||
        checksum !== asset.checksumSha256
      ) {
        throw new Error("Stored object did not match its validated metadata.");
      }

      return { asset, bytes: object.bytes };
    } catch {
      throw new AppError(
        "Private attachment content is temporarily unavailable.",
        503,
        "ASSET_READ_UNAVAILABLE"
      );
    }
  }

  function assertEnabled() {
    if (!enabled()) {
      throw new AppError(
        "Private asset storage is unavailable.",
        503,
        "ASSET_STORAGE_DISABLED"
      );
    }
  }

  return {
    getReadyOwnedAsset,
    readReadyOwnedAsset,
  };
}

export const assetConsumptionService = createAssetConsumptionService({
  enabled: () => env.privateAssetsEnabled,
  repository: assetsRepository,
  storage: assetStorage,
});
