export type AssetPurpose = "CHAT_ATTACHMENT" | "PROJECT_DOCUMENT_SOURCE";
export type AssetStatus = "DELETE_PENDING" | "FAILED" | "PENDING" | "READY" | "VALIDATING";

export interface AssetDto {
  createdAt: string;
  declaredMimeType: string;
  detectedMimeType: string | null;
  expectedSizeBytes: number;
  id: string;
  originalName: string;
  projectId: string | null;
  purpose: AssetPurpose;
  readyAt: string | null;
  sizeBytes: number | null;
  status: AssetStatus;
}

export interface InitiateAssetInput {
  checksumSha256: string;
  declaredMimeType: string;
  expectedSizeBytes: number;
  originalName: string;
  projectId: string | null;
  purpose: AssetPurpose;
}

export interface InitiateAssetResponse {
  asset: AssetDto;
  upload: {
    expiresAt: string;
    headers: Record<string, string>;
    method: "PUT";
    url: string;
  };
}

export interface AssetDownloadResponse {
  asset: AssetDto;
  download: {
    expiresAt: string;
    url: string;
  };
}

export interface UploadedAsset {
  asset: AssetDto;
  checksumSha256: string;
}
