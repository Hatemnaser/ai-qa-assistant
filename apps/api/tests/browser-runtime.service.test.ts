import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { describe, it } from 'node:test';
import { createBrowserRuntimeService } from '../src/modules/browser-runtime/browser-runtime.service.ts';
import type { BrowserRuntimeRepository } from '../src/modules/browser-runtime/browser-runtime.types.ts';

const NOW = new Date('2026-10-11T12:00:00.000Z'), KEY = 'a'.repeat(64);
const row = { runtimeId: '38d82555-5606-4103-9ead-3701a44c2ae4', state: 'LIVE', stopRequestedAt: null as Date | null, exitObservedAt: null as Date | null,
  loginPhase: 'NONE', execution: { id: 'execution-1', status: 'RUNNING', deadlineAt: new Date(NOW.getTime() + 600_000), leaseExpiresAt: new Date(NOW.getTime() + 45_000), authorization: { bindingHash: 'b'.repeat(64) } } };
function fixture(overrides: Partial<typeof row> = {}) {
  const repository = { async owned(userId: string, projectId: string) {
    if (userId !== 'owner-1' || projectId !== 'project-1') throw Object.assign(new Error('Missing'), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
    return { ...row, ...overrides };
  } };
  return createBrowserRuntimeService({ repository, enabled: true, signingKey: KEY, viewerOrigin: 'https://browser.example.com', now: () => NOW });
}
describe('owner browser supervision service', () => {
  it('pauses ordinary viewing during sign-in and requires an independently enabled human capability', async () => {
    await assert.rejects(fixture({loginPhase:'LOGIN'} as Partial<typeof row>).viewer('owner-1','project-1','execution-1'),{code:'BROWSER_CAPTURE_PAUSED'});
    await assert.rejects(fixture().loginViewer('owner-1','project-1','execution-1'),{code:'BROWSER_LOGIN_NOT_ACTIVE'});
  });
  it('checks current owner/control authority before minting a bounded login grant',async()=>{
    const epoch='35789625-a3de-441e-b4a2-c5d416f4f6fb';let checked=false;
    const manual={...row,loginPhase:'LOGIN',loginEpoch:epoch,loginDeadlineAt:new Date(NOW.getTime()+30000),execution:{...row.execution,status:'CLAIMED'}};
    const service=createBrowserRuntimeService({enabled:true,manualEnabled:true,signingKey:KEY,viewerOrigin:'https://browser.example.com',now:()=>NOW,
      repository:{owned:async()=>manual,loginOwned:async(user,project,id,control,action)=>{assert.equal(user,'owner-1');assert.equal(project,'project-1');assert.equal(control,epoch);assert.equal(action,'CHECK');checked=true;}}});
    const result=await service.loginViewer('owner-1','project-1','execution-1'),grant=JSON.parse(Buffer.from(new URL(result.url).hash.slice(1).split('.')[0],'base64url').toString());
    assert.equal(checked,true);assert.equal(grant.mode,'LOGIN');assert.equal(grant.controlEpoch,epoch);assert.equal(grant.expiresAt,manual.loginDeadlineAt.getTime());
    assert.equal(JSON.stringify(grant).includes('password'),false);
  });
  it('keeps managed runtime inaccessible by default', async () => {
    const service = createBrowserRuntimeService({ repository: {} as BrowserRuntimeRepository, signingKey: '', viewerOrigin: '' });
    await assert.rejects(service.status('owner-1','project-1','execution-1'), { code: 'BROWSER_RUNTIME_NOT_ACTIVE' });
  });
  it('issues a signed 60-second view-only grant bound to project, owner, runtime and exact approval', async () => {
    const result = await fixture().viewer('owner-1','project-1','execution-1');
    const [payload, signature] = new URL(result.url).hash.slice(1).split('.');
    assert.equal(signature, createHmac('sha256', Buffer.from(KEY, 'hex')).update(payload).digest('base64url'));
    const grant = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    assert.equal(grant.ownerId, 'owner-1'); assert.equal(grant.projectId, 'project-1'); assert.equal(grant.executionId, 'execution-1');
    assert.equal(grant.runtimeId, row.runtimeId); assert.equal(grant.bindingHash, row.execution.authorization.bindingHash);
    assert.equal(grant.mode, 'VIEW'); assert.equal(grant.expiresAt, NOW.getTime() + 60_000);
    assert.equal(JSON.stringify(grant).includes(KEY), false);
  });
  it('rejects other owners and project scopes before issuing any viewer grant', async () => {
    await assert.rejects(fixture().viewer('other','project-1','execution-1'), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
    await assert.rejects(fixture().viewer('owner-1','other','execution-1'), { code: 'BROWSER_RUNTIME_NOT_FOUND' });
  });
  it('rejects stopped and lease-expired viewers without converting them into Stop confirmation', async () => {
    await assert.rejects(fixture({ state: 'STOP_REQUESTED' }).viewer('owner-1','project-1','execution-1'), { code: 'BROWSER_RUNTIME_UNAVAILABLE' });
    await assert.rejects(fixture({ execution: { ...row.execution, leaseExpiresAt: NOW } }).viewer('owner-1','project-1','execution-1'), { code: 'BROWSER_RUNTIME_UNAVAILABLE' });
    const status = await fixture({ state: 'STOP_UNCONFIRMED', stopRequestedAt: NOW }).status('owner-1','project-1','execution-1');
    assert.equal(status.terminationProof, null); assert.equal(status.confirmedAt, null);
  });
});
