import { DatabaseSync } from 'node:sqlite';
import { chmodSync } from 'node:fs';

export class RuntimeJournal {
  constructor(path, now = () => Date.now()) {
    this.now = now;
    this.db = new DatabaseSync(path);
    if (path !== ':memory:') chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS runtimes (
        execution TEXT PRIMARY KEY, runtime TEXT NOT NULL UNIQUE, state TEXT NOT NULL,
        lease INTEGER NOT NULL, deadline INTEGER NOT NULL, token TEXT NOT NULL,
        started INTEGER NOT NULL DEFAULT 0, stopped INTEGER, proof TEXT,
        project TEXT NOT NULL, binding TEXT NOT NULL, reported INTEGER NOT NULL DEFAULT 0,
        lastReportAttempt INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS tickets (nonce TEXT PRIMARY KEY, expiry INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS failure_reports (
        execution TEXT PRIMARY KEY, project TEXT NOT NULL, claim TEXT NOT NULL,
        leaseToken TEXT NOT NULL, expiry INTEGER NOT NULL,
        idempotencyKey TEXT NOT NULL, failure TEXT NOT NULL,
        lastAttempt INTEGER NOT NULL DEFAULT 0);`);
    // Preserve early stage-2 journals without discarding allocation/start fences.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (!this.db.prepare('PRAGMA table_info(runtimes)').all().some(column => column.name === 'lastReportAttempt')) this.db.exec('ALTER TABLE runtimes ADD COLUMN lastReportAttempt INTEGER NOT NULL DEFAULT 0');
      const columns = this.db.prepare('PRAGMA table_info(runtimes)').all().map(column => column.name);
      for (const [name, definition] of [['loginPhase', "TEXT NOT NULL DEFAULT 'NONE'"], ['loginEpoch', 'TEXT'], ['preparationDeadline', 'INTEGER'], ['allocationOwner', 'TEXT']]) {
        if (!columns.includes(name)) this.db.exec(`ALTER TABLE runtimes ADD COLUMN ${name} ${definition}`);
      }
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  reserve(input) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if (this.db.prepare('SELECT 1 FROM runtimes WHERE execution=?').get(input.executionId)) throw new Error('Execution has already been allocated; replay is prohibited.');
      if (this.db.prepare("SELECT 1 FROM runtimes WHERE state != 'STOPPED'").get()) throw new Error('Runtime capacity is busy.');
      this.db.prepare("INSERT INTO runtimes(execution,runtime,state,lease,deadline,token,project,binding) VALUES(?,?,'STARTING',?,?,?,?,?)")
        .run(input.executionId, input.runtimeId, input.leaseUntil, input.deadline, input.token, input.projectId, input.bindingHash);
      // A persistent fence, not a timeout: an outstanding creator may still
      // finish a Docker operation after its lease or worker process is lost.
      if (input.allocationOwner) this.db.prepare('UPDATE runtimes SET allocationOwner=? WHERE execution=?').run(input.allocationOwner, input.executionId);
      if (input.manual) this.db.prepare("UPDATE runtimes SET loginPhase='PREPARING',preparationDeadline=? WHERE execution=?").run(input.preparationDeadline, input.executionId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  markStarted(executionId) {
    const result = this.db.prepare("UPDATE runtimes SET started=1,state='EXECUTING',loginPhase=CASE WHEN loginPhase='READY' THEN 'EXECUTING' ELSE loginPhase END WHERE execution=? AND started=0 AND state='LIVE' AND lease>? AND deadline>? AND loginPhase IN ('NONE','READY')")
      .run(executionId, this.now(), this.now());
    if (result.changes !== 1) throw new Error('Execution cannot start or resume.');
  }
  live(executionId, allocationOwner = null) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      const changed = this.db.prepare("UPDATE runtimes SET state='LIVE',allocationOwner=NULL WHERE execution=? AND state='STARTING' AND allocationOwner IS ? AND lease>? AND deadline>? AND (loginPhase != 'PREPARING' OR preparationDeadline>?)")
        .run(executionId, allocationOwner, now, now, now);
      if (changed.changes !== 1) throw new Error('Allocation authority lost.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  releaseAllocation(executionId, allocationOwner) {
    // Only the creator that awaited all of start's operations can release this
    // fence. Stop, recovery and expiry must never infer settlement from absence.
    this.db.prepare('UPDATE runtimes SET allocationOwner=NULL WHERE execution=? AND allocationOwner=?')
      .run(executionId, allocationOwner);
  }
  renew(executionId, leaseUntil) {
    // Acquiring the writer may wait: sample authority time only after it succeeds.
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      if (!Number.isSafeInteger(leaseUntil) || leaseUntil <= now || leaseUntil > now + 45_000) throw new Error('Runtime lease invalid.');
      // Fence expiry and concurrent Stop in the same transaction as the update.
      const result = this.db.prepare("UPDATE runtimes SET lease=? WHERE execution=? AND state IN ('LIVE','EXECUTING') AND lease>? AND deadline>? AND deadline>=? AND (loginPhase NOT IN ('PREPARING','LOGIN') OR preparationDeadline>?)")
        .run(leaseUntil, executionId, now, now, leaseUntil, now);
      if (result.changes !== 1) throw new Error('Runtime lease lost.');
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  requestStop(executionId) {
    this.db.prepare("UPDATE runtimes SET state='STOPPING',stopped=COALESCE(stopped,?) WHERE execution=? AND state != 'STOPPED'")
      .run(this.now(), executionId);
    return this.get(executionId);
  }
  loginTransition(executionId, expected, next, epoch) {
    if (![['PREPARING','LOGIN'],['LOGIN','READY']].some(pair => pair[0] === expected && pair[1] === next)
      || typeof epoch !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(epoch)) throw new Error('Login transition invalid.');
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const now = this.now();
      const changed = this.db.prepare("UPDATE runtimes SET loginPhase=?,loginEpoch=? WHERE execution=? AND state='LIVE' AND started=0 AND loginPhase=? AND lease>? AND deadline>? AND preparationDeadline>? AND (loginEpoch IS NULL OR loginEpoch=?)")
        .run(next, epoch, executionId, expected, now, now, now, epoch);
      if (changed.changes !== 1) throw new Error('Login authority unavailable.');
      this.db.exec('COMMIT'); return this.get(executionId);
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  stopped(executionId, proof) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const row = this.get(executionId);
      if (!row?.stopped || row.allocationOwner !== null || proof.observedAt < row.stopped || proof.processExited !== true) throw new Error('Termination proof invalid.');
      this.db.prepare("UPDATE runtimes SET state='STOPPED',proof=?,token='' WHERE execution=?").run(JSON.stringify(proof), executionId);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
  }
  get(executionId) { return this.db.prepare('SELECT * FROM runtimes WHERE execution=?').get(executionId); }
  getByRuntime(runtimeId) { return this.db.prepare('SELECT * FROM runtimes WHERE runtime=?').get(runtimeId); }
  active() { return this.db.prepare("SELECT * FROM runtimes WHERE state != 'STOPPED'").all(); }
  unreported() { return this.db.prepare("SELECT * FROM runtimes WHERE state='STOPPED' AND reported=0 ORDER BY lastReportAttempt,execution LIMIT 20").all(); }
  attemptReport(executionId) { this.db.prepare('UPDATE runtimes SET lastReportAttempt=? WHERE execution=?').run(this.now(), executionId); }
  reported(executionId) { this.db.prepare('UPDATE runtimes SET reported=1 WHERE execution=?').run(executionId); }
  deferFailure({ executionId, projectId, claimId, leaseToken, expiry, idempotencyKey, failure }) {
    // Preserve the first receipt/key across retries and restarts. This queue
    // authorizes reporting only; it is never used to replay browser execution.
    this.db.prepare('INSERT INTO failure_reports(execution,project,claim,leaseToken,expiry,idempotencyKey,failure) VALUES(?,?,?,?,?,?,?) ON CONFLICT(execution) DO NOTHING')
      .run(executionId, projectId, claimId, leaseToken, expiry, idempotencyKey, JSON.stringify(failure));
  }
  pendingFailures() { return this.db.prepare('SELECT * FROM failure_reports ORDER BY lastAttempt,execution LIMIT 20').all(); }
  attemptFailure(executionId) { this.db.prepare('UPDATE failure_reports SET lastAttempt=? WHERE execution=?').run(this.now(), executionId); }
  resolveFailure(executionId) { this.db.prepare('DELETE FROM failure_reports WHERE execution=?').run(executionId); }
  consumeTicket(nonce, expiry) {
    this.db.prepare('DELETE FROM tickets WHERE expiry<?').run(this.now());
    this.db.prepare('INSERT INTO tickets(nonce,expiry) VALUES(?,?)').run(nonce, expiry);
  }
  close() { this.db.close(); }
}
