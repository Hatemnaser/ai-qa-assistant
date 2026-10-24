import { createHash } from "node:crypto";
import { strToU8, zipSync } from "fflate";
import { AppError } from "../../lib/errors.js";
import type { AssetStorage } from "../assets/assets.storage.js";
import { QA_REPORT_LIMITS, type QaHistory, type QaBinarySource } from "./qa-report.types.js";
import { validateQaHistory } from "./qa-report.reader.js";
export interface QaBinaryBundle {
    history: QaHistory;
    entries: Map<string, Uint8Array>;
    totalBytes: number;
}
export async function collectQaReportBinaries(ownerId: string, history: QaHistory, sources: QaBinarySource[], storage: Pick<AssetStorage, 'readObject'>, now = () => new Date(), maximumBytes = QA_REPORT_LIMITS.maxBinaryBytes, prefix = 'qa-files'): Promise<QaBinaryBundle> {
    const copy = structuredClone(validateQaHistory(history)), entries = new Map<string, Uint8Array>();
    let totalBytes = 0;
    const byBinding = new Map(sources.map(s => [s.bindingId, s.asset]));
    for (const request of copy.requests)
        for (const run of request.runs)
            for (const evidence of run.evidence)
                for (const binary of evidence.binaries) {
                    if (binary.availability !== 'NOT_INCLUDED' || request.recordOrigin === 'IMPORTED_RECORD')
                        continue;
                    const asset = byBinding.get(binary.bindingId);
                    if (!asset || asset.ownerId !== ownerId || asset.projectId !== history.projectId || asset.id !== binary.sourceAssetId || asset.purpose !== 'QA_EVIDENCE') {
                        binary.availability = 'MISSING';
                        continue;
                    }
                    if (asset.evidenceExpiresAt && asset.evidenceExpiresAt <= now()) {
                        binary.availability = 'EXPIRED';
                        continue;
                    }
                    if (asset.status !== 'READY' || !asset.sizeBytes || !asset.detectedMimeType) {
                        binary.availability = 'UNAVAILABLE';
                        continue;
                    }
                    if (entries.size >= QA_REPORT_LIMITS.maxFiles || asset.sizeBytes > QA_REPORT_LIMITS.maxImageBytes || totalBytes + asset.sizeBytes > maximumBytes)
                        continue;
                    try {
                        const stored = await storage.readObject(asset.objectKey, QA_REPORT_LIMITS.maxImageBytes);
                        const checksum = createHash('sha256').update(stored.bytes).digest('base64');
                        if (stored.bytes.length !== asset.sizeBytes || stored.metadata.contentLength !== asset.sizeBytes || stored.metadata.contentType !== asset.detectedMimeType || checksum !== asset.checksumSha256 || binary.checksumSha256 !== checksum)
                            throw Error('Evidence object mismatch');
                        if (asset.evidenceExpiresAt && asset.evidenceExpiresAt <= now()) {
                            binary.availability = 'EXPIRED';
                            continue;
                        }
                        const name = asset.originalName.replace(/[^a-zA-Z0-9._-]/gu, '_').slice(0, 100) || 'evidence.bin';
                        const file = `${prefix}/${String(entries.size + 1).padStart(3, '0')}-${name}`;
                        entries.set(file, stored.bytes);
                        totalBytes += stored.bytes.length;
                        binary.path = file;
                        binary.availability = 'AVAILABLE';
                    }
                    catch {
                        binary.availability = 'UNAVAILABLE';
                    }
                }
    return { history: copy, entries, totalBytes };
}
export function formatQaHistoryMarkdown(history: QaHistory): string {
    const lines = ['# Oddpath QA history', '', `Schema: ${history.schemaVersion} · ${history.exportedAt}`, '', 'Historical record only. Import does not restore execution or grant approval.', ''];
    for (const request of history.requests) {
        lines.push(`## ${request.title}`, '', request.objective, '', `Target: ${request.target || 'Unknown'} · ${request.environment || 'Unknown'}`, `Recorded phase: ${request.phase} · ${request.recordOrigin}`, '');
        for (const run of request.runs) {
            lines.push(`### Run ${run.id}`, `Status: ${run.status} · Outcome: ${run.outcome}`, `Declared build: ${run.commitSha || 'Unknown'}`, `Execution error: ${run.execution?.errorCode || 'None recorded'}`, '');
            for (const result of run.results) {
                const item = request.artifacts.flatMap(a => a.items).find(i => i.id === result.checklistItemId);
                lines.push(`- ${result.status}: ${item?.title || result.checklistItemId}`, `  Expected: ${result.provenance?.expectedResult || item?.expectedResult || 'Unknown'}`, `  Observed: ${result.observedResult || 'Not recorded'}`, `  Executor: ${result.provenance?.executor.kind || 'Unknown'} · Recorded: ${result.provenance?.recordedAt || 'Unknown'}`);
            }
            for (const evidence of run.evidence) {
                lines.push('', `Evidence ${evidence.id} · ${evidence.kind} · SHA-256 ${evidence.recordHash}`, evidence.textContent || evidence.externalReference || '');
                for (const file of evidence.binaries)
                    lines.push(`- ${file.name}: ${file.availability} · ${file.path || 'No file in this report'} · checksum ${file.checksumSha256 || 'Unknown'}`);
            }
        }
        for (const artifact of request.artifacts)
            for (const interpretation of artifact.aiInterpretations)
                lines.push('', `AI interpretation (${interpretation.provider || 'Unknown'}/${interpretation.model || 'Unknown'}): ${interpretation.summary || interpretation.status}`);
        for (const review of request.reviews)
            lines.push('', `Historical human review: ${review.decision} · ${review.createdAt}`, review.comment || '');
    }
    return lines.join('\n') + '\n';
}
export function createQaReportDownload(bundle: QaBinaryBundle, format: 'JSON' | 'MARKDOWN' | 'ZIP') {
    const history = validateQaHistory(bundle.history), json = Buffer.from(JSON.stringify(history, null, 2) + '\n'), markdown = Buffer.from(formatQaHistoryMarkdown(history));
    if (format === 'JSON')
        return { bytes: json, mimeType: 'application/json', filename: 'oddpath-qa-report.json' };
    if (format === 'MARKDOWN')
        return { bytes: markdown, mimeType: 'text/markdown; charset=utf-8', filename: 'oddpath-qa-report.md' };
    const entries = new Map(bundle.entries);
    entries.set('data/qa.json', json);
    entries.set('readable/qa.md', markdown);
    const files = [...entries].map(([path, bytes]) => ({ path, sha256: createHash('sha256').update(bytes).digest('hex'), sizeBytes: bytes.length }));
    const gaps = history.requests.flatMap(r => r.runs.flatMap(run => run.evidence.flatMap(e => e.binaries.filter(b => b.availability !== 'AVAILABLE').map(b => ({ bindingId: b.bindingId, reason: b.availability })))));
    entries.set('manifest.json', strToU8(JSON.stringify({ schemaVersion: 1, exportType: 'QA_REPORT', files, gaps, historicalOnly: true }, null, 2)));
    const bytes = Buffer.from(zipSync(Object.fromEntries(entries), { level: 6 }));
    if (bytes.length > QA_REPORT_LIMITS.maxArchiveBytes)
        throw new AppError('QA report exceeds the archive limit.', 413, 'QA_EXPORT_TOO_LARGE');
    return { bytes, mimeType: 'application/zip', filename: 'oddpath-qa-report.zip' };
}
