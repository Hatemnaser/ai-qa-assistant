import assert from 'node:assert/strict';
import { it } from 'node:test';
import { evaluateReadiness } from '../src/modules/readiness/readiness.evaluator.ts';
import { readinessCandidateInputSchema } from '@oddpath/qa-execution-contract';
import type { ReadinessCandidate } from '@oddpath/qa-execution-contract';
import type { ReadinessRun } from '../src/modules/readiness/readiness.types.ts';
const at = new Date('2026-10-17T12:00:00Z'), earlier = new Date(at.getTime() - 60_000), frozen = new Date(at.getTime() - 120_000), hash = 'a'.repeat(64);
function fixture() {
  const candidate: ReadinessCandidate = { id: 'candidate', revision: 1, createdAt: frozen.toISOString(), definitionHash: hash, invalidatedAt: null,
    initialDeployment: { status: 'MATCH', reference: 'build-1', responseHash: hash, startedAt: frozen.toISOString(), observedAt: frozen.toISOString() },
    definition: { schemaVersion: 1, artifactId: 'artifact', artifactHash: hash, reference: 'build-1', freshnessHours: 24, versionPath: '/.well-known/oddpath-version',
      target: { targetId: 'target', revisionId: 'revision', revision: 1, targetHash: hash, baseUrl: 'https://qa.example.com/', environmentKind: 'STAGING', candidate: null, authenticationOrigins: [], resourceOrigins: [] }, criteria: [{ itemId: 'item', mandatory: true }] } };
  const provenance = { schemaVersion: 1, projectId: 'project', requestId: 'request', runId: 'run', artifactId: 'artifact', checklistItemId: 'item', expectedResult: 'Visible',
    target: { url: 'https://qa.example.com/', environment: 'STAGING', revisionId: 'revision', definitionHash: hash }, build: { reference: 'build-1', source: 'DECLARED' },
    executor: { kind: 'PLAYWRIGHT', transport: 'REST', registrationId: 'registration' }, recordedAt: earlier.toISOString(), observation: null, recipeHash: hash };
  const run: ReadinessRun = { id: 'run', artifactId: 'artifact', status: 'RESULTS_SUBMITTED', commitSha: 'build-1', startedAt: earlier, createdAt: earlier, submittedAt: earlier,
    execution: { status: 'SUCCEEDED', errorCode: null }, results: [{ checklistItemId: 'item', status: 'PASS', observedResult: 'Visible', provenance, updatedAt: earlier }],
    evidence: [{ id: 'evidence', checklistItemId: 'item', requirementId: 'requirement', kind: 'TEXT', textContent: 'Heading visible', externalReference: null, provenance, createdAt: earlier, assets: [] }] };
  return { candidate, run, projectId: 'project', requestId: 'request', now: at, deployment: { status: 'MATCH' as const, reference: 'build-1', responseHash: hash, startedAt: at.toISOString(), observedAt: at.toISOString() }, targetCurrent: true,
    ownershipUntil: new Date(at.getTime() + 3_600_000), artifactCurrent: true, acceptedRisks: [] as { itemId: string; reason: string }[], items: [{ id: 'item', expectedResult: 'Visible', requirements: [{ id: 'requirement', kind: 'TEXT', required: true }] }] };
}
it('GO needs matching deployment before/after a post-freeze run and all mandatory evidence; never authorizes release', () => {
  const snapshot = evaluateReadiness(fixture()); assert.equal(snapshot.decision, 'GO'); assert.equal(snapshot.releaseAuthorized, false); assert.equal(snapshot.historicalOnly, true);
  assert.equal(snapshot.validUntil, new Date(at.getTime() + 300_000).toISOString()); assert.equal(snapshot.criteria[0]!.evidence.length, 1);
});
it('a changed prepared source blocks GO even when current mandatory checks pass', () => {
  const snapshot = evaluateReadiness({ ...fixture(), sourceConsistent: false });
  assert.equal(snapshot.decision, 'NO_GO'); assert.ok(snapshot.reasons.includes('EVALUATION_STATE_CHANGED'));
  assert.equal(snapshot.releaseAuthorized, false); assert.equal(snapshot.historicalOnly, true);
});
for (const [status, expected] of [['FAIL','FAILED'],['BLOCKED','BLOCKED'],['SKIPPED','MISSING']] as const) it(`mandatory ${status} cannot be waived`, () => {
  const f = fixture(); f.run.results[0]!.status = status; f.acceptedRisks = [{ itemId: 'item', reason: 'Owner wants to ship anyway' }];
  const s = evaluateReadiness(f); assert.equal(s.decision, 'NO_GO'); assert.equal(s.criteria[0]!.reason, expected); assert.equal(s.criteria[0]!.riskAcceptance, null);
});
it('optional failed criterion needs explicit reason; global blockers cannot be waived', () => {
  const f = fixture(); f.candidate.definition.criteria[0]!.mandatory = false; f.run.results[0]!.status = 'FAIL';
  assert.equal(evaluateReadiness(f).decision, 'NO_GO'); f.acceptedRisks = [{ itemId: 'item', reason: 'Optional defect tracked as ISSUE-42' }]; assert.equal(evaluateReadiness(f).decision, 'GO');
  f.deployment.status = 'MISMATCH' as 'MATCH'; assert.equal(evaluateReadiness(f).decision, 'NO_GO');
});
for (const kind of ['missing', 'wrong-target', 'wrong-build', 'deleted-asset', 'expired-asset', 'external-screenshot'] as const) it(`unproven evidence (${kind}) cannot establish GO`, () => {
  const f = fixture(), e = f.run.evidence[0]!;
  if (kind === 'missing') f.run.evidence = [];
  if (kind === 'wrong-target') e.provenance = { ...(e.provenance as object), target: { url: 'https://other.example.com/', environment: 'STAGING', revisionId: 'other', definitionHash: hash } };
  if (kind === 'wrong-build') e.provenance = { ...(e.provenance as object), build: { reference: 'old-build', source: 'DECLARED' } };
  if (kind === 'deleted-asset') e.assets = [{ asset: null, unavailableReason: 'DELETED' }];
  if (kind === 'expired-asset') e.assets = [{ asset: { status: 'READY', checksumSha256: hash, evidenceExpiresAt: at }, unavailableReason: null }];
  if (kind === 'external-screenshot') { e.kind = 'SCREENSHOT'; e.externalReference = 'https://image.example.com/receipt'; }
  assert.equal(evaluateReadiness(f).decision, 'NO_GO');
});
it('freshness uses strict boundaries and minimum dependency expiry', () => {
  const f = fixture(); f.run.evidence[0]!.assets = [{ asset: { status: 'READY', checksumSha256: hash, evidenceExpiresAt: new Date(at.getTime() + 1000) }, unavailableReason: null }];
  assert.equal(evaluateReadiness(f).validUntil, new Date(at.getTime() + 1000).toISOString());
  // Isolate expiry from the independent before-freeze rejection.
  f.candidate.createdAt = new Date(at.getTime() - 25 * 3_600_000).toISOString();
  f.run.results[0]!.updatedAt = new Date(at.getTime() - 86_400_000); assert.equal(evaluateReadiness(f).criteria[0]!.reason, 'STALE');
});
it('pre-freeze runs, null provenance, unconfirmed execution and stale deployment fail closed', () => {
  const f = fixture(); f.run.createdAt = new Date(frozen.getTime() - 1); assert.ok(evaluateReadiness(f).reasons.includes('RUN_BEFORE_FREEZE'));
  f.run.createdAt = earlier; f.run.results[0]!.provenance = null; assert.equal(evaluateReadiness(f).criteria[0]!.reason, 'PROVENANCE_MISSING');
  f.run.execution!.status = 'STOP_REQUESTED'; assert.ok(evaluateReadiness(f).reasons.includes('EXECUTION_ERROR'));
  f.deployment.startedAt = f.deployment.observedAt = new Date(at.getTime() - 300_000).toISOString(); assert.ok(evaluateReadiness(f).reasons.includes('DEPLOYMENT_STALE'));
});
it('a declaration without initial deployment verification is never verified-release GO', () => {
  const f = fixture(); f.candidate.initialDeployment.status = 'NOT_CONFIGURED'; assert.equal(evaluateReadiness(f).decision, 'NO_GO');
});
it('v2 build provenance can qualify without a legacy commitSha column, but conflicting or missing provenance cannot', () => {
  const f=fixture();f.run.commitSha=null;assert.equal(evaluateReadiness(f).decision,'GO');
  f.run.results[0]!.provenance=null;assert.equal(evaluateReadiness(f).decision,'NO_GO');
  f.run.commitSha='other-build';assert.ok(evaluateReadiness(f).reasons.includes('BUILD_MISMATCH'));
});
it('snapshot fingerprints include evidence and result timestamp changes', () => {
  const f = fixture(), first = evaluateReadiness(f); f.run.evidence[0]!.createdAt = new Date(earlier.getTime() + 1); f.run.results[0]!.updatedAt = new Date(earlier.getTime() + 1);
  const next = evaluateReadiness(f); assert.notEqual(first.criteria[0]!.evidence[0]!.recordHash, next.criteria[0]!.evidence[0]!.recordHash); assert.notEqual(first.criteria[0]!.resultHash, next.criteria[0]!.resultHash);
});
it('a deployment observation made before the run finished cannot qualify that run',()=>{
  const f=fixture();f.now=new Date(at.getTime()+1000);f.deployment.observedAt=f.now.toISOString();f.run.submittedAt=new Date(at.getTime()+500);
  assert.equal(evaluateReadiness(f).decision,'NO_GO');
});
it('candidate input rejects duplicate/empty/all-optional criteria, excessive freshness, URLs and supplied GO', () => {
  const base = { artifactId: 'artifact', targetId: 'target', reference: 'build', verifyDeployment: true, freshnessHours: 24, criteria: [{ itemId: 'item', mandatory: true }] };
  assert.ok(readinessCandidateInputSchema.safeParse(base).success);
  for (const change of [{ criteria: [] }, { criteria: [...base.criteria, ...base.criteria] }, { criteria: [{ itemId: 'item', mandatory: false }] }, { freshnessHours: 25 }, { versionPath: 'https://127.0.0.1' }, { decision: 'GO' }]) assert.equal(readinessCandidateInputSchema.safeParse({ ...base, ...change }).success, false);
});
