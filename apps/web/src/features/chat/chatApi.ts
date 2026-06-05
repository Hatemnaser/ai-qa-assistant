import type { ChatApiResponse, ChatHistoryItem, RequestAttachment } from "./types";
import { BackendApiError, createBackendApiError } from "../../api/backendErrors";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";
const REQUEST_TIMEOUT_MS = 60000;

export class ChatApiError extends BackendApiError {
  constructor(message: string, options: { code?: string; status?: number } = {}) {
    super(message, options);
    this.name = "ChatApiError";
  }
}

export async function sendMessageToAI(input: {
  message: string;
  mode: string;
  model: string;
  provider?: string;
  projectId?: string | null;
  history: ChatHistoryItem[];
  attachments?: RequestAttachment[] | null;
}): Promise<ChatApiResponse> {
  const controller = new AbortController();
  const timeoutId = globalThis.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const body = {
    history: input.history,
    message: input.message,
    mode: input.mode,
    model: input.model,
    ...(input.provider ? { provider: input.provider } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
  };

  try {
    const response = await fetch(`${API_BASE_URL}/api/chat`, {
      body: JSON.stringify(body),
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw await createChatApiError(response, "Failed to get response from backend.");
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
    globalThis.clearTimeout(timeoutId);
  }
}

async function createChatApiError(response: Response, fallback: string) {
  const error = await createBackendApiError(response, fallback);

  return new ChatApiError(error.message, {
    code: error.code,
    status: error.status,
  });
}
