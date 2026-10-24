import { z } from "zod";
import { boundedIdSchema, isoDateTimeSchema, sha256HexSchema } from "./common.js";
export const QA_ENVIRONMENT_MAX_CHARS = 500;

export function isQaExternalEvidenceReference(value: string | null | undefined): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && !url.username && !url.password;
    } catch { return false; }
}

export function hasQaEvidenceContent(evidence: {kind: string; externalReference?: string | null; assets: readonly unknown[]}): boolean {
    return evidence.kind !== 'SCREENSHOT' || evidence.assets.length > 0 || isQaExternalEvidenceReference(evidence.externalReference);
}
/** Executor observations are claims, never independent deployment verification. */
export const executionObservationSchema = z.object({
    startedAt: isoDateTimeSchema,
    finishedAt: isoDateTimeSchema,
    completedStepRefs: z.array(boundedIdSchema).max(100),
    failedStepRef: boundedIdSchema.nullable(),
}).strict().refine(value => Date.parse(value.startedAt) <= Date.parse(value.finishedAt), "Observation times are reversed.")
    .refine(value => new Set(value.completedStepRefs).size === value.completedStepRefs.length, "Duplicate step references.");
export const qaEvidenceProvenanceSchema = z.object({
    schemaVersion: z.literal(1),
    projectId: boundedIdSchema,
    requestId: boundedIdSchema,
    runId: boundedIdSchema,
    artifactId: boundedIdSchema,
    checklistItemId: boundedIdSchema.nullable(),
    expectedResult: z.string().max(10000).nullable(),
    target: z.object({
        url: z.string().max(2000).nullable(),
        environment: z.string().max(QA_ENVIRONMENT_MAX_CHARS).nullable(),
        revisionId: boundedIdSchema.nullable(),
        definitionHash: sha256HexSchema.nullable(),
    }).strict(),
    build: z.object({ reference: z.string().max(240).nullable(), source: z.enum(["DECLARED", "UNKNOWN"]) }).strict(),
    executor: z.object({ kind: z.enum(["USER", "CONNECTED_AGENT", "PLAYWRIGHT", "SYSTEM"]), transport: z.enum(["WEB", "REST", "MCP", "SYSTEM"]), registrationId: boundedIdSchema.nullable() }).strict(),
    recordedAt: isoDateTimeSchema,
    observation: executionObservationSchema.nullable(),
    recipeHash: sha256HexSchema.nullable(),
}).strict();
export type ExecutionObservation = z.infer<typeof executionObservationSchema>;
export type QaEvidenceProvenance = z.infer<typeof qaEvidenceProvenanceSchema>;
