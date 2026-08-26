import {
  cancelAssetBestEffort,
  completeAsset,
  initiateAsset,
  uploadAssetBytes,
} from "./assetsApi";
import type { AssetPurpose, InitiateAssetResponse, UploadedAsset } from "./types";

export interface PrivateAssetUploadOptions {
  declaredMimeType?: string;
  projectId?: string | null;
  purpose: AssetPurpose;
}

export interface PrivateAssetUploaderDependencies {
  cancel: (assetId: string) => Promise<void>;
  complete: (assetId: string, checksumSha256: string) => Promise<UploadedAsset["asset"]>;
  digest: (file: Blob) => Promise<string>;
  initiate: (input: {
    checksumSha256: string;
    declaredMimeType: string;
    expectedSizeBytes: number;
    originalName: string;
    projectId: string | null;
    purpose: AssetPurpose;
  }) => Promise<InitiateAssetResponse>;
  put: (upload: InitiateAssetResponse["upload"], file: File) => Promise<void>;
}

const defaultDependencies: PrivateAssetUploaderDependencies = {
  cancel: cancelAssetBestEffort,
  complete: completeAsset,
  digest: sha256Base64,
  initiate: initiateAsset,
  put: uploadAssetBytes,
};

export async function uploadPrivateAsset(
  file: File,
  options: PrivateAssetUploadOptions,
  dependencies: PrivateAssetUploaderDependencies = defaultDependencies
): Promise<UploadedAsset> {
  const checksumSha256 = await dependencies.digest(file);
  let assetId: string | null = null;

  try {
    const initiated = await dependencies.initiate({
      checksumSha256,
      declaredMimeType: options.declaredMimeType || file.type,
      expectedSizeBytes: file.size,
      originalName: file.name,
      projectId: options.projectId || null,
      purpose: options.purpose,
    });
    assetId = initiated.asset.id;
    await dependencies.put(initiated.upload, file);
    const asset = await dependencies.complete(assetId, checksumSha256);

    return { asset, checksumSha256 };
  } catch (error) {
    if (assetId) {
      try {
        await dependencies.cancel(assetId);
      } catch {
        // Preserve the upload failure; stale pending assets are cleaned up server-side.
      }
    }

    throw error;
  }
}

export async function sha256Base64(blob: Blob): Promise<string> {
  const bytes = await blob.arrayBuffer();
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes));
  let binary = "";

  for (const byte of digest) {
    binary += String.fromCharCode(byte);
  }

  return globalThis.btoa(binary);
}
