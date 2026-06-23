import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { t } from "../../i18n/useI18n";
import type { ProjectMemory } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchProjectMemory(projectId: string): Promise<ProjectMemory | null> {
  const body = await requestJson<{ memory?: ProjectMemory | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/memory`,
    {
      fallback: t("projects.memory.errors.load"),
      method: "GET",
    }
  );

  return body.memory || null;
}

export async function saveProjectMemory(
  projectId: string,
  content: string
): Promise<ProjectMemory | null> {
  const body = await requestJson<{ memory?: ProjectMemory | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/memory`,
    {
      body: { content },
      fallback: t("projects.memory.errors.save"),
      method: "PUT",
    }
  );

  return body.memory || null;
}

async function requestJson<T>(
  path: string,
  options: {
    body?: unknown;
    fallback: string;
    method: "GET" | "POST" | "PUT";
  }
): Promise<T> {
  try {
    const response = await csrfFetch(`${API_BASE_URL}${path}`, {
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "include",
      headers:
        options.body === undefined
          ? undefined
          : {
              "Content-Type": "application/json",
            },
      method: options.method,
    });

    if (!response.ok) {
      throw await createBackendApiError(response, options.fallback);
    }

    return response.json();
  } catch (error) {
    if (
      error instanceof TypeError ||
      (error instanceof Error && error.message === "Failed to fetch")
    ) {
      throw new Error(t("projects.errors.connectBackend"));
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(options.fallback);
  }
}
