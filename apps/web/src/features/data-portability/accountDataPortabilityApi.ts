import {
  BackendApiError,
  createBackendApiError,
} from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { t } from "../../i18n/useI18n";

export type AccountImportKind = "account_archive" | "chat_archive";

export interface AccountImportCounts {
  projects: number;
  documents: number;
  chats: number;
  messages: number;
  accountMemories: number;
  binaryAssets?: number;
}

export interface AccountImportPreview {
  compatible: true;
  importKind: AccountImportKind;
  packageDigest: string;
  counts: AccountImportCounts;
  warnings: string[];
}

export interface AccountImportCommitResult {
  importKind: AccountImportKind;
  imported: AccountImportCounts;
  skipped: {
    accountMemories: number;
  };
  warnings: string[];
}

export async function exportAccountDataZip() {
  const response = await request(
    "/api/portability/account/export",
    {
      credentials: "include",
      method: "POST",
    },
    t("portability.errors.export"),
    true
  );

  return response.blob();
}

export async function previewAccountImport(
  file: File
): Promise<AccountImportPreview> {
  const response = await request(
    "/api/portability/account/import/preview",
    {
      body: file,
      credentials: "include",
      headers: {
        "Content-Type": "application/zip",
      },
      method: "POST",
    },
    t("portability.errors.preview"),
    true
  );
  const payload = (await response.json()) as Partial<AccountImportPreview>;

  if (
    payload.compatible !== true ||
    !isImportKind(payload.importKind) ||
    !isDigest(payload.packageDigest) ||
    !isImportCounts(payload.counts) ||
    !isStringArray(payload.warnings)
  ) {
    throw new Error(t("portability.errors.previewResponse"));
  }

  return payload as AccountImportPreview;
}

export async function commitAccountImport(
  file: File,
  packageDigest: string
): Promise<AccountImportCommitResult> {
  const response = await request(
    "/api/portability/account/import/commit",
    {
      body: file,
      credentials: "include",
      headers: {
        "Content-Type": "application/zip",
        "X-Package-Digest": packageDigest,
      },
      method: "POST",
    },
    t("portability.errors.commit"),
    true
  );
  const payload = (await response.json()) as Partial<AccountImportCommitResult>;

  if (
    !isImportKind(payload.importKind) ||
    !isImportCounts(payload.imported) ||
    !isSkippedCounts(payload.skipped) ||
    !isStringArray(payload.warnings)
  ) {
    throw new Error(t("portability.errors.commitResponse"));
  }

  return payload as AccountImportCommitResult;
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

    if (error instanceof BackendApiError) {
      if (error.code === "ACCOUNT_IMPORT_PROJECT_ARCHIVE_UNSUPPORTED") {
        throw new Error(t("portability.errors.projectArchive"));
      }

      if (
        error.code === "ACCOUNT_IMPORT_PACKAGE_INVALID" ||
        error.code === "EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID"
      ) {
        throw new Error(t("portability.errors.invalidPackage"));
      }

      if (error.code === "ACCOUNT_IMPORT_DIGEST_MISMATCH") {
        throw new Error(t("portability.errors.changedFile"));
      }
    }

    if (error instanceof Error) throw error;

    throw new Error(fallback);
  }
}

function isImportCounts(value: unknown): value is AccountImportCounts {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const counts = value as Record<string, unknown>;

  return [
    "projects",
    "documents",
    "chats",
    "messages",
    "accountMemories",
  ].every(
    (key) =>
      typeof counts[key] === "number" &&
      Number.isInteger(counts[key]) &&
      (counts[key] as number) >= 0
  ) &&
    (counts.binaryAssets === undefined ||
      (typeof counts.binaryAssets === "number" &&
        Number.isInteger(counts.binaryAssets) &&
        counts.binaryAssets >= 0));
}

function isSkippedCounts(
  value: unknown
): value is { accountMemories: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const count = (value as Record<string, unknown>).accountMemories;
  return typeof count === "number" && Number.isInteger(count) && count >= 0;
}

function isImportKind(value: unknown): value is AccountImportKind {
  return value === "account_archive" || value === "chat_archive";
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
