import { createBackendApiError } from "../../api/backendErrors";
import type { UserSettings, UserSettingsInput } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

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
      throw await createBackendApiError(response, "Could not load settings.");
    }

    const payload = (await response.json()) as { settings?: UserSettings };

    if (!payload.settings) {
      throw new Error("Settings response was missing settings data.");
    }

    return payload.settings;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(
        "Could not connect to the backend. Make sure the API server is running on http://127.0.0.1:5000."
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Could not load settings.");
  }
}
