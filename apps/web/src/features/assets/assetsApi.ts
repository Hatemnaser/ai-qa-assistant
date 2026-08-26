import { BackendApiError, createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import type {
  AssetDownloadResponse,
  AssetDto,
  InitiateAssetInput,
  InitiateAssetResponse,
} from "./types";

const DOWNLOAD_CACHE_SAFETY_WINDOW_MS = 30_000;
const downloadUrlCache = new Map<string, AssetDownloadResponse["download"]>();

export async function initiateAsset(input: InitiateAssetInput): Promise<InitiateAssetResponse> {
  return requestJson<InitiateAssetResponse>("/api/assets/initiate", {
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json" },
    method: "POST",
  }, "Could not start the private upload.");
}

export async function completeAsset(assetId: string, checksumSha256: string): Promise<AssetDto> {
  const response = await requestJson<{ asset: AssetDto }>(
    `/api/assets/${encodeURIComponent(assetId)}/complete`,
    {
      body: JSON.stringify({ checksumSha256 }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    },
    "Could not validate the private upload."
  );

  return response.asset;
}

export async function uploadAssetBytes(
  upload: InitiateAssetResponse["upload"],
  file: File
): Promise<void> {
  const response = await fetch(assertHttpUrl(upload.url), {
    body: file,
    headers: upload.headers,
    method: upload.method,
  });

  if (!response.ok) {
    throw new Error(`Private upload failed (${response.status}).`);
  }
}

export async function cancelAsset(assetId: string): Promise<void> {
  await requestJson<{ ok: true }>(
    `/api/assets/${encodeURIComponent(assetId)}`,
    { method: "DELETE" },
    "Could not cancel the private upload."
  );
}

export async function cancelAssetBestEffort(assetId: string): Promise<void> {
  try {
    await cancelAsset(assetId);
  } catch {
    // Cleanup is also handled by the server's stale-upload worker.
  }
}

export async function getAssetDownloadUrl(
  assetId: string,
  options: { forceRefresh?: boolean } = {}
): Promise<string> {
  const cached = downloadUrlCache.get(assetId);

  if (!options.forceRefresh && cached && isDownloadUrlFresh(cached.expiresAt)) {
    return cached.url;
  }

  const response = await requestJson<AssetDownloadResponse>(
    `/api/assets/${encodeURIComponent(assetId)}/download`,
    { method: "GET" },
    "Could not open this private attachment."
  );
  response.download.url = assertHttpUrl(response.download.url);
  downloadUrlCache.set(assetId, response.download);

  return response.download.url;
}

function assertHttpUrl(value: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("The private asset URL was invalid.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("The private asset URL used an unsupported protocol.");
  }

  return url.toString();
}

export function clearAssetDownloadUrlCache() {
  downloadUrlCache.clear();
}

export function isPrivateAssetStorageDisabled(error: unknown) {
  return error instanceof BackendApiError && error.code === "ASSET_STORAGE_DISABLED";
}

function isDownloadUrlFresh(expiresAt: string) {
  const expiry = Date.parse(expiresAt);

  return Number.isFinite(expiry) && expiry - Date.now() > DOWNLOAD_CACHE_SAFETY_WINDOW_MS;
}

async function requestJson<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  const response = await csrfFetch(`${API_BASE_URL}${path}`, {
    credentials: "include",
    ...init,
  });

  if (!response.ok) {
    throw await createBackendApiError(response, fallback);
  }

  return response.json() as Promise<T>;
}
