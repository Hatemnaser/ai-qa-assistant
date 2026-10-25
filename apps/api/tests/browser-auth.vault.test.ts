import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,renameSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {BrowserStateRevocations} from '../src/modules/browser-auth/browser-auth.vault.js';
const record={id:'state',ownerId:'owner',projectId:'project',targetRevisionId:'target',targetHash:'a'.repeat(64),createdAt:1000,expiresAt:7000};
describe('independent saved-login revocation journal',()=>{
  it('rejects unissued identities, changed bindings and expired records at the current read time',()=>{
    const book=new BrowserStateRevocations(':memory:','1'.repeat(64));try{
      assert.equal(book.allows(record,2000),false);book.issue(record);
      assert.equal(book.allows(record,2000),true);assert.equal(book.allows({...record,projectId:'other'},2000),false);
      assert.equal(book.allows(record,()=>7000),false);assert.throws(()=>book.issue(record));
    }finally{book.close();}
  });
  it('preserves revocation after reopen even if the PostgreSQL record is restored unchanged',()=>{
    const dir=mkdtempSync(join(tmpdir(),'oddpath-vault-')),file=join(dir,'revoke.sqlite');let book=new BrowserStateRevocations(file,'1'.repeat(64));try{
      book.issue(record);book.revoke(record.id,2000);book.close();book=new BrowserStateRevocations(file,'1'.repeat(64));assert.equal(book.allows(record,3000),false);
    }finally{book.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true});}
  });
  it('invalidates pre-logout/deletion consent while allowing new independent consent',()=>{
    const book=new BrowserStateRevocations(':memory:','1'.repeat(64));try{
      book.issue(record);book.revokeScope('owner','owner',2000);assert.equal(book.allows(record,3000),false);
      const late={...record,id:'late'};book.issue(late);assert.equal(book.allows(late,3000),false);
      const fresh={...record,id:'fresh',createdAt:3000};book.issue(fresh);assert.equal(book.allows(fresh,3000),true);
      book.revokeScope('project','project',3500);assert.equal(book.allows(fresh,4000),false);
      book.revokeScope('project','project',4000,true);const restored={...record,id:'after-deletion',createdAt:5000};book.issue(restored);assert.equal(book.allows(restored,5000),false);
    }finally{book.close();}
  });
  it('fails closed on ledger tampering and on a changed authentication key',()=>{
    const dir=mkdtempSync(join(tmpdir(),'oddpath-vault-')),file=join(dir,'revoke.sqlite');const book=new BrowserStateRevocations(file,'1'.repeat(64));
    try{book.issue(record);const wrong=new BrowserStateRevocations(file,'2'.repeat(64));try{assert.throws(()=>wrong.allows(record,2000));}finally{wrong.close();}
      const db=new DatabaseSync(file);try{db.prepare('UPDATE entries SET payload=? WHERE id=?').run(JSON.stringify({...record,expiresAt:9000}),record.id);}finally{db.close();}
      assert.throws(()=>book.allows(record,2000));
    }finally{book.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true});}
  });
  it('refuses cached authority when the live journal file has been replaced',{skip:process.platform==='win32'},()=>{
    const dir=mkdtempSync(join(tmpdir(),'oddpath-vault-')),file=join(dir,'revoke.sqlite'),book=new BrowserStateRevocations(file,'1'.repeat(64));
    try{book.issue(record);renameSync(file,file+'.retired');writeFileSync(file,'');assert.throws(()=>book.allows(record,2000),{code:'QA_SAVED_LOGIN_UNAVAILABLE'});}
    finally{book.close();assert.equal(dirname(resolve(dir)),resolve(tmpdir()));rmSync(dir,{recursive:true});}
  });
});
