import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import type { Project, ProjectInput } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchProjects(): Promise<Project[]> {
  return requestProjects("/api/projects", {
    method: "GET",
  });
}

export async function createProject(input: ProjectInput): Promise<Project> {
  return requestProject("/api/projects", {
    body: input,
    fallback: "Could not create this project.",
    method: "POST",
  });
}

export async function updateProject(projectId: string, input: ProjectInput): Promise<Project> {
  return requestProject(`/api/projects/${encodeURIComponent(projectId)}`, {
    body: input,
    fallback: "Could not update this project.",
    method: "PUT",
  });
}

export async function deleteProject(projectId: string) {
  await requestProject(`/api/projects/${encodeURIComponent(projectId)}`, {
    fallback: "Could not delete this project.",
    method: "DELETE",
  });
}

async function requestProjects(path: string, options: { method: "GET" }): Promise<Project[]> {
  const body = await requestJson<{ projects?: Project[] }>(path, {
    fallback: "Could not load projects.",
    method: options.method,
  });

  return Array.isArray(body.projects) ? body.projects : [];
}

async function requestProject(
  path: string,
  options: { body?: ProjectInput; fallback: string; method: "DELETE" | "POST" | "PUT" }
): Promise<Project> {
  const body = await requestJson<{ project?: Project }>(path, options);

  if (!body.project && options.method !== "DELETE") {
    throw new Error(options.fallback);
  }

  return body.project as Project;
}

async function requestJson<T>(
  path: string,
  options: { body?: unknown; fallback: string; method: "DELETE" | "GET" | "POST" | "PUT" }
): Promise<T> {
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
      throw await createBackendApiError(response, options.fallback);
    }

    return response.json();
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
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
