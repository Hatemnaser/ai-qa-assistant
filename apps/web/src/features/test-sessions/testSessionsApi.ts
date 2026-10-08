import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { t } from "../../i18n/useI18n";
import type { TestSessionDetail, TestSessionList, TestTurnInput } from "./types";

function path(projectId: string, sessionId?: string, suffix = "") {
  return `/api/projects/${encodeURIComponent(projectId)}/test-sessions${sessionId ? `/${encodeURIComponent(sessionId)}` : ""}${suffix}`;
}

async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const response = await csrfFetch(`${API_BASE_URL}${url}`, {
    method, credentials: "include",
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await createBackendApiError(response, t("testSessions.errors.request"));
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function requireSession(body: { session?: TestSessionDetail } | undefined) {
  if (!body?.session?.id) throw new Error(t("testSessions.errors.response"));
  return body.session;
}

export function fetchTestSessions(projectId: string) {
  return request<TestSessionList>(path(projectId));
}

export async function fetchTestSession(projectId: string, sessionId: string) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, sessionId)));
}

export async function createTestSession(projectId: string, input: { clientSessionId: string; title?: string; requestId?: string }) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId), "POST", input));
}

export async function activateTestSession(projectId: string, input: { chatId: string; expectedUpdatedAt: string; expectedMessageCount: number }) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, undefined, "/activate"), "POST", input));
}

export async function sendTestTurn(projectId: string, sessionId: string, input: TestTurnInput) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, sessionId, "/turns"), "POST", input));
}

export async function prepareTestSession(projectId: string, sessionId: string, input: {
  proposalId: string; expectedSessionVersion: number; runnerRegistrationId?: string; profileKey?: string;
}) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, sessionId, "/prepare"), "POST", input));
}

export async function resumeTestPreparation(projectId: string, sessionId: string, input: {
  action: "resume" | "retry"; expectedSessionVersion: number; runnerRegistrationId?: string; profileKey?: string;
}) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, sessionId, "/preparation"), "POST", input));
}

export async function updateTestSession(projectId: string, sessionId: string, input: {
  expectedSessionVersion: number; title?: string; archived?: boolean;
}) {
  return requireSession(await request<{ session: TestSessionDetail }>(path(projectId, sessionId), "PATCH", input));
}

export async function deleteTestSession(projectId: string, sessionId: string, expectedSessionVersion: number) {
  return request<void>(path(projectId, sessionId), "DELETE", { expectedSessionVersion });
}
