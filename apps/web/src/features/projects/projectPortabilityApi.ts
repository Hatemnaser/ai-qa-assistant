import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { t } from "../../i18n/useI18n";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export interface ProjectImportPreview {
  compatible: boolean;
  formatVersion: "1.0";
  exportType: "project";
  packageDigest: string;
  suggestedProjectName: string;
  sourceProjectName: string;
  counts: {
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
      method: "GET",
    },
    t("projects.portability.errors.export")
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
    payload.formatVersion !== "1.0" ||
    payload.exportType !== "project" ||
    typeof payload.packageDigest !== "string" ||
    typeof payload.suggestedProjectName !== "string" ||
    typeof payload.sourceProjectName !== "string" ||
    !isImportCounts(payload.counts) ||
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
): value is { documents: number; chats: number; messages: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const counts = value as Record<string, unknown>;

  return ["documents", "chats", "messages"].every(
    (key) => typeof counts[key] === "number" && Number.isInteger(counts[key])
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
