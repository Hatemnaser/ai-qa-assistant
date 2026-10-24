import { deploymentObservationSchema, readinessCandidateSchema, readinessDefinitionSchema, readinessSnapshotSchema, type DeploymentObservation, type ReadinessEvaluationInput } from '@oddpath/qa-execution-contract';
import { prisma } from '../../db/prisma.js';
import { Prisma } from '../../generated/prisma/client.js';
import { hashCanonicalJson } from '../../lib/canonical-json.js';
import { AppError } from '../../lib/errors.js';
import { lockQaSessionScope } from '../test-sessions/test-sessions.guard.js';
import { lockQaTarget } from '../qa-targets/qa-targets.repository.js';
import { targetSnapshot } from '../qa-targets/qa-targets.binding.js';
import { evaluateReadiness } from './readiness.evaluator.js';
import type { ReadinessRepository, ReadinessScope } from './readiness.types.js';

const missing = () => new AppError('Readiness resource was not found.', 404, 'READINESS_NOT_FOUND');
const conflict = (message: string) => new AppError(message, 409, 'READINESS_CONFLICT');
async function owned(tx: Prisma.TransactionClient, scope: ReadinessScope) {
  const request = await tx.qaRequest.findFirst({ where: { id: scope.requestId, projectId: scope.projectId, project: { ownerId: scope.userId } } });
  if (!request) throw missing();
  return request;
}
async function lockScope(tx: Prisma.TransactionClient, scope: ReadinessScope) {
  await lockQaSessionScope(tx, scope.requestId);
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-request:${scope.requestId}`}, 0))`;
  return owned(tx, scope);
}
async function currentTarget(tx: Prisma.TransactionClient, projectId: string, targetId: string) {
  const target = await tx.qaTarget.findFirst({ where: { id: targetId, projectId } });
  if (!target) throw missing();
  const revision = await tx.qaTargetRevision.findUnique({ where: { targetId_revision: { targetId, revision: target.currentRevision } } });
  if (!revision) throw missing();
  return targetSnapshot(revision);
}
async function ownership(tx: Prisma.TransactionClient, revisionId: string) {
  return tx.qaTargetVerification.findFirst({ where: { revisionId, verifiedAt: { not: null } }, orderBy: [{ validUntil: 'desc' }, { id: 'asc' }], select: { id: true, verifiedAt: true, validUntil: true } });
}
const itemsInclude = { orderBy: { ordinal: 'asc' as const }, include: { evidenceRequirements: { orderBy: { ordinal: 'asc' as const } } } };
function artifactHash(a: { canonicalJson: unknown; items: { id: string; expectedResult: string; evidenceRequirements: { id: string; kind: string; required: boolean }[] }[] }) {
  return hashCanonicalJson({ canonicalJson: a.canonicalJson, items: a.items.map(i => ({ id: i.id, expectedResult: i.expectedResult, requirements: i.evidenceRequirements.map(r => ({ id: r.id, kind: r.kind, required: r.required })) })) });
}
function candidateDto(row: { id: string; revision: number; createdAt: Date; definition: unknown; definitionHash: string; initialDeployment: unknown; invalidatedAt: Date | null }) {
  const definition = readinessDefinitionSchema.parse(row.definition);
  if (hashCanonicalJson(definition) !== row.definitionHash) throw conflict('Candidate integrity check failed.');
  return readinessCandidateSchema.parse({ ...row, definition, createdAt: row.createdAt.toISOString(), invalidatedAt: row.invalidatedAt?.toISOString() || null });
}
const candidateSelect = { id: true, revision: true, createdAt: true, definition: true, definitionHash: true, initialDeployment: true, invalidatedAt: true } as const;

export function createReadinessRepository(database: typeof prisma = prisma, clock?: () => Date): ReadinessRepository {
  async function now(tx: Prisma.TransactionClient) { return clock ? clock() : (await tx.$queryRaw<{ now: Date }[]>`SELECT clock_timestamp() AS now`)[0]!.now; }
  async function sources(tx: Prisma.TransactionClient, scope: ReadinessScope, candidateId: string, input: ReadinessEvaluationInput) {
    const request = await lockScope(tx, scope);
    const row = await tx.qaReadinessCandidate.findFirst({ where: { id: candidateId, requestId: request.id }, select: candidateSelect });
    if (!row) throw missing();
    const candidate = candidateDto(row), definition = candidate.definition;
    for (const risk of input.acceptedRisks) if (!definition.criteria.some(c => c.itemId === risk.itemId && !c.mandatory)) throw conflict('Mandatory or unknown criteria cannot be waived.');
    await lockQaTarget(tx, definition.target.targetId);
    const target = await currentTarget(tx, scope.projectId, definition.target.targetId), proof = await ownership(tx, target.revisionId);
    const artifact = await tx.qaArtifact.findFirst({ where: { id: definition.artifactId, requestId: request.id }, include: { items: itemsInclude } });
    const runInclude = {
      results: { orderBy: { id: 'asc' as const }, take: 101 },
      evidence: { orderBy: { id: 'asc' as const }, take: 241, include: { assets: { orderBy: { id: 'asc' as const }, include: { asset: { select: { id: true, status: true, evidenceExpiresAt: true, checksumSha256: true } } } } } },
      executionJob: { select: { id: true, status: true, errorCode: true, completedAt: true } },
    };
    const readRun = () => input.runId ? tx.qaRun.findFirst({ where: { id: input.runId, requestId: request.id }, include: runInclude }) : Promise.resolve(null);
    let run = await readRun();
    if (input.runId && !run) throw missing();
    if (run && (run.results.length > 100 || run.evidence.length > 240)) throw conflict('Run exceeds readiness limits.');
    // QA writers already hold the request lock. Cleanup instead owns asset
    // locks: take those in sorted order, then refresh their rows under the lock.
    // This order matches request -> target -> asset in the existing QA writer.
    const assetIds = [...new Set(run?.evidence.flatMap(e => e.assets.flatMap(a => a.assetId ? [a.assetId] : [])) || [])].sort();
    for (const assetId of assetIds) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:asset:${assetId}`}, 0))`;
    if (assetIds.length) run = await readRun();
    if (await tx.qaReadinessEvaluation.count({ where: { candidateId } }) >= 100) throw conflict('Evaluation history limit reached for this candidate.');
    const targetCurrent = target.revisionId === definition.target.revisionId && target.targetHash === definition.target.targetHash;
    return { request, candidate, target, proof, artifact, run, targetCurrent };
  }
  type Sources = Awaited<ReturnType<typeof sources>>;
  function fingerprint(scope: ReadinessScope, input: ReadinessEvaluationInput, state: Sources) {
    // Include monotonic request/run revisions as well as exact result/evidence
    // content, asset availability, criteria, target, ownership and risk policy.
    // Normalize Dates before the generic canonical JSON sorter.
    return hashCanonicalJson(JSON.parse(JSON.stringify({ scope, input, ...state })));
  }
  function policy(scope: ReadinessScope, input: ReadinessEvaluationInput, state: Sources, at: Date, deployment: DeploymentObservation, sourceConsistent = true, preparedAt?: string) {
    const { candidate, request, artifact, run, proof, targetCurrent } = state;
    return evaluateReadiness({ candidate, projectId: scope.projectId, requestId: request.id,
      items: artifact?.items.map(i => ({ id: i.id, expectedResult: i.expectedResult, requirements: i.evidenceRequirements })) || [],
      run: run ? { ...run, execution: run.executionJob } : null, now: at, deployment,
      targetCurrent, ownershipUntil: proof?.validUntil || null, artifactCurrent: !!artifact && request.selectedArtifactId === artifact.id && artifactHash(artifact) === candidate.definition.artifactHash,
      acceptedRisks: input.acceptedRisks, sourceConsistent, preparedAt });
  }
  async function invalidateChangedTarget(tx: Prisma.TransactionClient, state: Sources, at: Date) {
    if (!state.targetCurrent && !state.candidate.invalidatedAt) {
      await tx.qaReadinessCandidate.updateMany({ where: { id: state.candidate.id, invalidatedAt: null }, data: { invalidatedAt: at } });
      state.candidate.invalidatedAt = at.toISOString();
    }
  }
  return {
    async prepare(scope, targetId) {
      return database.$transaction(async tx => {
        await owned(tx, scope);
        const target = await currentTarget(tx, scope.projectId, targetId), proof = await ownership(tx, target.revisionId);
        if (!proof?.validUntil || proof.validUntil <= await now(tx)) throw conflict('Verify ownership before probing the deployment.');
        return { targetUrl: target.baseUrl, targetRevisionId: target.revisionId };
      });
    },
    async create(scope, input, deployment, preparedRevisionId) {
      return database.$transaction(async tx => {
        const request = await lockScope(tx, scope);
        await lockQaTarget(tx, input.targetId);
        const target = await currentTarget(tx, scope.projectId, input.targetId);
        if (target.revisionId !== preparedRevisionId) throw conflict('Target changed during deployment verification.');
        const artifact = await tx.qaArtifact.findFirst({ where: { id: input.artifactId, requestId: request.id }, include: { items: itemsInclude } });
        if (!artifact || request.selectedArtifactId !== artifact.id) throw conflict('Select the current checklist before freezing criteria.');
        if (artifact.items.length !== input.criteria.length || artifact.items.some(i => !input.criteria.some(c => c.itemId === i.id))) throw conflict('Every checklist item needs an explicit criterion.');
        if (target.candidate && target.candidate.reference !== input.reference) throw conflict('Candidate reference differs from the target revision.');
        if (await tx.qaRun.count({ where: { requestId: request.id, status: { in: ['CREATED', 'ACTIVE'] } } })) throw conflict('Freeze criteria before starting a run.');
        const count = await tx.qaReadinessCandidate.count({ where: { requestId: request.id } });
        if (count >= 20) throw conflict('Candidate limit reached for this request.');
        const proof = await ownership(tx, target.revisionId), at = await now(tx);
        if (input.verifyDeployment && (!proof?.validUntil || proof.validUntil <= at)) throw conflict('Ownership proof expired before candidate creation.');
        const initial = deploymentObservationSchema.parse(deployment);
        if (Date.parse(initial.observedAt) > at.getTime() || Date.parse(initial.startedAt) + 300_000 <= at.getTime()) throw conflict('Deployment observation expired.');
        const definition = readinessDefinitionSchema.parse({ schemaVersion: 1, artifactId: artifact.id, artifactHash: artifactHash(artifact), target, reference: input.reference, freshnessHours: input.freshnessHours, criteria: input.criteria, versionPath: input.verifyDeployment ? '/.well-known/oddpath-version' : null });
        // A replacement is a new frozen candidate. Older snapshots remain history only.
        await tx.qaReadinessCandidate.updateMany({ where: { requestId: request.id, invalidatedAt: null }, data: { invalidatedAt: at } });
        const row = await tx.qaReadinessCandidate.create({ data: { requestId: request.id, revision: count + 1, definition: definition as Prisma.InputJsonValue, definitionHash: hashCanonicalJson(definition), initialDeployment: initial as Prisma.InputJsonValue, createdAt: at, invalidatedAt: initial.status === 'MISMATCH' ? at : null }, select: candidateSelect });
        return candidateDto(row);
      }, { timeout: 15_000 });
    },
    async list(scope) {
      return database.$transaction(async tx => {
        await owned(tx, scope);
        const rows = await tx.qaReadinessCandidate.findMany({ where: { requestId: scope.requestId }, orderBy: { revision: 'desc' }, take: 20, select: { ...candidateSelect, evaluations: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1, select: { id: true, snapshot: true, snapshotHash: true } } } });
        return { candidates: rows.map(({ evaluations: _, ...r }) => candidateDto(r)), evaluations: rows.flatMap(r => r.evaluations.map(e => {
          const snapshot = readinessSnapshotSchema.parse(e.snapshot);
          if (hashCanonicalJson(snapshot) !== e.snapshotHash) throw conflict('Snapshot integrity check failed.');
          return { ...e, snapshot };
        })) };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    },
    async candidate(scope, candidateId) {
      await owned(database, scope);
      const row = await database.qaReadinessCandidate.findFirst({ where: { id: candidateId, requestId: scope.requestId }, select: candidateSelect });
      if (!row) throw missing();
      return candidateDto(row);
    },
    async invalidate(scope, candidateId) {
      await database.$transaction(async tx => {
        await lockScope(tx, scope);
        const row = await tx.qaReadinessCandidate.findFirst({ where: { id: candidateId, requestId: scope.requestId } });
        if (!row) throw missing();
        await tx.qaReadinessCandidate.updateMany({ where: { id: candidateId, invalidatedAt: null }, data: { invalidatedAt: await now(tx) } });
      });
    },
    async prepareEvaluation(scope, candidateId, input) {
      return database.$transaction(async tx => {
        const state = await sources(tx, scope, candidateId, input), at = await now(tx);
        await invalidateChangedTarget(tx, state, at);
        // Reuse the acceptance policy without inventing deployment proof.
        // Only the expected UNVERIFIED blocker may be ignored for admission to
        // the probe; missing/failed/stale QA and unaccepted risks skip HTTP.
        const preview = policy(scope, input, state, at, { status: 'UNAVAILABLE', reference: null, responseHash: null, startedAt: at.toISOString(), observedAt: at.toISOString() });
        const canProbe = !!state.candidate.definition.versionPath && preview.reasons.every(r => r === 'DEPLOYMENT_UNVERIFIED')
          && preview.criteria.every(c => c.reason === 'PASS' || !c.mandatory && !!c.riskAcceptance);
        return { candidate: state.candidate, sourceHash: fingerprint(scope, input, state), preparedAt: at.toISOString(), canProbe };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    },
    async evaluate(scope, candidateId, input, deployment, preparation) {
      return database.$transaction(async tx => {
        const state = await sources(tx, scope, candidateId, input), at = await now(tx);
        await invalidateChangedTarget(tx, state, at);
        const { candidate } = state;
        if (deployment.status === 'MISMATCH' || (deployment.status === 'MATCH' && deployment.reference !== candidate.definition.reference)) {
          await tx.qaReadinessCandidate.updateMany({ where: { id: candidateId, invalidatedAt: null }, data: { invalidatedAt: at } });
          candidate.invalidatedAt ||= at.toISOString();
        }
        const sourceHash = fingerprint(scope, input, state);
        const sourceConsistent = preparation.candidate.id === candidateId && sourceHash === preparation.sourceHash;
        let snapshot = readinessSnapshotSchema.parse({ ...policy(scope, input, state, at, deployment,
          sourceConsistent && (preparation.canProbe || deployment.status !== 'MATCH'), preparation.preparedAt),
          sourceHash, preparedSourceHash: preparation.sourceHash });
        let snapshotHash = hashCanonicalJson(snapshot);
        const evaluation = await tx.qaReadinessEvaluation.create({ data: { candidateId, snapshot: snapshot as Prisma.InputJsonValue, snapshotHash, createdAt: at }, select: { id: true } });
        // INSERT itself may wait on PostgreSQL. Do not return GO if a bounded
        // dependency expired while persistence waited; source locks still hold.
        const savedAt = await now(tx);
        if (snapshot.decision === 'GO' && Date.parse(snapshot.validUntil) <= savedAt.getTime()) {
          snapshot = readinessSnapshotSchema.parse({ ...policy(scope, input, state, savedAt, deployment, sourceConsistent && preparation.canProbe, preparation.preparedAt), sourceHash, preparedSourceHash: preparation.sourceHash });
          snapshotHash = hashCanonicalJson(snapshot);
          await tx.qaReadinessEvaluation.update({ where: { id: evaluation.id }, data: { snapshot: snapshot as Prisma.InputJsonValue, snapshotHash, createdAt: savedAt } });
        }
        return { ...evaluation, snapshot, snapshotHash };
      // All QA writers share lockScope; target writers share lockQaTarget.
      // READ COMMITTED is deliberate: a snapshot taken before waiting for a
      // target lock must not hide a revision committed while we waited.
      }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 15_000 });
    },
  };
}
export const readinessRepository = createReadinessRepository();
