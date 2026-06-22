import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import type { ProjectInstruction } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

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
      throw await createBackendApiError(response, "Could not load project instructions.");
    }

    return (await response.json()) as { instruction?: ProjectInstruction | null };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(
        "Could not connect to the backend. Make sure the API server is running on http://127.0.0.1:5000."
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Could not load project instructions.");
  }
}
