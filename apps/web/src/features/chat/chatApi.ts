import type { ChatApiResponse, ChatHistoryItem, RequestImage } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || "";
const REQUEST_TIMEOUT_MS = 60000;

export async function sendMessageToAI(input: {
  message: string;
  mode: string;
  model: string;
  history: ChatHistoryItem[];
  image?: RequestImage | null;
}): Promise<ChatApiResponse> {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      body: JSON.stringify(input),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(await getBackendError(response));
    }

    return response.json();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The backend took too long to respond. Please try again.");
    }

    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      const target = API_BASE_URL || "the Vite /api proxy";

      throw new Error(
        `Could not connect to the backend through ${target}. Make sure the API server is running on http://127.0.0.1:5000.`
      );
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Could not connect to the backend.");
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function getBackendError(response: Response) {
  const fallback = "Failed to get response from backend.";
  const text = await response.text();

  if (!text) return fallback;

  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error || parsed.message || fallback;
  } catch (error) {
    return text;
  }
}
