import type { DeploymentObservation, ReadinessCandidate, ReadinessCandidateInput, ReadinessEvaluationInput, ReadinessSnapshot } from '@oddpath/qa-execution-contract';

export interface ReadinessScope { userId: string; projectId: string; requestId: string }
export interface ReadinessItem { id: string; expectedResult: string; requirements: { id: string; kind: string; required: boolean }[] }
export interface ReadinessRun {
  id: string; artifactId: string; status: string; commitSha: string | null;
  startedAt: Date | null; submittedAt: Date | null; createdAt: Date;
  execution: { status: string; errorCode: string | null } | null;
  results: { checklistItemId: string; status: string; observedResult: string | null; provenance: unknown; updatedAt: Date }[];
  evidence: { id: string; checklistItemId: string | null; requirementId: string | null; kind: string;
    textContent: string | null; externalReference: string | null; provenance: unknown; createdAt: Date;
    assets: { asset: { status: string; evidenceExpiresAt: Date | null; checksumSha256: string } | null; unavailableReason: string | null }[] }[];
}
export interface ReadinessState {
  candidates: ReadinessCandidate[];
  evaluations: { id: string; snapshot: ReadinessSnapshot; snapshotHash: string }[];
}
/** Server-local preparation, returned only after its QA transaction commits. */
export interface ReadinessPreparation {
  candidate: ReadinessCandidate;
  sourceHash: string;
  preparedAt: string;
  canProbe: boolean;
}
export interface ReadinessRepository {
  prepare(scope: ReadinessScope, targetId: string): Promise<{ targetUrl: string; targetRevisionId: string }>;
  create(scope: ReadinessScope, input: ReadinessCandidateInput, deployment: DeploymentObservation, preparedRevisionId: string): Promise<ReadinessCandidate>;
  list(scope: ReadinessScope): Promise<ReadinessState>;
  candidate(scope: ReadinessScope, candidateId: string): Promise<ReadinessCandidate>;
  invalidate(scope: ReadinessScope, candidateId: string): Promise<void>;
  prepareEvaluation(scope: ReadinessScope, candidateId: string, input: ReadinessEvaluationInput): Promise<ReadinessPreparation>;
  evaluate(scope: ReadinessScope, candidateId: string, input: ReadinessEvaluationInput, deployment: DeploymentObservation, preparation: ReadinessPreparation): Promise<ReadinessState['evaluations'][number]>;
}
