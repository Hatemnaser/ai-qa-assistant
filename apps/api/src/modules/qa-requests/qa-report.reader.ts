import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import { toQaReportRequest } from "./qa-report.mapper.js";
import { qaHistorySchema, QA_REPORT_LIMITS, type QaHistory } from "./qa-report.types.js";
export async function readQaHistory(tx: Prisma.TransactionClient, ownerId: string, projectId: string, now = new Date(), requestId?: string): Promise<QaHistory> {
    const scope = { projectId, project: { ownerId }, ...(requestId ? { id: requestId } : {}) };
    // Fail before materializing nested data. No silent truncation of QA history.
    const counts = await Promise.all([
        tx.qaRequest.count({ where: scope }), tx.qaArtifact.count({ where: { request: scope } }), tx.qaChecklistItem.count({ where: { artifact: { request: scope } } }),
        tx.qaRun.count({ where: { request: scope } }), tx.qaCheckResult.count({ where: { run: { request: scope } } }), tx.qaEvidence.count({ where: { run: { request: scope } } }),
        tx.qaHumanReview.count({ where: { request: scope } }), tx.qaWorkflowEvent.count({ where: { request: scope } }), tx.qaExecutionRecipe.count({ where: { request: scope } }),
        tx.qaEvidenceAsset.count({ where: { evidence: { run: { request: scope } } } }), tx.qaEvidenceRequirement.count({ where: { checklistItem: { artifact: { request: scope } } } }),
        tx.qaChecklistAssessment.count({ where: { artifact: { request: scope } } }), tx.qaExecutionRecipeAssessment.count({ where: { recipe: { request: scope } } }), tx.qaContextSnapshot.count({ where: { request: scope } }),
        tx.qaReadinessCandidate.count({ where: { request: scope } }), tx.qaReadinessEvaluation.count({ where: { candidate: { request: scope } } }),
    ]);
    if (counts[0] > QA_REPORT_LIMITS.maxRequests || counts.reduce((sum, n) => sum + n, 0) > QA_REPORT_LIMITS.maxRecords)
        throwQaReportTooLarge();
    // Inspect byte weight in PostgreSQL before bringing any large text/JSON rows
    // into Node. The full-row estimates are intentionally conservative.
    const weights = await tx.$queryRaw<Array<{
        bytes: bigint;
    }>> `
  WITH owned AS (SELECT q."id" FROM "QaRequest" q JOIN "Project" p ON p."id"=q."projectId"
    WHERE q."projectId"=${projectId} AND p."ownerId"=${ownerId} AND (${requestId || null}::text IS NULL OR q."id"=${requestId || null}))
  SELECT COALESCE(SUM(size),0)::bigint AS bytes FROM (
   SELECT octet_length(row_to_json(q)::text) AS size FROM "QaRequest" q WHERE q."id" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(a)::text) FROM "QaArtifact" a WHERE a."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(i)::text) FROM "QaChecklistItem" i JOIN "QaArtifact" a ON a."id"=i."artifactId" WHERE a."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(e)::text) FROM "QaEvidence" e JOIN "QaRun" r ON r."id"=e."runId" WHERE r."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(c)::text) FROM "QaCheckResult" c JOIN "QaRun" r ON r."id"=c."runId" WHERE r."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(a)::text) FROM "QaChecklistAssessment" a JOIN "QaArtifact" f ON f."id"=a."artifactId" WHERE f."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(a)::text) FROM "QaExecutionRecipeAssessment" a JOIN "QaExecutionRecipe" f ON f."id"=a."recipeId" WHERE f."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(r)::text) FROM "QaHumanReview" r WHERE r."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(c)::text) FROM "QaReadinessCandidate" c WHERE c."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(row_to_json(e)::text) FROM "QaReadinessEvaluation" e JOIN "QaReadinessCandidate" c ON c.id=e."candidateId" WHERE c."requestId" IN (SELECT "id" FROM owned)
   UNION ALL SELECT octet_length(a."payload"::text) FROM "QaImportedArchive" a JOIN "Project" p ON p."id"=a."projectId" WHERE a."projectId"=${projectId} AND p."ownerId"=${ownerId} AND ${requestId || null}::text IS NULL
  ) measured
 `;
    if (Number(weights[0]?.bytes || 0) > QA_REPORT_LIMITS.maxJsonBytes)
        throwQaReportTooLarge();
    const records = await tx.qaRequest.findMany({ where: scope, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: QA_REPORT_LIMITS.maxRequests + 1, include: {
            contextSnapshots: { select: { version: true, payloadHash: true }, orderBy: { version: 'asc' } },
            readinessCandidates: { orderBy: { revision: 'asc' }, include: { evaluations: { orderBy: { createdAt: 'asc' } } } },
            artifacts: { orderBy: { revision: 'asc' }, include: { items: { orderBy: { ordinal: 'asc' }, include: { evidenceRequirements: { orderBy: { ordinal: 'asc' } } } }, assessments: { orderBy: { createdAt: 'asc' } } } },
            executionRecipes: { select: { id: true, revision: true, recipeHash: true, profileManifestHash: true, assessments: true }, orderBy: { revision: 'asc' } },
            runs: { orderBy: { createdAt: 'asc' }, include: { results: { orderBy: { checklistItemId: 'asc' } }, evidence: { orderBy: { createdAt: 'asc' }, include: { assets: { orderBy: { ordinal: 'asc' }, include: { asset: true } } } }, executionJob: { select: { id: true, status: true, errorCode: true, recipeHash: true, executorKey: true } } } },
            reviews: { orderBy: { createdAt: 'asc' } }, events: { orderBy: { sequence: 'asc' }, select: { sequence: true, type: true, actorKind: true, transport: true, createdAt: true } },
        } });
    if (requestId && !records.length)
        throw new AppError('QA request was not found.', 404, 'QA_REQUEST_NOT_FOUND');
    const requests = records.map(r => toQaReportRequest(r, now));
    if (!requestId) {
        const archived = await tx.qaImportedArchive.findMany({ where: { projectId, project: { ownerId } }, take: 11, orderBy: { importedAt: 'asc' } });
        if (archived.length > 10)
            throwQaReportTooLarge();
        for (const archive of archived) {
            const history = validateQaHistory(archive.payload);
            requests.push(...history.requests.map(r => ({ ...r, recordOrigin: 'IMPORTED_RECORD' as const })));
        }
    }
    const report = validateQaHistory({ schemaVersion: 1, exportType: 'QA_HISTORY', historicalOnly: true, projectId, exportedAt: now.toISOString(), requests });
    return report;
}
export function validateQaHistory(value: unknown): QaHistory {
    const parsed = qaHistorySchema.safeParse(value);
    if (!parsed.success)
        throw new AppError('QA history is invalid or exceeds its record limits.', 422, 'QA_HISTORY_INVALID');
    if (Buffer.byteLength(JSON.stringify(parsed.data)) > QA_REPORT_LIMITS.maxJsonBytes)
        throwQaReportTooLarge();
    return parsed.data;
}
export function throwQaReportTooLarge(): never { throw new AppError('QA history exceeds the bounded export limits. Export individual requests instead.', 413, 'QA_EXPORT_TOO_LARGE'); }
export async function readQaBinarySources(tx: Prisma.TransactionClient, ownerId: string, projectId: string, requestId?: string) {
    const bindings = await tx.qaEvidenceAsset.findMany({ where: { evidence: { run: { request: { projectId, project: { ownerId }, ...(requestId ? { id: requestId } : {}) } } }, asset: { is: { ownerId, projectId, purpose: 'QA_EVIDENCE', status: 'READY' } } }, include: { asset: true }, orderBy: { id: 'asc' }, take: QA_REPORT_LIMITS.maxFiles + 1 });
    return bindings.flatMap(binding => binding.asset ? [{ bindingId: binding.id, asset: binding.asset }] : []);
}
