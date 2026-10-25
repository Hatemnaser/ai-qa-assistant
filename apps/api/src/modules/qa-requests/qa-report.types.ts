import { z } from "zod";
import { qaEvidenceProvenanceSchema, QA_ENVIRONMENT_MAX_CHARS, readinessCandidateSchema, readinessSnapshotSchema } from "@oddpath/qa-execution-contract";
import type { AssetRecord } from "../assets/assets.types.js";
export const QA_REPORT_LIMITS = Object.freeze({ maxRequests: 50, maxRecords: 5000, maxJsonBytes: 2 * 1024 * 1024, maxArchiveBytes: 12 * 1024 * 1024, maxBinaryBytes: 8 * 1024 * 1024, maxFiles: 64, maxImageBytes: 4 * 1024 * 1024 });
const id = z.string().min(1).max(120), text = z.string().max(50000), date = z.string().datetime({ offset: true }), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const binary = z.object({ bindingId: id, sourceAssetId: id.nullable(), name: z.string().max(180), mimeType: z.string().max(120).nullable(), sizeBytes: z.number().int().nonnegative().nullable(), checksumSha256: z.string().max(120).nullable(), expiresAt: date.nullable(), availability: z.enum(["AVAILABLE", "EXPIRED", "DELETED", "MISSING", "UNAVAILABLE", "NOT_INCLUDED"]), path: z.string().max(240).nullable() }).strict();
const evidence = z.object({ id, checklistItemId: id.nullable(), requirementId: id.nullable(), kind: z.enum(["TEXT", "SCREENSHOT", "LOG", "TRACE", "FILE", "REFERENCE"]), textContent: text.nullable(), externalReference: z.string().max(2000).nullable(), actorKind: z.enum(["USER", "INTEGRATION", "SYSTEM"]), transport: z.enum(["WEB", "REST", "MCP", "SYSTEM"]), createdAt: date, provenance: qaEvidenceProvenanceSchema.nullable(), recordHash: hash, binaries: z.array(binary).max(10) }).strict();
const result = z.object({ id, checklistItemId: id, status: z.enum(["PASS", "FAIL", "BLOCKED", "SKIPPED"]), observedResult: text.nullable(), notes: text.nullable(), provenance: qaEvidenceProvenanceSchema.nullable() }).strict();
const assessment = z.object({ status: z.string().max(64), summary: text.nullable(), provider: z.string().max(120).nullable(), model: z.string().max(120).nullable(), createdAt: date }).strict();
const artifact = z.object({ id, revision: z.number().int(), origin: z.string().max(64), title: z.string().max(500), createdAt: date, items: z.array(z.object({ id, ordinal: z.number().int(), title: z.string().max(500), preconditions: z.array(text).max(100), steps: z.array(text).max(100), expectedResult: text, evidenceRequirements: z.array(z.object({ id, kind: z.string().max(64), description: text, required: z.boolean() }).strict()).max(20) }).strict()).max(100), aiInterpretations: z.array(assessment).max(100) }).strict();
export const qaReportRequestSchema = z.object({
    id, sourceProjectId: id, recordOrigin: z.enum(["LIVE_RECORD", "IMPORTED_RECORD"]), title: z.string().max(500), objective: text, target: z.string().max(2000).nullable(), environment: z.string().max(QA_ENVIRONMENT_MAX_CHARS).nullable(), phase: z.string().max(64), createdAt: date,
    artifacts: z.array(artifact).max(20),
    recipes: z.array(z.object({ id, recipeHash: hash, profileManifestHash: hash, revision: z.number().int(), aiInterpretations: z.array(assessment).max(100) }).strict()).max(100),
    runs: z.array(z.object({ id, artifactId: id, status: z.string().max(64), outcome: z.string().max(64), commitSha: z.string().max(240).nullable(), startedAt: date.nullable(), submittedAt: date.nullable(), execution: z.object({ id, status: z.string().max(64), errorCode: z.string().max(120).nullable(), recipeHash: hash, executorKey: z.string().max(120) }).strict().nullable(), results: z.array(result).max(100), evidence: z.array(evidence).max(240) }).strict()).max(100),
    reviews: z.array(z.object({ id, runId: id, decision: z.string().max(64), comment: text.nullable(), createdAt: date }).strict()).max(100),
    events: z.array(z.object({ sequence: z.number().int(), type: z.string().max(120), actorKind: z.string().max(64), transport: z.string().max(64), createdAt: date }).strict()).max(1000),
    contextHashes: z.array(z.object({ version: z.number().int(), payloadHash: z.string().max(120) }).strict()).max(100),
    readiness: z.array(z.object({ candidate: readinessCandidateSchema, evaluations: z.array(z.object({ id, snapshot: readinessSnapshotSchema, snapshotHash: hash }).strict()).max(100) }).strict()).max(20).optional(),
}).strict();
export const qaHistorySchema = z.object({ schemaVersion: z.literal(1), exportType: z.literal("QA_HISTORY"), historicalOnly: z.literal(true), projectId: id, exportedAt: date, requests: z.array(qaReportRequestSchema).max(QA_REPORT_LIMITS.maxRequests) }).strict();
export const qaHistoryReferenceSchema = z.object({ schemaVersion: z.literal(1), dataPath: z.string().max(240), readablePath: z.string().max(240) }).strict();
export type QaHistory = z.infer<typeof qaHistorySchema>;
export type QaReportRequest = z.infer<typeof qaReportRequestSchema>;
export interface QaBinarySource {
    bindingId: string;
    asset: AssetRecord;
}
export interface QaReportRepository {
    read(ownerId: string, projectId: string, now: Date, requestId?: string): Promise<{
        history: QaHistory;
        sources: QaBinarySource[];
    }>;
}
