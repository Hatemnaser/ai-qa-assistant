import { createBackendApiError } from "../../api/backendErrors";
import type { UsageSummary } from "./types";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export async function fetchUsageSummary(): Promise<UsageSummary> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/usage/summary`, {
      credentials: "include",
      method: "GET",
    });

    if (!response.ok) {
      throw await createBackendApiError(response, "Could not load usage summary.");
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

    throw new Error("Could not load usage summary.");
  }
}
