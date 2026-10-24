import { z } from 'zod';
import { readinessCandidateInputSchema, readinessEvaluationInputSchema, type DeploymentObservation } from '@oddpath/qa-execution-contract';
import { AppError } from '../../lib/errors.js';
import { hashCanonicalJson } from '../../lib/canonical-json.js';
import { targetProofProbe } from '../qa-targets/qa-targets.proof.js';
import { readinessRepository } from './readiness.repository.js';
import type { ReadinessRepository, ReadinessScope } from './readiness.types.js';

const versionDocument = z.object({ schemaVersion: z.literal(1), reference: z.string().min(1).max(240) }).strict();
export function createReadinessService(repository: ReadinessRepository, probe = targetProofProbe, now = () => new Date()) {
  let inFlight = 0;
  async function observe(url: string, reference: string, configured: boolean): Promise<DeploymentObservation> {
    const startedAt = now().toISOString();
    const empty = (status: DeploymentObservation['status']): DeploymentObservation => ({ status, reference: null, responseHash: null, startedAt, observedAt: now().toISOString() });
    if (!configured) return empty('NOT_CONFIGURED');
    if (inFlight >= 2) throw new AppError('Deployment verification is busy.', 429, 'READINESS_BUSY');
    inFlight++;
    try {
      // The existing HTTPS probe pins a public DNS address, rejects redirects,
      // bounds time/bytes, validates TLS, and sends no application credentials.
      const result = versionDocument.parse(JSON.parse(await probe.https(new URL('/.well-known/oddpath-version', url).href)));
      return { status: result.reference === reference ? 'MATCH' : 'MISMATCH', reference: result.reference, responseHash: hashCanonicalJson(result), startedAt, observedAt: now().toISOString() };
    } catch { return empty('UNAVAILABLE'); }
    finally { inFlight--; }
  }
  return {
    list: (scope: ReadinessScope) => repository.list(scope),
    async create(scope: ReadinessScope, raw: unknown) {
      const input = readinessCandidateInputSchema.parse(raw);
      const prepared = await repository.prepare(scope, input.targetId);
      const deployment = await observe(prepared.targetUrl, input.reference, input.verifyDeployment);
      return repository.create(scope, input, deployment, prepared.targetRevisionId);
    },
    async evaluate(scope: ReadinessScope, candidateId: string, raw: unknown) {
      const input = readinessEvaluationInputSchema.parse(raw);
      // The preparation resolves after COMMIT, including any wait for QA writers.
      // Never hold its database locks across the external version request.
      const preparation = await repository.prepareEvaluation(scope, candidateId, input), candidate = preparation.candidate;
      const deployment = preparation.canProbe ? await observe(candidate.definition.target.baseUrl, candidate.definition.reference, true)
        : { status: 'UNAVAILABLE' as const, reference: null, responseHash: null, startedAt: now().toISOString(), observedAt: now().toISOString() };
      // Preserve a known deployment change even if saving the assessment later
      // fails. No second provider/probe call is needed for this accounting-free write.
      if (deployment.status === 'MISMATCH') await repository.invalidate(scope, candidateId);
      return repository.evaluate(scope, candidateId, input, deployment, preparation);
    },
  };
}
export const readinessService = createReadinessService(readinessRepository);
