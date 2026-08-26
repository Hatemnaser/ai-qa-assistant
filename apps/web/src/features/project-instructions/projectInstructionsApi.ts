import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { t } from "../../i18n/useI18n";
import type { ProjectInstruction } from "./types";

export async function fetchProjectInstruction(projectId: string): Promise<ProjectInstruction | null> {
  const payload = await requestProjectInstruction(`/api/projects/${encodeURIComponent(projectId)}/instructions`, {
    method: "GET",
  });

  return payload.instruction || null;
}

export async function saveProjectInstruction(
  projectId: string,
  content: string
): Promise<ProjectInstruction | null> {
  const payload = await requestProjectInstruction(`/api/projects/${encodeURIComponent(projectId)}/instructions`, {
    body: {
      content,
    },
    method: "PUT",
  });

  return payload.instruction || null;
}

async function requestProjectInstruction(
  path: string,
  options: { body?: { content: string }; method: "GET" | "PUT" }
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
      throw await createBackendApiError(response, t("projects.instructions.errors.load"));
    }

    return (await response.json()) as { instruction?: ProjectInstruction | null };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(t("projects.errors.connectBackend"));
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(t("projects.instructions.errors.load"));
  }
}
