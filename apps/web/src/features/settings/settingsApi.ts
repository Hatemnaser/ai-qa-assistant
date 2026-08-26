import { BackendApiError, createBackendApiError } from "../../api/backendErrors";
import { ApiAdapterError, isFetchNetworkError } from "../../api/apiAdapterError";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import type { UserSettings, UserSettingsInput } from "./types";

export async function fetchUserSettings(): Promise<UserSettings> {
  return requestSettings("/api/settings", {
    method: "GET",
  });
}

export async function updateUserSettings(input: UserSettingsInput): Promise<UserSettings> {
  return requestSettings("/api/settings", {
    body: input,
    method: "PUT",
  });
}

async function requestSettings(path: string, options: { body?: unknown; method: "GET" | "PUT" }) {
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

    const payload = (await response.json()) as { settings?: UserSettings };

    if (!payload.settings) {
      throw new ApiAdapterError("INVALID_RESPONSE");
    }

    return payload.settings;
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
