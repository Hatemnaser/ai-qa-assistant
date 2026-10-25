import { csrfFetch } from '../../api/csrf';
import { API_BASE_URL } from '../../config/api';
export type QaReportFormat = 'JSON' | 'MARKDOWN' | 'ZIP';
export async function downloadQaReport(projectId: string, requestId: string, runId: string | null, format: QaReportFormat, isCurrent: () => boolean) {
    if (!isCurrent())
        return;
    const response = await csrfFetch(`${API_BASE_URL}/api/projects/${encodeURIComponent(projectId)}/qa/requests/${encodeURIComponent(requestId)}/export`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ format, ...(runId ? { runId } : {}) }) });
    if (!response.ok)
        throw Error('QA_REPORT_DOWNLOAD_FAILED');
    const blob = await response.blob();
    if (!isCurrent())
        return;
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    try {
        link.href = url;
        link.download = 'oddpath-qa-report.' + ({ JSON: 'json', MARKDOWN: 'md', ZIP: 'zip' }[format]);
        document.body.append(link);
        link.click();
    }
    finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
}
