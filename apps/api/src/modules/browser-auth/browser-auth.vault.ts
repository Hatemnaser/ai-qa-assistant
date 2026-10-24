import { readFileSync, chmodSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { validateBrowserStateKeys, type BrowserStateKeys } from '@oddpath/qa-execution-contract/browser-state-crypto';
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

interface Issued { id: string; ownerId: string; projectId: string; targetRevisionId: string; targetHash: string; createdAt: number; expiresAt: number; revokedAt?: number }
export class BrowserStateRevocations {
  private db: DatabaseSync;
  private identity: {dev:bigint;ino:bigint}|undefined;
  constructor(private path: string, private key: string) {
    if (!/^[a-f0-9]{64}$/u.test(key)) throw new Error('Invalid independent revocation key.');
    this.db = new DatabaseSync(path); if (path !== ':memory:') chmodSync(path,0o600);
    if(path!==':memory:'){const info=statSync(path,{bigint:true});this.identity={dev:info.dev,ino:info.ino};}
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY,payload TEXT NOT NULL,mac TEXT NOT NULL)');
  }
  private mac(value: string,id:string) { return createHmac('sha256',Buffer.from(this.key,'hex')).update(id+'\0'+value).digest('hex'); }
  private requireFile(){
    if(!this.identity)return;
    try{const info=statSync(this.path,{bigint:true});if(info.dev!==this.identity.dev||info.ino!==this.identity.ino)throw unavailable();}
    catch{throw unavailable();}
  }
  private get<T>(id: string): T | null {
    this.requireFile();
    const row = this.db.prepare('SELECT payload,mac FROM entries WHERE id=?').get(id) as {payload:string;mac:string}|undefined;
    if (!row) return null;
    const a=Buffer.from(row.mac,'hex'),b=Buffer.from(this.mac(row.payload,id),'hex');
    if (a.length !== b.length || !timingSafeEqual(a,b)) throw unavailable();
    return JSON.parse(row.payload) as T;
  }
  private put(id: string, value: unknown) { this.requireFile();const payload=JSON.stringify(value);this.db.prepare('INSERT INTO entries(id,payload,mac) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,mac=excluded.mac').run(id,payload,this.mac(payload,id)); }
  issue(record: Issued) { this.db.exec('BEGIN IMMEDIATE');try { if(this.get(record.id))throw unavailable();this.put(record.id,record);this.db.exec('COMMIT'); }catch(error){this.db.exec('ROLLBACK');throw error;} }
  allows(record: Issued, clock: number|(()=>number)) {
    const retained=this.get<Issued>(record.id), owner=this.get<{cutoff:number;deleted?:boolean}>('owner:'+record.ownerId),project=this.get<{cutoff:number;deleted?:boolean}>('project:'+record.projectId);
    const now=typeof clock==='function'?clock():clock;
    return !!retained && !retained.revokedAt && !owner?.deleted && !project?.deleted && retained.expiresAt>now && retained.createdAt>(owner?.cutoff??0) && retained.createdAt>(project?.cutoff??0)
      && ['id','ownerId','projectId','targetRevisionId','targetHash','createdAt','expiresAt'].every(key=>retained[key as keyof Issued]===record[key as keyof Issued]);
  }
  revoke(id: string, now: number) { this.db.exec('BEGIN IMMEDIATE');try { const row=this.get<Issued>(id);if(row)this.put(id,{...row,revokedAt:row.revokedAt??now});this.db.exec('COMMIT'); }catch(error){this.db.exec('ROLLBACK');throw error;} }
  revokeScope(kind: 'owner'|'project',id: string,now: number,deleted=false) { this.db.exec('BEGIN IMMEDIATE');try { const key=kind+':'+id,old=this.get<{cutoff:number;deleted?:boolean}>(key);this.put(key,{cutoff:Math.max(old?.cutoff??0,now),deleted:deleted||old?.deleted||false});this.db.exec('COMMIT'); }catch(error){this.db.exec('ROLLBACK');throw error;} }
  close(){this.db.close();}
}
export interface BrowserAuthVault { storage: BrowserStateKeys; transfer: BrowserStateKeys; revocations: BrowserStateRevocations }
let configured: BrowserAuthVault | undefined;
export function loadBrowserAuthVault(requireEnabled=true): BrowserAuthVault {
  if (requireEnabled&&!env.qaSavedLoginEnabled) throw new AppError('Saved login is not active.',409,'BROWSER_SAVED_LOGIN_NOT_ACTIVE');
  if (!configured) {
    if(!isAbsolute(env.qaBrowserVaultKeyringFile)||!isAbsolute(env.qaBrowserVaultRevocationFile)||env.qaBrowserVaultKeyringFile===env.qaBrowserVaultRevocationFile)throw unavailable();
    if(statSync(env.qaBrowserVaultKeyringFile).size>32768)throw unavailable();
    const raw=JSON.parse(readFileSync(env.qaBrowserVaultKeyringFile,'utf8'));
    const storage=validateBrowserStateKeys(raw.storage),transfer=validateBrowserStateKeys(raw.transfer);
    if(Object.values(storage.keys).some(key=>Object.values(transfer.keys).includes(key)||key===raw.revocationKey))throw unavailable();
    if(Object.values(transfer.keys).includes(raw.revocationKey)||[...Object.values(storage.keys),...Object.values(transfer.keys),raw.revocationKey].includes(env.qaBrowserViewerSigningKey))throw unavailable();
    configured={storage,transfer,revocations:new BrowserStateRevocations(env.qaBrowserVaultRevocationFile,raw.revocationKey)};
  }
  return configured;
}
export function unavailable(){return new AppError('Saved login is unavailable or revoked.',409,'QA_SAVED_LOGIN_UNAVAILABLE');}
export function closeBrowserAuthVault(){configured?.revocations.close();configured=undefined;}
