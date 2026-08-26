import { BackendApiError, createBackendApiError } from "../../api/backendErrors";
import { ApiAdapterError, isFetchNetworkError } from "../../api/apiAdapterError";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import type { Memory, MemoryInput } from "./types";

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

async function requestMemoryList(path: string) {
  const payload = await requestMemoryAction(path, {
    method: "GET",
  });

  return payload.memories || [];
}

async function requestMemory(path: string, options: { body: MemoryInput; method: "POST" | "PUT" }) {
  const payload = await requestMemoryAction(path, options);

  if (!payload.memory) {
    throw new ApiAdapterError("INVALID_RESPONSE");
  }

  return payload.memory;
}

async function requestMemoryAction(
  path: string,
  options: { body?: MemoryInput; method: "DELETE" | "GET" | "POST" | "PUT" }
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
      const backendError = await createBackendApiError(response, "");

      if (!backendError.message) {
        throw new ApiAdapterError("REQUEST_FAILED", { status: response.status });
      }

      throw backendError;
    }

    return (await response.json()) as { memories?: Memory[]; memory?: Memory; ok?: boolean };
  } catch (error) {
    if (isFetchNetworkError(error)) {
      throw new ApiAdapterError("NETWORK_UNAVAILABLE");
    }

    if (error instanceof ApiAdapterError || error instanceof BackendApiError) {
      throw error;
    }

    throw new ApiAdapterError("REQUEST_FAILED");
  }
}
