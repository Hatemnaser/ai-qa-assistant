import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { t } from "../../i18n/useI18n";
import type {
  ProjectDocument,
  ProjectDocumentImportFileInput,
  ProjectDocumentInput,
} from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchProjectDocuments(projectId: string): Promise<ProjectDocument[]> {
  return requestProjectDocumentList(`/api/projects/${encodeURIComponent(projectId)}/documents`);
}

export async function createProjectDocument(
  projectId: string,
  input: ProjectDocumentInput
): Promise<ProjectDocument> {
  return requestProjectDocument(`/api/projects/${encodeURIComponent(projectId)}/documents`, {
    body: input,
    method: "POST",
  });
}

export async function importProjectDocuments(
  projectId: string,
  files: ProjectDocumentImportFileInput[]
): Promise<ProjectDocument[]> {
  return requestProjectDocumentList(`/api/projects/${encodeURIComponent(projectId)}/documents/import`, {
    body: {
      files,
    },
    method: "POST",
  });
}

export async function updateProjectDocument(
  projectId: string,
  documentId: string,
  input: ProjectDocumentInput
): Promise<ProjectDocument> {
  return requestProjectDocument(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    {
      body: input,
      method: "PUT",
    }
  );
}

export async function deleteProjectDocument(projectId: string, documentId: string): Promise<void> {
  await requestProjectDocumentAction(
    `/api/projects/${encodeURIComponent(projectId)}/documents/${encodeURIComponent(documentId)}`,
    {
      method: "DELETE",
    }
  );
}

async function requestProjectDocumentList(
  path: string,
  options: { body?: unknown; method: "GET" | "POST" } = { method: "GET" }
) {
  const payload = await requestProjectDocumentAction(path, options);

  return payload.documents || [];
}

async function requestProjectDocument(path: string, options: { body: ProjectDocumentInput; method: "POST" | "PUT" }) {
  const payload = await requestProjectDocumentAction(path, options);

  if (!payload.document) {
    throw new Error(t("projects.documents.errors.responseMissing"));
  }

  return payload.document;
}

async function requestProjectDocumentAction(
  path: string,
  options: { body?: unknown; method: "DELETE" | "GET" | "POST" | "PUT" }
) {
  try {
    const response = await csrfFetch(`${API_BASE_URL}${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      credentials: "include",
      headers: options.body
        ? {
            "Content-Type": "application/json",
          }
        : undefined,
      method: options.method,
    });

    if (!response.ok) {
      throw await createBackendApiError(response, t("projects.documents.errors.load"));
    }

    return (await response.json()) as { document?: ProjectDocument; documents?: ProjectDocument[]; ok?: boolean };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(t("projects.errors.connectBackend"));
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(t("projects.documents.errors.load"));
  }
}
