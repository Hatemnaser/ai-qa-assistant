import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { createBackendApiError } from "../../api/backendErrors";
import { t } from "../../i18n/useI18n";
import type { TestSessionDetail, TestSessionList, TestTurnInput } from "../test-sessions/types";

async function request<T>(suffix = "", method = "GET", body?: unknown): Promise<T> {
  const response = await csrfFetch(`${API_BASE_URL}/api/sessions${suffix}`, {
    credentials: "include", method,
    ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await createBackendApiError(response, t("testSessions.errors.request"));
  return response.status === 204 ? undefined as T : response.json();
}
async function detail(suffix: string, method = "GET", body?: unknown) {
  const result = await request<{ session: TestSessionDetail }>(suffix, method, body);
  if (!result?.session?.id) throw new Error(t("testSessions.errors.response"));
  return { ...result.session, projectId: result.session.projectId || "" };
}
const path = (id: string) => `/${encodeURIComponent(id)}`;
export const fetchSessionIndex = () => request<TestSessionList>();
export const fetchTestSession = (_projectId: string, id: string) => detail(path(id));
export const createTestSession = (projectId: string, input: { clientSessionId: string; title?: string; requestId?: string }) => detail("", "POST", { ...input, projectId: projectId || null });
export const sendTestTurn = (_projectId: string, id: string, input: TestTurnInput) => detail(`${path(id)}/turns`, "POST", input);
export const prepareTestSession = (_projectId: string, id: string, input: { proposalId: string; expectedSessionVersion: number; runnerRegistrationId?: string; profileKey?: string }) => detail(`${path(id)}/prepare`, "POST", input);
export const resumeTestPreparation = (_projectId: string, id: string, input: { action: "resume" | "retry"; expectedSessionVersion: number; runnerRegistrationId?: string; profileKey?: string }) => detail(`${path(id)}/preparation`, "POST", input);
export const updateTestSession = (_projectId: string, id: string, input: { expectedSessionVersion: number; expectedUpdatedAt?: string; title?: string; archived?: boolean; projectId?: string | null }) => detail(path(id), "PATCH", input);
export const deleteTestSession = (_projectId: string, id: string, expectedSessionVersion: number, expectedUpdatedAt?: string) => request<void>(path(id), "DELETE", { expectedSessionVersion, ...(expectedUpdatedAt ? { expectedUpdatedAt } : {}) });
export const retrySessionTurn = (id: string, turnId: string, input: { clientRetryId: string; expectedSessionVersion: number }) => detail(`${path(id)}/turns/${encodeURIComponent(turnId)}/retry`, "POST", input);
