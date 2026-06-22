import type {
  AuthMessageResponse,
  AuthResponse,
  AuthUser,
  LoginInput,
  RegisterInput,
  VerifyEmailResponse,
} from "./types";
import { createBackendApiError, getBackendError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";

const API_BASE_URL = import.meta.env?.VITE_API_BASE_URL || "";

export function login(input: LoginInput) {
  return requestJson<AuthResponse>("/api/auth/login", {
    body: input,
    method: "POST",
  });
}

export function register(input: RegisterInput) {
  return requestJson<AuthMessageResponse>("/api/auth/register", {
    body: input,
    method: "POST",
  });
}

export async function forgotPassword(email: string) {
  return requestJson<AuthMessageResponse>("/api/auth/forgot-password", {
    body: {
      email,
    },
    method: "POST",
  });
}

export async function verifyEmail(token: string) {
  return requestJson<VerifyEmailResponse>("/api/auth/verify-email", {
    body: {
      token,
    },
    method: "POST",
  });
}

export async function resendVerification(email: string) {
  return requestJson<AuthMessageResponse>("/api/auth/resend-verification", {
    body: {
      email,
    },
    method: "POST",
  });
}

export async function getCurrentUser() {
    const response = await csrfFetch(`${API_BASE_URL}/api/auth/me`, {
      credentials: "include",
      method: "GET",
  });

  if (response.status === 401) {
    return null;
  }

  if (!response.ok) {
    throw new Error(await getBackendError(response, "Could not load the current user."));
  }

  const payload = (await response.json()) as { user?: AuthUser | null };
  return payload.user || null;
}

export function logout() {
  return requestJson<{ ok: true }>("/api/auth/logout", {
    method: "POST",
  });
}

async function requestJson<T>(path: string, options: { body?: unknown; method: "GET" | "POST" }): Promise<T> {
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
      throw await createBackendApiError(response, "Authentication request failed.");
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

    throw new Error("Authentication request failed.");
  }
}
