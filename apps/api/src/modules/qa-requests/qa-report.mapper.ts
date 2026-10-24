import { qaEvidenceProvenanceSchema } from "@oddpath/qa-execution-contract";
import { hashCanonicalJson } from "../../lib/canonical-json.js";
import { qaReportRequestSchema, type QaReportRequest } from "./qa-report.types.js";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const rows = (value: unknown): Row[] => Array.isArray(value) ? value.map(row) : [];
const string = (value: unknown) => typeof value === 'string' ? value : null;
const iso = (value: unknown) => value instanceof Date ? value.toISOString() : string(value);
const strings = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
const provenance = (value: unknown) => { const parsed = qaEvidenceProvenanceSchema.safeParse(value); return parsed.success ? parsed.data : null; };
const assessment = (value: Row) => ({ status: value.status, summary: string(value.summary), provider: string(value.provider), model: string(value.model), createdAt: iso(value.createdAt) });
/** Explicit whitelist: never spread database jobs, authorization or metadata. */
export function toQaReportRequest(value: unknown, now: Date): QaReportRequest {
    const request = row(value);
    return qaReportRequestSchema.parse({
        id: request.id, sourceProjectId: request.projectId, recordOrigin: 'LIVE_RECORD', title: request.title, objective: request.objective, target: safeReference(request.target), environment: string(request.environment), phase: request.phase, createdAt: iso(request.createdAt),
        artifacts: rows(request.artifacts).map(a => ({ id: a.id, revision: a.revision, origin: a.origin, title: a.title, createdAt: iso(a.createdAt),
            items: rows(a.items).map(i => ({ id: i.id, ordinal: i.ordinal, title: i.title, preconditions: strings(i.preconditions), steps: strings(i.steps), expectedResult: i.expectedResult,
                evidenceRequirements: rows(i.evidenceRequirements).map(r => ({ id: r.id, kind: r.kind, description: r.description, required: r.required })) })), aiInterpretations: rows(a.assessments).map(assessment) })),
        recipes: rows(request.executionRecipes).map(r => ({ id: r.id, recipeHash: r.recipeHash, profileManifestHash: r.profileManifestHash, revision: r.revision, aiInterpretations: rows(r.assessments).map(assessment) })),
        runs: rows(request.runs).map(r => {
            const job = row(r.executionJob);
            return { id: r.id, artifactId: r.artifactId, status: r.status, outcome: r.outcome, commitSha: string(r.commitSha), startedAt: iso(r.startedAt), submittedAt: iso(r.submittedAt),
                execution: job.id ? { id: job.id, status: job.status, errorCode: string(job.errorCode), recipeHash: job.recipeHash, executorKey: job.executorKey } : null,
                results: rows(r.results).map(c => ({ id: c.id, checklistItemId: c.checklistItemId, status: c.status, observedResult: string(c.observedResult), notes: string(c.notes), provenance: provenance(c.provenance) })),
                evidence: rows(r.evidence).map(e => {
                    const binaries = rows(e.assets).map(b => {
                        const asset = row(b.asset), snapshot = row(b.snapshot), data = Object.keys(asset).length ? asset : snapshot;
                        const expiry = iso(data.evidenceExpiresAt), availability = expiry && Date.parse(expiry) <= now.getTime() ? 'EXPIRED' : b.unavailableReason === 'EXPIRED' ? 'EXPIRED' : b.unavailableReason === 'DELETED' ? 'DELETED' : !asset.id ? 'MISSING' : asset.status === 'READY' ? 'NOT_INCLUDED' : 'UNAVAILABLE';
                        return { bindingId: b.id, sourceAssetId: string(data.id), name: string(data.originalName) || '', mimeType: string(data.detectedMimeType) || string(data.declaredMimeType), sizeBytes: typeof data.sizeBytes === 'number' ? data.sizeBytes : null, checksumSha256: string(data.checksumSha256), expiresAt: expiry, availability, path: null };
                    });
                    const safe = { id: e.id, checklistItemId: string(e.checklistItemId), requirementId: string(e.requirementId), kind: e.kind, textContent: string(e.textContent), externalReference: safeReference(e.externalReference), actorKind: e.actorKind, transport: e.transport, createdAt: iso(e.createdAt), provenance: provenance(e.provenance), binaries };
                    return { ...safe, recordHash: hashCanonicalJson({ ...safe, binaries: binaries.map(({ availability, path, ...descriptor }) => { void availability; void path; return descriptor; }) }) };
                }) };
        }),
        reviews: rows(request.reviews).map(r => ({ id: r.id, runId: r.runId, decision: r.decision, comment: string(r.comment), createdAt: iso(r.createdAt) })),
        events: rows(request.events).map(e => ({ sequence: e.sequence, type: e.type, actorKind: e.actorKind, transport: e.transport, createdAt: iso(e.createdAt) })),
        contextHashes: rows(request.contextSnapshots).map(c => ({ version: c.version, payloadHash: c.payloadHash })),
        ...(rows(request.readinessCandidates).length ? { readiness: rows(request.readinessCandidates).map(c => ({
            candidate: { id: c.id, revision: c.revision, createdAt: iso(c.createdAt), definition: c.definition, definitionHash: c.definitionHash, initialDeployment: c.initialDeployment, invalidatedAt: iso(c.invalidatedAt) },
            evaluations: rows(c.evaluations).map(e => ({ id: e.id, snapshot: e.snapshot, snapshotHash: e.snapshotHash })),
        })) } : {}),
    });
}
export function safeReference(value: unknown): string | null {
    if (typeof value !== 'string')
        return null;
    try {
        const url = new URL(value);
        if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
            return null;
        url.search = '';
        url.hash = '';
        return url.toString();
    }
    catch {
        return null;
    }
}
