import { createHash } from "node:crypto";
import { strToU8 } from "fflate";
import { AppError } from "../../lib/errors.js";
import { detectAssetMime } from "../assets/assets.policy.js";
import { formatQaHistoryMarkdown, type QaBinaryBundle } from "../qa-requests/qa-report.package.js";
import { QA_REPORT_LIMITS, type QaHistory, qaHistoryReferenceSchema } from "../qa-requests/qa-report.types.js";
import { validateQaHistory } from "../qa-requests/qa-report.reader.js";
export const QA_HISTORY_IMPORT_WARNING = 'QA records are preserved as read-only history. QA binaries remain in the original ZIP and are not restored to live storage. No execution, approval, login state or credentials are reinstated.';
export function addPortableQaHistory(entries: Map<string, Uint8Array>, history: QaHistory | undefined, bundle?: QaBinaryBundle, sequence?: string) {
    if (!history?.requests.length)
        return undefined;
    const value = validateQaHistory(bundle?.history || history), suffix = sequence ? `/project-${sequence}` : '';
    const reference = { schemaVersion: 1 as const, dataPath: `data/qa${suffix}.json`, readablePath: `readable/qa${suffix}.md` };
    entries.set(reference.dataPath, strToU8(JSON.stringify(value, null, 2) + '\n'));
    entries.set(reference.readablePath, strToU8(formatQaHistoryMarkdown(value)));
    for (const [path, bytes] of bundle?.entries || []) {
        if (entries.has(path))
            throw Error('QA export path collision');
        entries.set(path, bytes);
    }
    return reference;
}
export function importPortableQaHistory(reference: unknown, entries: Record<string, Uint8Array>, sourceProjectId: string, includedFilePaths?: Set<string>): QaHistory | undefined {
    if (reference === undefined)
        return undefined;
    const parsed = qaHistoryReferenceSchema.safeParse(reference);
    if (!parsed.success)
        throwInvalid();
    const ref = parsed.data;
    if (!/^data\/qa(?:\/project-[0-9]+)?\.json$/u.test(ref.dataPath) || ref.readablePath !== ref.dataPath.replace(/^data\//u, 'readable/').replace(/\.json$/u, '.md') || !entries[ref.readablePath] || !entries[ref.dataPath])
        throwInvalid();
    let value: QaHistory;
    try {
        value = validateQaHistory(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(entries[ref.dataPath])));
    }
    catch {
        throwInvalid();
    }
    if (value.projectId !== sourceProjectId)
        throwInvalid();
    let totalBytes = 0, files = 0;
    const paths = new Set<string>();
    for (const request of value.requests) {
        request.recordOrigin = 'IMPORTED_RECORD';
        for (const run of request.runs)
            for (const evidence of run.evidence)
                for (const binary of evidence.binaries) {
                    if (binary.availability === 'AVAILABLE') {
                        const path = binary.path;
                        if (!path || !/^qa-files\/(?:project-[0-9]+\/)?[0-9]{3}-[a-zA-Z0-9._-]+$/u.test(path) || paths.has(path))
                            throwInvalid();
                        const bytes = entries[path];
                        if (!bytes || bytes.length !== binary.sizeBytes || bytes.length > QA_REPORT_LIMITS.maxImageBytes || !binary.mimeType || detectAssetMime(bytes, binary.mimeType) !== binary.mimeType || createHash('sha256').update(bytes).digest('base64') !== binary.checksumSha256)
                            throwInvalid();
                        paths.add(path);
                        totalBytes += bytes.length;
                        files++;
                        if (totalBytes > QA_REPORT_LIMITS.maxBinaryBytes || files > QA_REPORT_LIMITS.maxFiles)
                            throwInvalid();
                        binary.availability = 'NOT_INCLUDED';
                        binary.path = null;
                    }
                    else if (binary.path !== null)
                        throwInvalid();
                }
    }
    // Transient manifest facts come only from referenced, validated files.
    // They are kept outside the inert history that will be persisted.
    for (const path of paths) {
        if (includedFilePaths?.has(path))
            throwInvalid();
        includedFilePaths?.add(path);
    }
    return value;
}
function throwInvalid(): never { throw new AppError('Portable QA history is invalid.', 400, 'QA_HISTORY_IMPORT_INVALID'); }
