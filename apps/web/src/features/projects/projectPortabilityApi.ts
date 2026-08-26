import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { t } from "../../i18n/useI18n";

export interface ProjectImportPreview {
  compatible: true;
  formatVersion: "1.0" | "2.0";
  exportType: "project";
  packageDigest: string;
  suggestedProjectName: string;
  sourceProjectName: string;
  counts: {
    assetBytes?: number;
    assets?: number;
    documents: number;
    chats: number;
    messages: number;
  };
  warnings: string[];
  unsupported: string[];
}

export interface ProjectImportCommitResult {
  projectId: string;
  projectName: string;
  imported: {
    assets?: number;
    documents: number;
    chats: number;
    messages: number;
  };
  warnings: string[];
}

export async function exportProjectZip(
  projectId: string,
  options: {
    includeChats?: boolean;
  } = {}
) {
  const includeChats = options.includeChats ?? true;
  const response = await request(
    `/api/portability/projects/${encodeURIComponent(projectId)}/export?includeChats=${includeChats}`,
    {
      credentials: "include",
      method: "POST",
    },
    t("projects.portability.errors.export"),
    true
  );

  return response.blob();
}

export async function previewProjectImport(file: File): Promise<ProjectImportPreview> {
  const response = await request(
    "/api/portability/projects/import/preview",
    {
      body: file,
      credentials: "include",
      headers: {
        "Content-Type": "application/zip",
      },
      method: "POST",
    },
    t("projects.portability.errors.preview"),
    true
  );
  const payload = (await response.json()) as Partial<ProjectImportPreview>;

  if (
    payload.compatible !== true ||
    !isProjectFormatVersion(payload.formatVersion) ||
    payload.exportType !== "project" ||
    !isDigest(payload.packageDigest) ||
    typeof payload.suggestedProjectName !== "string" ||
    typeof payload.sourceProjectName !== "string" ||
    !isPreviewCounts(payload.formatVersion, payload.counts) ||
    !isStringArray(payload.warnings) ||
    !isStringArray(payload.unsupported)
  ) {
    throw new Error(t("projects.portability.errors.previewResponse"));
  }

  return payload as ProjectImportPreview;
}

export async function commitProjectImport(
  file: File,
  packageDigest: string
): Promise<ProjectImportCommitResult> {
  const response = await request(
    "/api/portability/projects/import/commit",
    {
      body: file,
      credentials: "include",
      headers: {
        "Content-Type": "application/zip",
        "X-Package-Digest": packageDigest,
      },
      method: "POST",
    },
    t("projects.portability.errors.commit"),
    true
  );
  const payload = (await response.json()) as Partial<ProjectImportCommitResult>;

  if (
    typeof payload.projectId !== "string" ||
    typeof payload.projectName !== "string" ||
    !isImportCounts(payload.imported) ||
    !isStringArray(payload.warnings)
  ) {
    throw new Error(t("projects.portability.errors.commitResponse"));
  }

  return payload as ProjectImportCommitResult;
}

async function request(
  path: string,
  init: RequestInit,
  fallback: string,
  requiresCsrf = false
) {
  try {
    const response = requiresCsrf
      ? await csrfFetch(`${API_BASE_URL}${path}`, init)
      : await fetch(`${API_BASE_URL}${path}`, init);

    if (!response.ok) {
      throw await createBackendApiError(response, fallback);
    }

    return response;
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.message === "Failed to fetch")
    ) {
      throw new Error(t("projects.errors.connectBackend"));
    }

    if (error instanceof Error) throw error;

    throw new Error(fallback);
  }
}

function isImportCounts(
  value: unknown
): value is {
  assetBytes?: number;
  assets?: number;
  documents: number;
  chats: number;
  messages: number;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const counts = value as Record<string, unknown>;

  const hasRequiredCounts = ["documents", "chats", "messages"].every(
    (key) => isNonNegativeInteger(counts[key])
  );
  const hasValidOptionalCounts = ["assets", "assetBytes"].every(
    (key) => counts[key] === undefined || isNonNegativeInteger(counts[key])
  );

  return hasRequiredCounts && hasValidOptionalCounts;
}

function isProjectFormatVersion(value: unknown): value is "1.0" | "2.0" {
  return value === "1.0" || value === "2.0";
}

function isPreviewCounts(
  formatVersion: "1.0" | "2.0",
  value: unknown
) {
  if (!isImportCounts(value)) return false;

  if (formatVersion === "2.0") {
    return (
      isNonNegativeInteger(value.assets) &&
      isNonNegativeInteger(value.assetBytes)
    );
  }

  return value.assets === undefined && value.assetBytes === undefined;
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
