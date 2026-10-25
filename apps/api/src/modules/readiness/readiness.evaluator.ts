import { qaEvidenceProvenanceSchema, readinessSnapshotSchema, type ReadinessCandidate, type DeploymentObservation, type ReadinessEvaluationInput, type ReadinessSnapshot } from '@oddpath/qa-execution-contract';
import { hashCanonicalJson } from '../../lib/canonical-json.js';
import type { ReadinessItem, ReadinessRun } from './readiness.types.js';

/** Pure, fail-closed policy. A snapshot is an assessment at a time, never release authority. */
export function evaluateReadiness(input: {
  candidate: ReadinessCandidate; projectId: string; requestId: string;
  items: ReadinessItem[]; run: ReadinessRun | null; now: Date; deployment: DeploymentObservation;
  targetCurrent: boolean; ownershipUntil: Date | null; artifactCurrent: boolean;
  acceptedRisks: ReadinessEvaluationInput['acceptedRisks'];
  sourceConsistent?: boolean;
  preparedAt?: string;
}): ReadinessSnapshot {
  const { candidate, run, now, deployment } = input, definition = candidate.definition;
  const frozenAt = Date.parse(candidate.createdAt), cutoff = now.getTime() - definition.freshnessHours * 3_600_000;
  const reasons: string[] = [];
  if (input.sourceConsistent === false) reasons.push('EVALUATION_STATE_CHANGED');
  if (input.preparedAt && Date.parse(deployment.startedAt) < Date.parse(input.preparedAt)) reasons.push('DEPLOYMENT_BEFORE_RESULTS');
  let validUntil = now.getTime() + 300_000;
  const bound = (date: number) => { validUntil = Math.min(validUntil, date); };
  if (candidate.invalidatedAt) reasons.push('CANDIDATE_INVALIDATED');
  if (!input.targetCurrent) reasons.push('TARGET_CHANGED');
  if (!input.artifactCurrent) reasons.push('ARTIFACT_CHANGED');
  if (!input.ownershipUntil || input.ownershipUntil <= now) reasons.push('OWNERSHIP_UNVERIFIED');
  else bound(input.ownershipUntil.getTime());
  if (candidate.initialDeployment.status !== 'MATCH') reasons.push('INITIAL_DEPLOYMENT_UNVERIFIED');
  if (deployment.status !== 'MATCH') reasons.push(deployment.status === 'MISMATCH' ? 'DEPLOYMENT_CHANGED' : 'DEPLOYMENT_UNVERIFIED');
  if (Date.parse(deployment.observedAt) > now.getTime() || Date.parse(deployment.startedAt) + 300_000 <= now.getTime()) reasons.push('DEPLOYMENT_STALE');
  bound(Date.parse(deployment.startedAt) + 300_000);
  // Compare references as well as status; a stored or injected MATCH is not a wildcard.
  if (deployment.status === 'MATCH' && deployment.reference !== definition.reference) reasons.push('DEPLOYMENT_CHANGED');
  if (candidate.initialDeployment.status === 'MATCH' && candidate.initialDeployment.reference !== definition.reference) reasons.push('INITIAL_DEPLOYMENT_UNVERIFIED');
  if (!run) reasons.push('RUN_MISSING');
  else {
    if (run.artifactId !== definition.artifactId) reasons.push('RUN_ARTIFACT_MISMATCH');
    if (!run.startedAt || run.startedAt.getTime() < frozenAt || run.createdAt.getTime() < frozenAt) reasons.push('RUN_BEFORE_FREEZE');
    if (run.status !== 'RESULTS_SUBMITTED' || !run.submittedAt || run.submittedAt > now) reasons.push('RUN_INCOMPLETE');
    // A concurrent finish/result write during the probe or lock wait needs a
    // new observation. A response received later is not a post-test request.
    const observationStart = Date.parse(deployment.startedAt);
    if (run.submittedAt && run.submittedAt.getTime() > observationStart
      || run.results.some(r => r.updatedAt.getTime() > observationStart)
      || run.evidence.some(e => e.createdAt.getTime() > observationStart)) reasons.push('DEPLOYMENT_BEFORE_RESULTS');
    if (run.execution && (run.execution.status !== 'SUCCEEDED' || run.execution.errorCode)) reasons.push('EXECUTION_ERROR');
    // V2 browser runs carry the frozen build in each result/evidence provenance;
    // their legacy commitSha column can be null. Never override a conflicting
    // declared column, and still require exact build provenance per criterion.
    if (run.commitSha !== null && run.commitSha !== definition.reference) reasons.push('BUILD_MISMATCH');
    if (!run.submittedAt || run.submittedAt.getTime() <= cutoff) reasons.push('RUN_STALE');
    else bound(run.submittedAt.getTime() + definition.freshnessHours * 3_600_000);
  }
  function provenanceMatches(value: unknown, item: ReadinessItem) {
    const p = qaEvidenceProvenanceSchema.safeParse(value);
    return p.success && p.data.projectId === input.projectId && p.data.requestId === input.requestId
      && p.data.runId === run?.id && p.data.artifactId === definition.artifactId && p.data.checklistItemId === item.id
      && p.data.expectedResult === item.expectedResult && p.data.target.revisionId === definition.target.revisionId
      && p.data.target.definitionHash === definition.target.targetHash && p.data.target.url === definition.target.baseUrl
      && p.data.build.reference === definition.reference;
  }
  const criteria = definition.criteria.map(criterion => {
    const item = input.items.find(i => i.id === criterion.itemId), result = run?.results.find(r => r.checklistItemId === criterion.itemId);
    let reason: ReadinessSnapshot['criteria'][number]['reason'] = 'PASS';
    const evidence = run?.evidence.filter(e => e.checklistItemId === criterion.itemId) || [];
    const usable = item ? evidence.filter(e => {
      if (e.createdAt.getTime() < frozenAt || e.createdAt > now || e.createdAt.getTime() <= cutoff || !provenanceMatches(e.provenance, item)) return false;
      if (e.assets.some(a => a.unavailableReason || !a.asset || a.asset.status !== 'READY' || (a.asset.evidenceExpiresAt && a.asset.evidenceExpiresAt <= now))) return false;
      if (e.kind === 'SCREENSHOT' && !e.assets.length) return false;
      if (!e.assets.length && !e.textContent?.trim() && !e.externalReference) return false;
      return true;
    }) : [];
    if (!item) reason = 'WRONG_SCOPE';
    else if (!result) reason = 'MISSING';
    else if (result.status === 'FAIL') reason = 'FAILED';
    else if (result.status === 'BLOCKED') reason = 'BLOCKED';
    else if (result.status !== 'PASS') reason = 'MISSING';
    else if (!provenanceMatches(result.provenance, item)) reason = 'PROVENANCE_MISSING';
    else if (result.updatedAt.getTime() < frozenAt) reason = 'BEFORE_FREEZE';
    else if (result.updatedAt > now || result.updatedAt.getTime() <= cutoff) reason = 'STALE';
    else if (!usable.length || item.requirements.some(r => r.required && !usable.some(e => e.requirementId === r.id && e.kind === r.kind))) {
      reason = !evidence.length ? 'EVIDENCE_MISSING' : evidence.some(e => e.createdAt.getTime() <= cutoff) ? 'STALE' : 'EVIDENCE_UNAVAILABLE';
    }
    if (result) bound(result.updatedAt.getTime() + definition.freshnessHours * 3_600_000);
    for (const e of usable) {
      bound(e.createdAt.getTime() + definition.freshnessHours * 3_600_000);
      for (const a of e.assets) if (a.asset?.evidenceExpiresAt) bound(a.asset.evidenceExpiresAt.getTime());
    }
    const accepted = input.acceptedRisks.find(r => r.itemId === criterion.itemId);
    // Canonical JSON hashes include ISO dates; the generic sorter treats Date
    // instances as objects, so normalize these database records first.
    const recordHash = (value: unknown) => hashCanonicalJson(JSON.parse(JSON.stringify(value)));
    return { ...criterion, reason, evidence: usable.map(e => ({ id: e.id, recordHash: recordHash(e) })),
      resultHash: result ? recordHash(result) : null, riskAcceptance: !criterion.mandatory && reason !== 'PASS' ? accepted?.reason || null : null };
  });
  const blocked = reasons.length > 0 || criteria.some(c => c.reason !== 'PASS' && (c.mandatory || !c.riskAcceptance));
  return readinessSnapshotSchema.parse({
    schemaVersion: 1, candidateId: candidate.id, candidateHash: candidate.definitionHash, projectId: input.projectId, requestId: input.requestId,
    runId: run?.id || null, evaluatedAt: now.toISOString(), validUntil: new Date(Math.max(now.getTime(), validUntil)).toISOString(),
    decision: blocked ? 'NO_GO' : 'GO', releaseAuthorized: false, historicalOnly: true, reasons, deployment, criteria,
  });
}
