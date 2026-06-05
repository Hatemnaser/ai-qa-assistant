import { createBackendApiError } from "../../api/backendErrors";
import type { Memory, MemoryInput } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchAccountMemories(): Promise<Memory[]> {
  return requestMemoryList("/api/memories");
}

export async function createAccountMemory(input: MemoryInput): Promise<Memory> {
  return requestMemory("/api/memories", {
    body: input,
    method: "POST",
  });
}

export async function updateAccountMemory(memoryId: string, input: MemoryInput): Promise<Memory> {
  return requestMemory(`/api/memories/${encodeURIComponent(memoryId)}`, {
    body: input,
    method: "PUT",
  });
}

export async function deleteAccountMemory(memoryId: string): Promise<void> {
  await requestMemoryAction(`/api/memories/${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
  });
}

export async function fetchProjectMemories(projectId: string): Promise<Memory[]> {
  return requestMemoryList(`/api/projects/${encodeURIComponent(projectId)}/memories`);
}

export async function createProjectMemory(projectId: string, input: MemoryInput): Promise<Memory> {
  return requestMemory(`/api/projects/${encodeURIComponent(projectId)}/memories`, {
    body: input,
    method: "POST",
  });
}

export async function updateProjectMemory(projectId: string, memoryId: string, input: MemoryInput): Promise<Memory> {
  return requestMemory(`/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`, {
    body: input,
    method: "PUT",
  });
}

export async function deleteProjectMemory(projectId: string, memoryId: string): Promise<void> {
  await requestMemoryAction(`/api/projects/${encodeURIComponent(projectId)}/memories/${encodeURIComponent(memoryId)}`, {
    method: "DELETE",
  });
}

async function requestMemoryList(path: string) {
  const payload = await requestMemoryAction(path, {
    method: "GET",
  });

  return payload.memories || [];
}

async function requestMemory(path: string, options: { body: MemoryInput; method: "POST" | "PUT" }) {
  const payload = await requestMemoryAction(path, options);

  if (!payload.memory) {
    throw new Error("Memory response was missing memory data.");
  }

  return payload.memory;
}

async function requestMemoryAction(
  path: string,
  options: { body?: MemoryInput; method: "DELETE" | "GET" | "POST" | "PUT" }
) {
  try {
    const response = await fetch(`${API_BASE_URL}${path}`, {
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
      throw await createBackendApiError(response, "Could not load memory.");
    }

    return (await response.json()) as { memories?: Memory[]; memory?: Memory; ok?: boolean };
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(
        "Could not connect to the backend. Make sure the API server is running on http://127.0.0.1:5000."
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Could not load memory.");
  }
}
