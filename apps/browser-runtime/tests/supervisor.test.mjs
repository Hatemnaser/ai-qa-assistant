import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { RuntimeJournal } from '../src/journal.mjs';
import { BrowserSupervisor } from '../src/supervisor.mjs';
import { DockerRuntimeDriver } from '../src/docker-driver.mjs';

const task = { executionId: 'execution-1', projectId: 'project-1', approval: { bindingHash: 'b'.repeat(64) }, deadlineAt: new Date(Date.now() + 600_000).toISOString(),
  profile: { target: { baseUrl: 'https://example.com', resourceOrigins: [], authenticationOrigins: [] } } };
function fixture() {
  let clock = Date.now(); const journal = new RuntimeJournal(':memory:', () => clock), calls = [];
  const driver = { async start(input) { calls.push(['start', input.runtimeId]); }, async endpoint() { return 'http://172.20.1.2:8080'; }, async list() { return []; },
    async stop(runtime) { calls.push(['stop', runtime]); return { processExited: true, observedAt: clock }; } };
  const supervisor = new BrowserSupervisor({ driver, journal, now: () => clock });
  return { journal, calls, driver, supervisor, advance: amount => { clock += amount; }, clock: () => clock };
}
describe('independent browser supervision', () => {
  it('registers the durable allocation before creating physical resources', async () => {
    const f = fixture();
    try {
      const row = await f.supervisor.allocate(task, f.clock()+45000, async reserved => {
        assert.equal(reserved.state,'STARTING');
        assert.equal(f.calls.length,0);
        f.calls.push(['register',reserved.runtime]);
      });
      assert.deepEqual(f.calls.map(call=>call[0]),['register','start']);
      assert.equal(row.state,'LIVE');
    } finally { f.journal.close(); }
  });
  for (const reason of ['registration','stop','expiry']) it(`does not create Docker resources when ${reason} wins before allocation`, async () => {
    const f = fixture();
    try {
      await assert.rejects(f.supervisor.allocate(task,f.clock()+1000,async()=>{
        if(reason==='registration')throw Error('API rejected cancelled job');
        if(reason==='stop')f.journal.requestStop(task.executionId);
        if(reason==='expiry')f.advance(1000);
      }));
      assert.equal(f.calls.some(call=>call[0]==='start'),false);
      assert.equal(f.journal.get(task.executionId).state,'STOPPED');
    } finally { f.journal.close(); }
  });
  for (const stage of ['registration','creation']) it(`keeps cross-process Stop unconfirmed until pending ${stage} settles`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oddpath-runtime-'));
    let workerJournal, reaperJournal, allocation, release, entered;
    const atGate = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    const resources = new Set();
    try {
      const path = join(directory, 'journal.sqlite');
      workerJournal = new RuntimeJournal(path); reaperJournal = new RuntimeJournal(path);
      const driver = { async start(input) { entered(); await gate; resources.add(input.runtimeId); },
        async stop(id) { resources.delete(id); return {processExited:true,observedAt:Date.now()}; }, async list(){return [...resources];} };
      const worker = new BrowserSupervisor({journal:workerJournal,driver}), reaper = new BrowserSupervisor({journal:reaperJournal,driver});
      allocation = worker.allocate(task,Date.now()+45000,async()=>{if(stage==='registration'){entered();await gate;}})
        .then(value=>({value}),error=>({error}));
      await atGate;
      const owner=workerJournal.get(task.executionId).allocationOwner;
      assert.equal(typeof owner,'string');
      await assert.rejects(reaper.stop(task.executionId),/creation is pending/u);
      assert.equal(reaperJournal.get(task.executionId).state,'STOPPING');
      assert.equal(reaperJournal.get(task.executionId).proof,null);
      assert.deepEqual(reaperJournal.unreported(),[]);
      assert.throws(()=>reaperJournal.stopped(task.executionId,{processExited:true,observedAt:Date.now()}),/Termination proof invalid/u);
      workerJournal.releaseAllocation(task.executionId,'foreign-owner');
      assert.equal(workerJournal.get(task.executionId).allocationOwner,owner);
      await assert.rejects(worker.allocate({...task,executionId:'other-execution'},Date.now()+45000),/capacity is busy/u);
      release();
      const result=await allocation;assert.match(result.error?.message??'',/Allocation authority lost/u);
      assert.equal(resources.size,0);
      const proof=await reaper.stop(task.executionId);
      assert.equal(proof.processExited,true);
      assert.equal(reaperJournal.get(task.executionId).state,'STOPPED');
      assert.equal(reaperJournal.get(task.executionId).allocationOwner,null);
    } finally {
      release?.();await allocation;workerJournal?.close();reaperJournal?.close();
      assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(directory,/oddpath-runtime-/u);
      await rm(directory,{recursive:true});
    }
  });
  it('does not promote or return an allocation whose lease expired while start was awaited',async()=>{
    const f=fixture();
    try{
      f.driver.start=async()=>{f.advance(1000);};
      await assert.rejects(f.supervisor.allocate(task,f.clock()+1000),/Allocation authority lost/u);
      assert.equal(f.journal.get(task.executionId).state,'STOPPED');
      assert.equal(f.journal.get(task.executionId).allocationOwner,null);
    }finally{f.journal.close();}
  });
  it('retains the creation fence after an ambiguous Docker mutation failure',async()=>{
    const f=fixture();
    try{
      f.driver.start=async()=>{throw Object.assign(Error('Docker create outcome unknown'),{allocationSettlementUnknown:true});};
      await assert.rejects(f.supervisor.allocate(task,f.clock()+45000),/outcome unknown/u);
      const row=f.journal.get(task.executionId);
      assert.equal(row.state,'STOPPING');assert.equal(typeof row.allocationOwner,'string');assert.equal(row.proof,null);
      await assert.rejects(f.supervisor.recover(),/creation is pending/u);
      assert.equal(f.journal.get(task.executionId).allocationOwner,row.allocationOwner);
    }finally{f.journal.close();}
  });
  it('preserves an unsettled creator across journal reopen and refuses recovery confirmation',async()=>{
    const directory=await mkdtemp(join(tmpdir(),'oddpath-runtime-'));
    let journal;
    try{
      const path=join(directory,'journal.sqlite'),now=Date.now();
      journal=new RuntimeJournal(path);
      journal.reserve({executionId:task.executionId,runtimeId:'runtime-pending',leaseUntil:now+45000,deadline:now+600000,token:'t',projectId:task.projectId,bindingHash:task.approval.bindingHash,allocationOwner:'old-creator'});
      journal.close();journal=new RuntimeJournal(path);
      const supervisor=new BrowserSupervisor({journal,driver:{async stop(){return {processExited:true,observedAt:Date.now()};}}});
      await assert.rejects(supervisor.recover(),/creation is pending/u);
      assert.equal(journal.get(task.executionId).allocationOwner,'old-creator');
      assert.equal(journal.get(task.executionId).state,'STOPPING');assert.equal(journal.get(task.executionId).proof,null);
      assert.deepEqual(journal.unreported(),[]);
    }finally{
      journal?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(directory,/oddpath-runtime-/u);
      await rm(directory,{recursive:true});
    }
  });
  it('marks a timed-out mutating Docker command as unsettled even after an absence cleanup',async()=>{
    const image=`sha256:${'a'.repeat(64)}`;
    const driver=new DockerRuntimeDriver({instanceId:'test',supervisorContainer:'controller',chromeImage:image,egressImage:image,execute:async args=>{
      if(args[0]==='version')return '29.0.0';
      if(args[0]==='network'&&args[1]==='create')throw Object.assign(Error('CLI timeout'),{code:'ETIMEDOUT',killed:true});
      throw Object.assign(Error('absent'),{code:1,stderr:args[0]==='inspect'?'No such object':'No such network'});
    }});
    await assert.rejects(driver.start({executionId:'execution-1',runtimeId:'runtime-1',token:'a'.repeat(64),deadline:Date.now()+600000,leaseUntil:Date.now()+45000,origins:['https://example.com']}),{allocationSettlementUnknown:true});
  });
  for (const failure of [
    { name: 'plain EOF', code: 1, killed: false, signal: null, stderr: 'error during connect: Post "http://docker/networks/create": EOF' },
    { name: 'connection closed', code: 1, stderr: 'write: broken pipe' },
    { name: 'unrecognized transport error', code: 1, stderr: 'transport interrupted' },
    { name: 'empty diagnostic', code: 1, stderr: '' },
    { name: 'daemon-looking diagnostic', code: 1, stderr: 'Error response from daemon: operation failed' },
  ]) it(`retains the creation fence for ${failure.name} regardless of numeric CLI exit status`, async () => {
    const image = `sha256:${'a'.repeat(64)}`, journal = new RuntimeJournal(':memory:');
    const error = Object.assign(new Error(failure.name), failure);
    const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
      execute: async args => {
        if (args[0] === 'version') return '29.0.0';
        if (args[0] === 'network' && args[1] === 'create') throw error;
        throw Object.assign(Error('absent'), { code: 1, stderr: args[0] === 'inspect' ? 'No such object' : 'No such network' });
      } });
    const supervisor = new BrowserSupervisor({ journal, driver });
    try {
      await assert.rejects(supervisor.allocate(task, Date.now() + 45000), caught => caught === error);
      assert.equal(error.allocationSettlementUnknown, true);
      const owner = journal.get(task.executionId).allocationOwner;
      assert.equal(typeof owner, 'string');
      assert.equal(journal.get(task.executionId).state, 'STOPPING');
      assert.equal(journal.get(task.executionId).proof, null);
      assert.deepEqual(journal.unreported(), []);
      await assert.rejects(supervisor.stop(task.executionId), /creation is pending/u);
      assert.equal(journal.get(task.executionId).allocationOwner, owner);
    } finally { journal.close(); }
  });
  for (const operation of ['create', 'network connect', 'start']) it(`fences an ambiguous ${operation} after earlier Docker commands succeeded`, async () => {
    const image = `sha256:${'a'.repeat(64)}`, journal = new RuntimeJournal(':memory:');
    const error = Object.assign(Error('Docker transport failed'), { code: 1, stderr: 'EOF' });
    const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
      execute: async args => {
        if (args[0] === 'version') return '29.0.0';
        if (args[0] === 'inspect' || (args[0] === 'network' && args[1] === 'inspect'))
          throw Object.assign(Error('absent'), { code: 1, stderr: args[0] === 'inspect' ? 'No such object' : 'No such network' });
        if ((args[0] === 'network' ? args.slice(0, 2).join(' ') : args[0]) === operation) throw error;
        return '';
      } });
    try {
      await assert.rejects(new BrowserSupervisor({ journal, driver }).allocate(task, Date.now() + 45000), { allocationSettlementUnknown: true });
      assert.equal(journal.get(task.executionId).state, 'STOPPING');
      assert.equal(journal.get(task.executionId).proof, null);
      assert.deepEqual(journal.unreported(), []);
    } finally { journal.close(); }
  });
  it('settles a read-only Docker preflight failure and confirms cleanup', async () => {
    const image = `sha256:${'a'.repeat(64)}`, journal = new RuntimeJournal(':memory:');
    const error = Object.assign(Error('version request failed'), { code: 1, stderr: 'EOF' });
    const calls = [];
    const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
      execute: async args => {
        calls.push(args);
        if (args[0] === 'version') throw error;
        throw Object.assign(Error('absent'), { code: 1, stderr: args[0] === 'inspect' ? 'No such object' : 'No such network' });
      } });
    try {
      await assert.rejects(new BrowserSupervisor({ journal, driver }).allocate(task, Date.now() + 45000), caught => caught === error);
      assert.equal(error.allocationSettlementUnknown, undefined);
      assert.equal(calls.some(args => ['create', 'start'].includes(args[0]) || args[1] === 'create'), false);
      assert.equal(journal.get(task.executionId).state, 'STOPPED');
      assert.equal(journal.get(task.executionId).allocationOwner, null);
      assert.equal(journal.unreported().length, 1);
    } finally { journal.close(); }
  });
  it('enforces one global allocation and never allocates a completed execution twice', async () => {
    const f = fixture(); await f.supervisor.allocate(task, f.clock() + 45_000);
    await assert.rejects(f.supervisor.allocate({ ...task, executionId: 'execution-2' }, f.clock() + 45_000));
    await f.supervisor.stop(task.executionId);
    await assert.rejects(f.supervisor.allocate(task, f.clock() + 45_000)); f.journal.close();
  });
  it('marks a started recipe durably before steps and rejects a second start', async () => {
    const f = fixture(); await f.supervisor.allocate(task, f.clock() + 45_000);
    f.journal.markStarted(task.executionId); assert.throws(() => f.journal.markStarted(task.executionId));
    assert.equal(f.journal.get(task.executionId).started, 1); f.journal.close();
  });
  it('reaps leases, hard deadlines and unknown orphan containers without replay', async () => {
    const f = fixture(); await f.supervisor.allocate(task, f.clock() + 1_000); f.advance(1_001);
    f.driver.list = async () => ['orphan-1']; await f.supervisor.reap();
    assert.equal(f.journal.get(task.executionId).state, 'STOPPED'); assert.ok(f.calls.some(call => call[1] === 'orphan-1')); f.journal.close();
  });
  it('does not turn a Docker failure into confirmed Stop', async () => {
    const f = fixture(); await f.supervisor.allocate(task, f.clock() + 45_000);
    f.driver.stop = async () => { throw new Error('Daemon unavailable'); };
    await assert.rejects(f.supervisor.stop(task.executionId)); assert.equal(f.journal.get(task.executionId).state, 'STOPPING');
    assert.equal(f.journal.get(task.executionId).proof, null); f.journal.close();
  });
  for (const state of ['STARTING', 'LIVE']) it(`rechecks SQLite after Docker enumeration before treating a fresh ${state} allocation as orphaned`, async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oddpath-runtime-'));
    let workerJournal, reaperJournal, allocation;
    let release, entered;
    const started = new Promise(resolve => { entered = resolve; });
    const gate = new Promise(resolve => { release = resolve; });
    try {
      const path = join(directory, 'journal.sqlite'), stopped = [];
      workerJournal = new RuntimeJournal(path); reaperJournal = new RuntimeJournal(path);
      const driver = { async start() { entered(); if (state === 'STARTING') await gate; },
        async stop(id) { stopped.push(id); return { processExited: true, observedAt: Date.now() }; },
        async list() {
          allocation = worker.allocate(task, Date.now() + 45_000);
          await started;
          if (state === 'LIVE') await allocation;
          const row = workerJournal.get(task.executionId);
          assert.equal(row.state, state);
          return [row.runtime, 'real-orphan'];
        } };
      const worker = new BrowserSupervisor({ journal: workerJournal, driver });
      await new BrowserSupervisor({ journal: reaperJournal, driver }).reap();
      assert.deepEqual(stopped, ['real-orphan']);
      release(); await allocation;
      assert.equal(workerJournal.get(task.executionId).state, 'LIVE');
    } finally {
      release?.(); await allocation?.catch(() => {});
      workerJournal?.close(); reaperJournal?.close();
      assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(directory, /oddpath-runtime-/u);
      await rm(directory, { recursive: true });
    }
  });
  it('renews a live lease but atomically refuses expired, stopping and deadline-bound journal entries', async () => {
    const f = fixture();
    try {
      await f.supervisor.allocate(task, f.clock() + 1_000);
      f.journal.renew(task.executionId, f.clock() + 2_000);
      assert.equal(f.journal.get(task.executionId).lease, f.clock() + 2_000);
      assert.throws(() => f.journal.renew(task.executionId, f.clock() + 45_001));
      f.advance(2_000);
      assert.throws(() => f.journal.renew(task.executionId, f.clock() + 30_000));
      f.journal.requestStop(task.executionId);
      assert.throws(() => f.journal.renew(task.executionId, f.clock() + 30_000));
      assert.equal(f.journal.get(task.executionId).state, 'STOPPING');
    } finally { f.journal.close(); }
  });
  for (const wait of ['endpoint', 'http', 'stop']) it(`stops instead of reviving authority lost during the ${wait} await`, async () => {
    const f = fixture(); let httpCalls = 0;
    try {
      await f.supervisor.allocate(task, f.clock() + 1_000);
      f.driver.endpoint = async () => { if (wait === 'endpoint') f.advance(1_000); return 'http://runtime'; };
      f.supervisor.http = async () => {
        httpCalls++;
        if (wait === 'http') f.advance(1_000);
        if (wait === 'stop') f.journal.requestStop(task.executionId);
        return { ok: true };
      };
      await assert.rejects(f.supervisor.renew(task.executionId, f.clock() + 30_000), /lease lost/u);
      assert.equal(httpCalls, wait === 'endpoint' ? 0 : 1);
      assert.equal(f.journal.get(task.executionId).state, 'STOPPED');
      assert.equal(f.calls.filter(call => call[0] === 'stop').length, 1);
    } finally { f.journal.close(); }
  });
  it('retains unconfirmed Stop when renewal loses authority and Docker is unavailable', async () => {
    const f = fixture();
    try {
      await f.supervisor.allocate(task, f.clock() + 1_000); f.advance(1_000);
      f.driver.stop = async () => { throw Error('Docker unavailable'); };
      await assert.rejects(f.supervisor.renew(task.executionId, f.clock() + 30_000));
      assert.equal(f.journal.get(task.executionId).state, 'STOPPING');
      assert.equal(f.journal.get(task.executionId).proof, null);
    } finally { f.journal.close(); }
  });
  it('serializes simultaneous Stop requests within the supervisor', async () => {
    const f = fixture(); await f.supervisor.allocate(task, f.clock() + 45_000);
    const [first, second] = await Promise.all([f.supervisor.stop(task.executionId), f.supervisor.stop(task.executionId)]);
    assert.deepEqual(first, second); assert.equal(f.calls.filter(call => call[0] === 'stop').length, 1); f.journal.close();
  });
  it('does not let an undeliverable page of exit reports starve later stopped allocations', () => {
    const journal = new RuntimeJournal(':memory:');
    for (let index = 0; index < 25; index++) {
      const executionId = `execution-${index}`, now = Date.now();
      journal.reserve({ executionId, runtimeId: `runtime-${index}`, token: 't', projectId: 'project', bindingHash: 'b'.repeat(64), leaseUntil: now + 45000, deadline: now + 600000 });
      journal.requestStop(executionId); journal.stopped(executionId, { processExited: true, observedAt: Date.now() });
    }
    const first = journal.unreported(); assert.equal(first.length, 20);
    for (const row of first) journal.attemptReport(row.execution);
    const next = journal.unreported(); assert.equal(next.filter(row => !first.some(old => old.execution === row.execution)).length, 5);
    journal.close();
  });
  it('does not delete another supervisor network or infer exit when Docker cannot be inspected', async () => {
    const image = `sha256:${'a'.repeat(64)}`, commands = [];
    const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
      execute: async args => { commands.push(args); if (args[0] === 'inspect') throw Object.assign(new Error('missing'), { stderr: 'No such object' });
        if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify([{ Labels: { 'oddpath.runtime': '1', 'oddpath.supervisor': 'foreign' } }]); return ''; } });
    await assert.rejects(driver.stop('runtime-foreign'), /network ownership mismatch/u);
    assert.equal(commands.some(args => args[1] === 'rm'), false);
    driver.execute = async () => { throw Object.assign(new Error('unavailable'), { stderr: 'Cannot connect to Docker daemon' }); };
    await assert.rejects(driver.stop('runtime-unavailable'), /unavailable/u);
  });
  it('recovers persisted started attempts by terminating them, without resuming', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oddpath-runtime-'));
    try {
      const path = join(directory, 'journal.sqlite'), now = Date.now();
      const journal = new RuntimeJournal(path);
      journal.reserve({ executionId: task.executionId, runtimeId: 'runtime-1', leaseUntil: now + 45_000, deadline: now + 600_000, token: 't', projectId: task.projectId, bindingHash: task.approval.bindingHash });
      journal.live(task.executionId); journal.markStarted(task.executionId);
      journal.db.exec('ALTER TABLE runtimes DROP COLUMN lastReportAttempt'); journal.close();
      const reopened = new RuntimeJournal(path), stopped = [];
      await new BrowserSupervisor({ journal: reopened, driver: { async stop(id) { stopped.push(id); return { processExited: true, observedAt: Date.now() }; }, async list() { return []; } } }).recover();
      assert.deepEqual(stopped, ['runtime-1']); assert.equal(reopened.get(task.executionId).state, 'STOPPED');
      assert.throws(() => reopened.markStarted(task.executionId)); reopened.close();
    } finally {
      assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
      assert.match(directory, /oddpath-runtime-/u);
      await rm(directory, { recursive: true });
    }
  });
  it('keeps control ports private and all application secrets/mounts out of browser containers', async () => {
    const commands = [], image = `sha256:${'a'.repeat(64)}`;
    const driver = new DockerRuntimeDriver({ instanceId: 'test', supervisorContainer: 'controller', chromeImage: image, egressImage: image,
      execute: async args => { commands.push(args); if (args[0] === 'version') return '29.0.0'; if (args[0] === 'exec') { assert.match(args.at(-1), /waitForBrowserServices/u); return 'READY'; } if (args[0] === 'inspect') return JSON.stringify([{ Config: { Labels: { 'oddpath.runtime': '1', 'oddpath.supervisor': 'test' } }, State: { Running: true }, NetworkSettings: { Networks: { 'oddpath-private-runtime-1': { IPAddress: '172.20.1.2' } } } }]); return ''; } });
    await driver.start({ executionId: 'execution-1', runtimeId: 'runtime-1', token: 'a'.repeat(64), deadline: Date.now() + 600_000, leaseUntil: Date.now() + 45_000, origins: ['https://example.com'] });
    const browser = commands.find(args => args.includes('oddpath-browser-runtime-1') && args[0] === 'create');
    for (const option of ['--publish','-p','--privileged','--volume','--mount','--cap-add','--ipc=host','--no-sandbox']) assert.equal(browser.includes(option), false, option);
    assert.ok(browser.includes('10001:10001')); assert.ok(browser.includes('--read-only')); assert.ok(browser.includes('--pids-limit'));
    assert.equal(browser.join(' ').includes('DATABASE_URL'), false);
  });
});
