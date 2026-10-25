import { qaEvidenceProvenanceSchema, type ExecutionObservation, type QaEvidenceProvenance } from "@oddpath/qa-execution-contract";
import type { Prisma } from "../../generated/prisma/client.js";
import type { QaActor } from "./qa-requests.types.js";
export function createQaProvenance(input: {
    actor: QaActor;
    projectId: string;
    requestId: string;
    runId: string;
    artifactId: string;
    item?: {
        id: string;
        expectedResult?: string;
    } | null;
    target?: string | null;
    environment?: string | null;
    commitSha?: string | null;
    targetRevisionId?: string | null;
    targetHash?: string | null;
    recipeHash?: string | null;
    registrationId?: string | null;
    observation?: ExecutionObservation;
    recordedAt: Date;
}): QaEvidenceProvenance {
    return qaEvidenceProvenanceSchema.parse({
        schemaVersion: 1, projectId: input.projectId, requestId: input.requestId, runId: input.runId, artifactId: input.artifactId,
        checklistItemId: input.item?.id || null, expectedResult: input.item?.expectedResult || null,
        target: { url: publicTargetReference(input.target), environment: input.environment || null, revisionId: input.targetRevisionId || null, definitionHash: input.targetHash || null },
        build: { reference: input.commitSha || null, source: input.commitSha ? "DECLARED" : "UNKNOWN" },
        executor: { kind: input.registrationId ? "PLAYWRIGHT" : input.actor.kind === "INTEGRATION" ? "CONNECTED_AGENT" : input.actor.kind, transport: input.actor.transport, registrationId: input.registrationId || null },
        recordedAt: input.recordedAt.toISOString(), observation: input.observation || null, recipeHash: input.recipeHash || null,
    });
}
export function evidenceAssetSnapshot(asset: {
    id: string;
    originalName: string;
    declaredMimeType: string;
    detectedMimeType: string | null;
    sizeBytes: number | null;
    checksumSha256: string;
    evidenceExpiresAt?: Date | null;
}) {
    return { id: asset.id, originalName: asset.originalName, declaredMimeType: asset.declaredMimeType, detectedMimeType: asset.detectedMimeType,
        sizeBytes: asset.sizeBytes, checksumSha256: asset.checksumSha256, evidenceExpiresAt: asset.evidenceExpiresAt?.toISOString() || null };
}
function publicTargetReference(value: string | null | undefined) {
    if (!value)
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
/** A retained receipt alone cannot satisfy a required expired screenshot. */
export function availableEvidenceWhere(now: Date): Prisma.QaEvidenceWhereInput {
    const available: Prisma.QaEvidenceAssetWhereInput = { asset: { is: { status: "READY", OR: [{ evidenceExpiresAt: null }, { evidenceExpiresAt: { gt: now } }] } } };
    return { AND: [{ assets: { every: available } }, { OR: [
        { kind: { not: "SCREENSHOT" } },
        { assets: { some: available } },
        { assets: { none: {} }, externalReference: { not: null } },
    ] }] };
}
