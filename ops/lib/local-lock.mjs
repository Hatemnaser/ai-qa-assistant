import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, statSync } from 'node:fs';
import { requireCondition } from './private-files.mjs';

/** OS-backed local-filesystem lock. Process death rolls it back; no TTL steal. */
export class LocalOperationsLock extends EventEmitter {
  constructor(path) { super(); this.path = path; }
  async connect() {
    this.db = new DatabaseSync(this.path); chmodSync(this.path, 0o600);
    this.db.exec('PRAGMA busy_timeout=0');
    this.identity = statSync(this.path, { bigint: true });
  }
  async acquire() {
    try { this.db.exec('BEGIN IMMEDIATE'); this.held = true; return true; }
    catch (error) { if (error.errcode === 5 || /locked/.test(error.message)) return false; throw error; }
  }
  async check() {
    const info = statSync(this.path, { bigint: true });
    requireCondition(this.held && info.ino === this.identity.ino && info.dev === this.identity.dev, 'OPS_LOCAL_LOCK_LOST');
    this.db.prepare('SELECT 1').get();
  }
  async end() { this.db?.close(); }
}
