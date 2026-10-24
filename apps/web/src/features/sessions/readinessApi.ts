import { readinessCandidateSchema, readinessSnapshotSchema, type ReadinessCandidateInput, type ReadinessCandidate, type ReadinessSnapshot, type ReadinessEvaluationInput } from '@oddpath/qa-execution-contract';
import { csrfFetch } from '../../api/csrf';
import { API_BASE_URL } from '../../config/api';
import { createBackendApiError } from '../../api/backendErrors';
export interface ReadinessEvaluation { id: string; snapshot: ReadinessSnapshot; snapshotHash: string }
export interface ReadinessState { candidates: ReadinessCandidate[]; evaluations: ReadinessEvaluation[] }
async function request(projectId: string, requestId: string, path = '', body?: unknown) {
  const response = await csrfFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/qa/requests/${encodeURIComponent(requestId)}/readiness${path}`, {
    credentials: 'include', method: body === undefined ? 'GET' : 'POST',
    ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw await createBackendApiError(response, 'Readiness request failed.');
  return response.json();
}
const evaluation = (value: ReadinessEvaluation): ReadinessEvaluation => ({ ...value, snapshot: readinessSnapshotSchema.parse(value.snapshot) });
export async function fetchReadiness(projectId: string, requestId: string): Promise<ReadinessState> {
  const body = await request(projectId, requestId);
  return { candidates: body.candidates.map((v: unknown) => readinessCandidateSchema.parse(v)), evaluations: body.evaluations.map(evaluation) };
}
export async function freezeReadiness(projectId: string, requestId: string, input: ReadinessCandidateInput) {
  return readinessCandidateSchema.parse((await request(projectId, requestId, '', input)).candidate);
}
export async function evaluateReadiness(projectId: string, requestId: string, candidateId: string, input: ReadinessEvaluationInput) {
  return evaluation((await request(projectId, requestId, `/${encodeURIComponent(candidateId)}/evaluations`, input)).evaluation);
}
export async function fetchReadinessTargets(projectId: string): Promise<{ label: string; targetId: string; revisionId: string; baseUrl: string }[]> {
  const response = await csrfFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/qa-targets`, { credentials: 'include' });
  if (!response.ok) throw await createBackendApiError(response, 'Could not read targets.');
  return (await response.json()).targets;
}
