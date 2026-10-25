import { z } from 'zod';
import { boundedIdSchema, isoDateTimeSchema, sha256HexSchema } from './common.js';
import { targetSnapshotV2Schema } from './target.js';

export const readinessCriterionSchema = z.object({ itemId: boundedIdSchema, mandatory: z.boolean() }).strict();
export const readinessCandidateInputSchema = z.object({
  artifactId: boundedIdSchema, targetId: boundedIdSchema,
  reference: z.string().trim().min(1).max(240),
  // Same-origin well-known document only. No arbitrary URL, query, or credential.
  verifyDeployment: z.boolean(),
  freshnessHours: z.number().int().min(1).max(24).default(24),
  criteria: z.array(readinessCriterionSchema).min(1).max(100),
}).strict().refine(v => new Set(v.criteria.map(c => c.itemId)).size === v.criteria.length, 'Duplicate criteria.')
  .refine(v => v.criteria.some(c => c.mandatory), 'At least one mandatory criterion is required.');
export const readinessDefinitionSchema = z.object({
  schemaVersion: z.literal(1), artifactId: boundedIdSchema, artifactHash: sha256HexSchema,
  target: targetSnapshotV2Schema, reference: z.string().min(1).max(240),
  versionPath: z.literal('/.well-known/oddpath-version').nullable(),
  freshnessHours: z.number().int().min(1).max(24), criteria: z.array(readinessCriterionSchema).min(1).max(100),
}).strict();
export const deploymentObservationSchema = z.object({
  status: z.enum(['MATCH', 'MISMATCH', 'UNAVAILABLE', 'NOT_CONFIGURED']),
  reference: z.string().max(240).nullable(), responseHash: sha256HexSchema.nullable(), startedAt: isoDateTimeSchema, observedAt: isoDateTimeSchema,
}).strict().refine(v => Date.parse(v.startedAt) <= Date.parse(v.observedAt), 'Deployment observation times are reversed.');
export const readinessReasonSchema = z.enum(['PASS', 'FAILED', 'BLOCKED', 'MISSING', 'STALE', 'WRONG_SCOPE', 'BEFORE_FREEZE', 'BUILD_MISMATCH', 'PROVENANCE_MISSING', 'EVIDENCE_MISSING', 'EVIDENCE_UNAVAILABLE']);
export const readinessEvaluationInputSchema = z.object({
  runId: boundedIdSchema.nullable(),
  acceptedRisks: z.array(z.object({ itemId: boundedIdSchema, reason: z.string().trim().min(10).max(1000) }).strict()).max(100).default([]),
}).strict().refine(v => new Set(v.acceptedRisks.map(r => r.itemId)).size === v.acceptedRisks.length, 'Duplicate risk decisions.');
export const readinessSnapshotSchema = z.object({
  schemaVersion: z.literal(1), candidateId: boundedIdSchema, candidateHash: sha256HexSchema,
  projectId: boundedIdSchema, requestId: boundedIdSchema, runId: boundedIdSchema.nullable(),
  evaluatedAt: isoDateTimeSchema, validUntil: isoDateTimeSchema,
  decision: z.enum(['GO', 'NO_GO']), releaseAuthorized: z.literal(false),
  historicalOnly: z.literal(true), reasons: z.array(z.string().max(120)).max(30),
  // Optional for historical snapshots produced before the consistency fence.
  sourceHash: sha256HexSchema.optional(), preparedSourceHash: sha256HexSchema.optional(),
  deployment: deploymentObservationSchema,
  criteria: z.array(z.object({ itemId: boundedIdSchema, mandatory: z.boolean(), reason: readinessReasonSchema,
    evidence: z.array(z.object({ id: boundedIdSchema, recordHash: sha256HexSchema }).strict()).max(240),
    resultHash: sha256HexSchema.nullable(), riskAcceptance: z.string().max(1000).nullable() }).strict()).max(100),
}).strict();
export const readinessCandidateSchema = z.object({
  id: boundedIdSchema, revision: z.number().int().positive(), createdAt: isoDateTimeSchema,
  definition: readinessDefinitionSchema, definitionHash: sha256HexSchema,
  initialDeployment: deploymentObservationSchema, invalidatedAt: isoDateTimeSchema.nullable(),
}).strict();
export type ReadinessCandidateInput = z.infer<typeof readinessCandidateInputSchema>;
export type ReadinessDefinition = z.infer<typeof readinessDefinitionSchema>;
export type DeploymentObservation = z.infer<typeof deploymentObservationSchema>;
export type ReadinessEvaluationInput = z.infer<typeof readinessEvaluationInputSchema>;
export type ReadinessSnapshot = z.infer<typeof readinessSnapshotSchema>;
export type ReadinessCandidate = z.infer<typeof readinessCandidateSchema>;
