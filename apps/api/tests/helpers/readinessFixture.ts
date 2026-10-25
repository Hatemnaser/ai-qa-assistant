import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, it } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Pool } from 'pg';
import { targetDefinitionSchema } from '@oddpath/qa-execution-contract';
import { assertPostgresIntegrationTarget } from './postgresIntegrationTarget.ts';
const database = assertPostgresIntegrationTarget(process.env);
const { prisma } = await import('../../src/db/prisma.ts');
const { createReadinessRepository } = await import('../../src/modules/readiness/readiness.repository.ts');
const { createReadinessService } = await import('../../src/modules/readiness/readiness.service.ts');
const { createReadinessRouter } = await import('../../src/modules/readiness/readiness.routes.ts');
const { createQaProvenance } = await import('../../src/modules/qa-requests/qa-evidence-provenance.ts');
const { hashCanonicalJson } = await import('../../src/lib/canonical-json.ts');
const { hashSessionToken } = await import('../../src/modules/auth/auth.security.ts');
const { requireAuth } = await import('../../src/modules/auth/auth.middleware.ts');
const { csrfProtection, createCsrfToken } = await import('../../src/middleware/csrf.middleware.ts');
const { errorHandler } = await import('../../src/middleware/error.middleware.ts');
const { env } = await import('../../src/config/env.ts');
const prefix = 'readiness-'+randomUUID(), ownerId = prefix+'-owner', otherId = prefix+'-other', projectId = prefix+'-project';
const pool = new Pool({ connectionString: database.connectionString });
let time = new Date(), deployed = 'build-1', unavailable = false, sequence = 0;
const clock = () => time, repo = createReadinessRepository(prisma, clock), probe = { dns: async () => [], https: async () => { if (unavailable) throw Error('simulated endpoint outage'); return JSON.stringify({ schemaVersion: 1, reference: deployed }); } };
const service = createReadinessService(repo, probe, clock), advance = (ms = 1000) => { time = new Date(time.getTime()+ms); };
before(async () => { await prisma.user.createMany({ data: [{ id: ownerId, email: ownerId+'@example.test', emailVerifiedAt: time }, { id: otherId, email: otherId+'@example.test', emailVerifiedAt: time }] }); await prisma.project.create({ data: { id: projectId, ownerId, name: prefix } }); });
after(async () => {
  try {
    await prisma.project.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
    await prisma.storedAsset.deleteMany({ where: { ownerId: { in: [ownerId, otherId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  } finally { await pool.end(); await prisma.$disconnect(); }
});
async function fixture(optional = false) {
  deployed = 'build-1'; unavailable = false; advance(); const key = prefix+'-'+(++sequence);
  const definition = targetDefinitionSchema.parse({ baseUrl: 'https://staging.example.com/', environmentKind: 'STAGING', candidate: { source: 'DECLARED', reference: 'build-1' } });
  const target = await prisma.qaTarget.create({ data: { projectId, label: key } });
  const revision = await prisma.qaTargetRevision.create({ data: { targetId: target.id, revision: 1, definition, targetHash: hashCanonicalJson(definition), authorityUserId: ownerId } });
  const proof = await prisma.qaTargetVerification.create({ data: { revisionId: revision.id, method: 'DNS_TXT', challengeHash: hashCanonicalJson('fixture'), expiresAt: new Date(time.getTime()+60_000), verifiedAt: time, validUntil: new Date(time.getTime()+7*86_400_000) } });
  const request = await prisma.qaRequest.create({ data: { projectId, title: key, objective: 'Verify release', phase: 'READY_TO_RUN' } });
  const context = await prisma.qaContextSnapshot.create({ data: { requestId: request.id, version: 1, payload: {}, sourceManifest: {}, payloadHash: 'fixture', retrievalMode: 'NONE' } });
  const artifact = await prisma.qaArtifact.create({ data: { requestId: request.id, snapshotId: context.id, revision: 1, origin: 'AGENT_PROVIDED', title: key, canonicalJson: {} } });
  const item = await prisma.qaChecklistItem.create({ data: { artifactId: artifact.id, ordinal: 0, title: 'Heading', expectedResult: 'Heading visible', evidenceRequirements: { create: { ordinal: 0, kind: 'TEXT', description: 'Record actual heading', required: true } } }, include: { evidenceRequirements: true } });
  const second = optional ? await prisma.qaChecklistItem.create({ data: { artifactId: artifact.id, ordinal: 1, title: 'Optional', expectedResult: 'Nice to have' } }) : null;
  await prisma.qaRequest.update({ where: { id: request.id }, data: { selectedArtifactId: artifact.id } });
  const scope = { userId: ownerId, projectId, requestId: request.id }, input = { artifactId: artifact.id, targetId: target.id, reference: 'build-1', verifyDeployment: true, freshnessHours: 24, criteria: [{ itemId: item.id, mandatory: true }, ...(second ? [{ itemId: second.id, mandatory: false }] : [])] };
  const candidate = await service.create(scope, input);
  return { scope, input, candidate, target, revision, proof, artifact, request, item, second };
}
async function completed(f: Awaited<ReturnType<typeof fixture>>) {
  advance(); const started = time; advance();
  const run = await prisma.qaRun.create({ data: { requestId: f.request.id, artifactId: f.artifact.id, status: 'RESULTS_SUBMITTED', outcome: 'PASS', commitSha: 'build-1', createdAt: started, startedAt: started, submittedAt: time } });
  const provenance = createQaProvenance({ actor: { kind: 'USER', transport: 'WEB', userId: ownerId }, projectId, requestId: f.request.id, runId: run.id, artifactId: f.artifact.id, item: f.item, target: f.input.targetId ? 'https://staging.example.com/' : null, environment: 'STAGING', commitSha: 'build-1', targetRevisionId: f.revision.id, targetHash: f.revision.targetHash, recordedAt: time });
  await prisma.qaCheckResult.create({ data: { runId: run.id, checklistItemId: f.item.id, status: 'PASS', observedResult: 'Heading visible', provenance, updatedAt: time } });
  const evidence = await prisma.qaEvidence.create({ data: { runId: run.id, checklistItemId: f.item.id, requirementId: f.item.evidenceRequirements[0]!.id, actorKind: 'USER', transport: 'WEB', kind: 'TEXT', textContent: 'Actual heading is visible', provenance, createdAt: time } });
  if (f.second) await prisma.qaCheckResult.create({ data: { runId: run.id, checklistItemId: f.second.id, status: 'FAIL', observedResult: 'Optional defect', updatedAt: time } });
  return { run, evidence };
}
const assess = (f: Awaited<ReturnType<typeof fixture>>, runId: string | null) => service.evaluate(f.scope, f.candidate.id, { runId });


export {fixture,completed,assess,prisma,repo,service,pool,clock,advance,ownerId,otherId,projectId,createReadinessService,createReadinessRepository,createReadinessRouter,hashCanonicalJson,hashSessionToken,createCsrfToken,csrfProtection,requireAuth,errorHandler,env};
export function setTime(at: Date) { time=at; }
