import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import type { ProjectMemory } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchProjectMemory(projectId: string): Promise<ProjectMemory | null> {
  const body = await requestJson<{ memory?: ProjectMemory | null }>(
    `/api/projects/${encodeURIComponent(projectId)}/memory`,
    {
      fallback: "Could not load project memory.",
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
      fallback: "Could not save project memory.",
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
      throw new Error(
        "Could not connect to the backend. Make sure the API server is running on http://127.0.0.1:5000."
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(options.fallback);
  }
}
