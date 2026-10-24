// Human input and the immutable executor never own an allocation together.
export class LoginBoundary {
  constructor({ manual = false, deadline, preparationDeadline, executionTimeoutMs, now = () => Date.now() }) {
    if (manual && (!Number.isSafeInteger(preparationDeadline) || preparationDeadline > deadline
      || preparationDeadline <= now() || preparationDeadline > now() + 300_000
      || !Number.isSafeInteger(executionTimeoutMs) || executionTimeoutMs < 1000 || executionTimeoutMs > 600_000)) throw new Error('Invalid login boundary.');
    Object.assign(this, { deadline, preparationDeadline, executionTimeoutMs, now });
    this.phase = manual ? 'PREPARING' : 'NONE'; this.epoch = null; this.executionDeadline = deadline;
  }
  live() {
    const now = this.now();
    return this.phase !== 'CLOSED' && now < this.deadline && now < this.executionDeadline
      && (!['PREPARING','LOGIN','HANDOFF'].includes(this.phase) || now < this.preparationDeadline);
  }
  requireLive() { if (!this.live()) throw new Error('Login authority expired.'); }
  begin(epoch) {
    this.requireLive();
    if (this.phase !== 'PREPARING' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(epoch)) throw new Error('Login cannot start or resume.');
    this.epoch = epoch; this.phase = 'LOGIN';
  }
  handoff(epoch) {
    this.requireLive();
    if (this.phase !== 'LOGIN' || this.epoch !== epoch) throw new Error('Login handoff invalid.');
    this.phase = 'HANDOFF';
  }
  ready(epoch) {
    this.requireLive();
    if (this.phase !== 'HANDOFF' || this.epoch !== epoch) throw new Error('Login handoff invalid.');
    this.phase = 'READY';
  }
  start(epoch) {
    this.requireLive();
    if (this.phase !== 'READY' || this.epoch !== epoch) throw new Error('Execution cannot start or resume.');
    this.executionDeadline = Math.min(this.deadline, this.now() + this.executionTimeoutMs);
    this.phase = 'EXECUTING';
  }
  allowsCdp() { return this.live() && ['NONE','READY','EXECUTING'].includes(this.phase); }
  allowsViewer(mode, epoch) {
    return this.live() && (mode === 'LOGIN' ? this.phase === 'LOGIN' && this.epoch === epoch
      : mode === 'VIEW' && ['NONE','PREPARING','READY','EXECUTING'].includes(this.phase));
  }
  close() { this.phase = 'CLOSED'; }
}
