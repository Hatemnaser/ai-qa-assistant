import { csrfFetch } from '../../api/csrf';
import { createBackendApiError } from '../../api/backendErrors';
import { API_BASE_URL } from '../../config/api';
import { useI18n } from '../../i18n/useI18n';

export interface BrowserLoginStatus {
  runtimeId: string; executionId: string; state: string;
  authenticationKind?:string;
  savedLogin?:{enabled:boolean;consent:boolean;savedLoginId:string|null};
  login: { phase: 'NONE'|'WAITING'|'ENTER_REQUESTED'|'LOGIN'|'FINISH_REQUESTED'|'READY'; controlEpoch: string|null; expiresAt: string|null };
}
export async function browserLoginRequest<T>(projectId: string, executionId: string, action = '', body?: unknown): Promise<T> {
  const { t } = useI18n();
  const response = await csrfFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/browser-runtimes/${encodeURIComponent(executionId)}${action}`, {
    credentials: 'include', method: action ? 'POST' : 'GET',
    ...(body ? { headers: {'Content-Type':'application/json'}, body: JSON.stringify(body) } : {}),
  });
  if (!response.ok) throw await createBackendApiError(response, t('projects.browserLogin.error'));
  return response.json() as Promise<T>;
}
