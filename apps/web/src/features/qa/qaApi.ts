import { createBackendApiError } from "../../api/backendErrors";
import { csrfFetch } from "../../api/csrf";
import { API_BASE_URL } from "../../config/api";
import { useI18n } from "../../i18n/useI18n";
import type {
  CreateQaRequestResult,
  CreateQaRequestInput,
  ProjectConnection,
  QaExecutionRecipe,
  QaOperationReceipt,
  QaProfileManifest,
  QaRunnerProfile,
  QaRequestDetail,
  QaRequestSummary,
  StartQaRunInput,
} from "./types";

export async function fetchQaRequests(projectId: string): Promise<QaRequestSummary[]> {
  const body = await requestJson<{ requests?: QaRequestSummary[] }>(
    qaPath(projectId, "/requests"),
    { method: "GET" },
    "Could not load QA Requests."
  );
  return Array.isArray(body.requests) ? body.requests : [];
}

export async function fetchQaRequest(projectId: string, requestId: string): Promise<QaRequestDetail> {
  const body = await requestJson<{ request?: QaRequestDetail }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}`),
    { method: "GET" },
    "Could not load this QA Request."
  );
  return requireRequest(body.request);
}

export async function fetchQaSample(projectId: string): Promise<QaRequestDetail> {
  const body = await requestJson<{ request?: QaRequestDetail }>(
    qaPath(projectId, "/sample"),
    { method: "GET" },
    "Could not load the QA workspace sample."
  );
  return requireRequest(body.request);
}

export async function createQaRequest(projectId: string, input: CreateQaRequestInput) {
  const body = await requestJson<{ request?: QaRequestDetail; operation?: QaOperationReceipt | null }>(
    qaPath(projectId, "/requests"),
    jsonRequest("POST", input),
    "Could not create this QA Request."
  );
  return {
    operation: body.operation || null,
    request: requireRequest(body.request),
  } satisfies CreateQaRequestResult;
}

export async function selectQaArtifact(
  projectId: string,
  requestId: string,
  artifactId: string,
  expectedRequestVersion: number
) {
  const body = await requestJson<{ request?: QaRequestDetail }>(
    qaPath(
      projectId,
      `/requests/${encodeURIComponent(requestId)}/artifacts/${encodeURIComponent(artifactId)}/select`
    ),
    jsonRequest("POST", { expectedRequestVersion }),
    "Could not select this QA Checklist."
  );
  return requireRequest(body.request);
}

export async function startQaRun(projectId: string, requestId: string, input?: StartQaRunInput) {
  const body = await requestJson<{ request?: QaRequestDetail; runId: string }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}/runs`),
    jsonRequest("POST", input
      ? { ...input, sourceLabel: input.executionMode === "PLAYWRIGHT" ? "Oddpath Playwright" : "Oddpath Web" }
      : { sourceLabel: "Oddpath Web" }),
    "Could not start this QA Run."
  );
  return { request: requireRequest(body.request), runId: body.runId };
}

export async function reviewQaRun(
  projectId: string,
  requestId: string,
  runId: string,
  input: { decision: "APPROVED" | "CHANGES_REQUESTED"; comment?: string; expectedRunVersion: number }
) {
  const body = await requestJson<{ request?: QaRequestDetail }>(
    qaPath(
      projectId,
      `/requests/${encodeURIComponent(requestId)}/runs/${encodeURIComponent(runId)}/reviews`
    ),
    jsonRequest("POST", input),
    "Could not save this human review."
  );
  return requireRequest(body.request);
}

export async function fetchProjectConnections(projectId: string): Promise<ProjectConnection[]> {
  const body = await requestJson<{ connections?: ProjectConnection[] }>(
    `/api/projects/${encodeURIComponent(projectId)}/connections`,
    { method: "GET" },
    "Could not load agent connections."
  );
  return Array.isArray(body.connections) ? body.connections : [];
}

export async function createProjectConnection(
  projectId: string,
  name: string,
  preset: "AGENT" | "RUNNER" = "AGENT"
) {
  return requestJson<{ connection: ProjectConnection; token: string }>(
    `/api/projects/${encodeURIComponent(projectId)}/connections`,
    jsonRequest("POST", { name, preset }),
    `Could not create this ${preset === "RUNNER" ? "runner" : "agent"} connection.`
  );
}

export async function fetchQaRunnerProfiles(projectId: string): Promise<QaRunnerProfile[]> {
  const body = await requestJson<{ profiles?: QaRunnerProfile[] }>(
    qaPath(projectId, "/runner-profiles"),
    { method: "GET" },
    "Could not load Playwright Runner profiles."
  );
  return Array.isArray(body.profiles) ? body.profiles : [];
}

export async function fetchQaOperation(projectId: string, operationId: string) {
  const body = await requestJson<{ operation?: QaOperationReceipt }>(
    qaPath(projectId, `/operations/${encodeURIComponent(operationId)}`),
    { method: "GET" },
    "Could not refresh this processing operation."
  );
  if (!body.operation) throw new Error("Oddpath returned an invalid operation receipt.");
  return body.operation;
}

export async function fetchQaExecutionRecipes(projectId: string, requestId: string) {
  const body = await requestJson<{ recipes?: QaExecutionRecipe[] }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}/execution-recipes`),
    { method: "GET" },
    "Could not load Execution Recipes."
  );
  return Array.isArray(body.recipes) ? body.recipes : [];
}

export async function generateQaExecutionRecipe(
  projectId: string,
  requestId: string,
  input: { artifactId?: string; profileManifest: QaProfileManifest }
) {
  const body = await requestJson<{ operation?: QaOperationReceipt }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}/execution-recipes/generate`),
    jsonRequest("POST", input),
    "Could not start Execution Recipe generation."
  );
  if (!body.operation) throw new Error("Oddpath returned an invalid operation receipt.");
  return body.operation;
}

export async function cancelQaExecution(projectId: string, requestId: string, runId: string) {
  const body = await requestJson<{ request?: QaRequestDetail }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}/runs/${encodeURIComponent(runId)}/cancel`),
    jsonRequest("POST", {}),
    "Could not cancel this QA Run."
  );
  return requireRequest(body.request);
}

export async function retryQaExecutionRecipeReview(
  projectId: string,
  requestId: string,
  recipeId: string,
  input: { assessmentId: string }
) {
  const { t } = useI18n();
  const body = await requestJson<{ operation?: QaOperationReceipt }>(
    qaPath(projectId, `/requests/${encodeURIComponent(requestId)}/execution-recipes/${encodeURIComponent(recipeId)}/review/retry`),
    jsonRequest("POST", input),
    t("projects.qa.reviewRetry.error")
  );
  if (!body.operation) throw new Error(t("projects.qa.reviewRetry.invalidReceipt"));
  return body.operation;
}

export async function revokeProjectConnection(projectId: string, connectionId: string) {
  await requestJson<{ ok: true }>(
    `/api/projects/${encodeURIComponent(projectId)}/connections/${encodeURIComponent(connectionId)}`,
    { method: "DELETE" },
    "Could not revoke this agent connection."
  );
}

export function getOddpathMcpUrl() {
  return `${getOddpathApiUrl()}/api/mcp`;
}

export function getOddpathApiUrl() {
  return API_BASE_URL || globalThis.location?.origin || "http://localhost:3000";
}

function qaPath(projectId: string, suffix: string) {
  return `/api/projects/${encodeURIComponent(projectId)}/qa${suffix}`;
}

function jsonRequest(method: "POST" | "PUT", body: unknown): RequestInit {
  return {
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
    method,
  };
}

async function requestJson<T>(path: string, init: RequestInit, fallback: string): Promise<T> {
  try {
    const response = await csrfFetch(`${API_BASE_URL}${path}`, {
      credentials: "include",
      ...init,
    });
    if (!response.ok) throw await createBackendApiError(response, fallback);
    return response.json() as Promise<T>;
  } catch (error) {
    if (error instanceof TypeError || (error instanceof Error && error.message === "Failed to fetch")) {
      throw new Error("Could not connect to the Oddpath API.");
    }
    if (error instanceof Error) throw error;
    throw new Error(fallback);
  }
}

function requireRequest(request: QaRequestDetail | undefined) {
  if (!request) throw new Error("Oddpath returned an invalid QA Request.");
  return request;
}
