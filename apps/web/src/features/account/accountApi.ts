import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { t } from "../../i18n/useI18n";

export async function deleteCurrentAccount(currentPassword: string): Promise<{ ok: true }> {
  try {
    const response = await csrfFetch(`${API_BASE_URL}/api/account`, {
      body: JSON.stringify({ currentPassword }),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "DELETE",
    });

    if (!response.ok) {
      throw await createBackendApiError(response, t("settings.deleteAccountError"));
    }

    return response.json();
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error(t("errors.connectBackend"));
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error(t("settings.deleteAccountError"));
  }
}
