import { randomBytes, randomUUID } from 'node:crypto';
import { preparationErrorFromResponse } from './preparation-failure.mjs';

export class BrowserSupervisor {
  constructor({ driver, journal, now = () => Date.now(), fetch: http = fetch }) { Object.assign(this, { driver, journal, now, http }); this.pendingStops = new Map(); }
  async allocate(task, leaseUntil, register = async () => {}) {
    const deadline = Math.min(new Date(task.deadlineAt).getTime(), this.now() + 900_000);
    const input = { executionId: task.executionId, runtimeId: randomUUID(), token: randomBytes(32).toString('hex'),
      leaseUntil: Math.min(leaseUntil, deadline, this.now() + 45_000), deadline, projectId: task.projectId, bindingHash: task.approval.bindingHash,
      origins: [new URL(task.profile.target.baseUrl).origin, ...task.profile.target.resourceOrigins, ...task.profile.target.authenticationOrigins] };
    if (['MANUAL','SAVED_STATE'].includes(task.profile.authentication?.kind)) {
      input.saved = task.profile.authentication.kind==='SAVED_STATE';
      input.manual = { baseUrl: task.profile.target.baseUrl, authenticationOrigins: task.profile.target.authenticationOrigins,
        executionTimeoutMs: task.profile.executionLimits.executionTimeoutMs };
      input.preparationDeadline = Math.min(deadline, this.now() + task.profile.executionLimits.preparationTimeoutMs);
    }
    const allocationOwner = randomUUID();
    this.journal.reserve({ ...input, allocationOwner });
    try {
      // Persist the API allocation before creating physical resources. Owner
      // Stop/deletion can then retain its record until termination is proved.
      await register(this.journal.get(task.executionId));
      const assertAuthority = () => this.requireStartingAllocation(task.executionId, allocationOwner);
      assertAuthority();
      await this.driver.start(input, assertAuthority);
      // The writer can wait too: sample time and settle the creation fence in
      // the same transaction that establishes LIVE. A Stop cannot be overwritten.
      this.journal.live(task.executionId, allocationOwner);
      return this.requireLiveLease(task.executionId);
    } catch (error) {
      // start/register have settled, so this creator can no longer add resources.
      if (!error.allocationSettlementUnknown) this.journal.releaseAllocation(task.executionId, allocationOwner);
      await this.stop(task.executionId).catch(() => {}); throw error;
    }
  }
  requireStartingAllocation(executionId, allocationOwner) {
    const row = this.journal.get(executionId), now = this.now();
    if (!row || row.state !== 'STARTING' || row.allocationOwner !== allocationOwner || row.lease <= now || row.deadline <= now
      || (row.loginPhase === 'PREPARING' && row.preparationDeadline <= now)) throw new Error('Allocation authority lost.');
  }
  async stop(executionId) {
    if (this.pendingStops.has(executionId)) return this.pendingStops.get(executionId);
    const pending = this.stopOnce(executionId).finally(() => this.pendingStops.delete(executionId));
    this.pendingStops.set(executionId, pending);
    return pending;
  }
  async stopOnce(executionId) {
    const row = this.journal.requestStop(executionId);
    if (!row) throw new Error('Runtime not found.');
    if (row.state === 'STOPPED') return JSON.parse(row.proof);
    const proof = await this.driver.stop(row.runtime);
    // Even a successful absence observation cannot fence a still-pending
    // creator. Retain STOPPING and take a new observation after it settles.
    if (row.allocationOwner !== null) throw new Error('Allocation creation is pending; Stop remains unconfirmed.');
    this.journal.stopped(executionId, proof);
    return proof;
  }
  async renew(executionId, leaseUntil) {
    try {
      const row = this.requireLiveLease(executionId);
      leaseUntil = Math.min(leaseUntil, row.deadline, this.now() + 45_000);
      const endpoint = await this.driver.endpoint(row.runtime);
      this.requireLiveLease(executionId);
      const response = await this.http(`${endpoint}/lease`, { method: 'POST', headers: { authorization: `Bearer ${row.token}`, 'x-oddpath-lease-ms': String(leaseUntil) }, signal: AbortSignal.timeout(3_000) });
      if (!response.ok) throw new Error('Runtime lease renewal failed.');
      // HTTP can succeed while the durable lease expires or Stop wins locally.
      this.requireLiveLease(executionId);
      this.journal.renew(executionId, leaseUntil);
    } catch (error) { await this.stop(executionId).catch(() => {}); throw error; }
  }
  async login(executionId, action, epoch) {
    try {
      const row = this.requireLiveLease(executionId);
      const phases = { begin: ['PREPARING','LOGIN'], complete: ['LOGIN','READY'], start: ['READY','EXECUTING'] };
      const pair = phases[action];
      if (!pair || row.loginPhase !== pair[0] || (row.loginEpoch && row.loginEpoch !== epoch)) throw new Error('Login transition invalid.');
      const endpoint = await this.driver.endpoint(row.runtime); this.requireLiveLease(executionId);
      const response = await this.http(`${endpoint}/login/${action}`, { method: 'POST', headers: { authorization: `Bearer ${row.token}`, 'x-oddpath-login-epoch': epoch }, signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw await preparationErrorFromResponse(response);
      if ((await response.json()).phase !== pair[1]) throw new Error('Login mode not confirmed.');
      this.requireLiveLease(executionId);
      if (action !== 'start') this.journal.loginTransition(executionId, pair[0], pair[1], epoch);
    } catch (error) { await this.stop(executionId).catch(() => {}); throw error; }
  }
  requireLiveLease(executionId) {
    const row = this.journal.get(executionId), now = this.now();
    if (!row || !['LIVE', 'EXECUTING'].includes(row.state) || row.lease <= now || row.deadline <= now
      || (['PREPARING','LOGIN'].includes(row.loginPhase) && row.preparationDeadline <= now)) throw new Error('Runtime lease lost.');
    return row;
  }
  async recover() {
    // A process restart cannot establish whether an acknowledged step happened.
    // Stop all retained allocations, never resume from a recipe/checkpoint.
    for (const row of this.journal.active()) await this.stop(row.execution);
    for (const runtime of await this.driver.list()) await this.driver.stop(runtime);
  }
  async reap() {
    for (const row of this.journal.active()) {
      if (row.lease <= this.now() || row.deadline <= this.now() || row.state === 'STOPPING'
        || (['PREPARING','LOGIN'].includes(row.loginPhase) && row.preparationDeadline <= this.now())) await this.stop(row.execution);
      else if (row.state !== 'STARTING') {
        try { await this.driver.endpoint(row.runtime); }
        catch { await this.stop(row.execution); }
      }
    }
    for (const runtime of await this.driver.list()) {
      // Workers reserve before creating Docker resources. A listing may have
      // waited while a new STARTING/LIVE allocation was written to SQLite.
      const row = this.journal.getByRuntime(runtime);
      if (!row || row.state === 'STOPPED') await this.driver.stop(runtime);
    }
  }
}
