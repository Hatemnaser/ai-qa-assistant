import {describe,it} from 'node:test';
import assert from 'node:assert/strict';
import {parseBrowserStorageState} from '../src/browser-state.js';
import {sealBrowserState,unsealBrowserState} from '../src/browser-state-crypto.js';
const state={cookies:[{name:'session',value:'fixture-secret',domain:'example.com',path:'/',expires:-1,httpOnly:true,secure:true,sameSite:'Strict'}],origins:[{origin:'https://example.com',localStorage:[{name:'key',value:'قيمة'}]}]};
const keys={activeVersion:'v1',keys:{v1:'1'.repeat(64)}},binding={id:'one',ownerId:'owner',projectId:'project',expiresAt:7000};
describe('supported saved browser state',()=>{
  it('preserves cookie flags and accepts a valid parent-domain cookie without approving new origins',()=>{
    const parent={cookies:[{...state.cookies[0],domain:'.example.com',secure:false}],origins:[]};
    assert.deepEqual(parseBrowserStorageState(parent,['https://staging.example.com']),parent);
    assert.throws(()=>parseBrowserStorageState({...parent,cookies:[{...parent.cookies[0],domain:'example.com'}]},['https://staging.example.com']));
    assert.throws(()=>parseBrowserStorageState({...parent,cookies:[{...parent.cookies[0],domain:'.other.example'}]},['https://staging.example.com']));
  });
  it('encrypts with fresh IVs and authenticates the exact owner/project/expiry binding',()=>{
    const a=sealBrowserState(state,binding,keys),b=sealBrowserState(state,binding,keys);
    assert.notEqual(a.iv,b.iv);assert.equal(JSON.stringify(a).includes('fixture-secret'),false);
    assert.deepEqual(unsealBrowserState(a,binding,keys),state);
    for(const changed of [{...binding,ownerId:'other'},{...binding,expiresAt:8000},{...binding,projectId:'other'}])assert.throws(()=>unsealBrowserState(a,changed,keys));
    const cipher=Buffer.from(a.ciphertext,'base64url');cipher[0]=cipher[0]!^1;assert.throws(()=>unsealBrowserState({...a,ciphertext:cipher.toString('base64url')},binding,keys));
  });
  it('supports explicit key rotation and fails when the old key is removed',()=>{
    const old=sealBrowserState(state,binding,keys),rotated={activeVersion:'v2',keys:{v1:keys.keys.v1,v2:'2'.repeat(64)}};
    assert.deepEqual(unsealBrowserState(old,binding,rotated),state);assert.equal(sealBrowserState(state,binding,rotated).keyVersion,'v2');
    assert.throws(()=>unsealBrowserState(old,binding,{activeVersion:'v2',keys:{v2:rotated.keys.v2}}));
  });
  it('rejects unsupported state and cookies/origins outside approved authentication scope',()=>{
    assert.deepEqual(parseBrowserStorageState(state,['https://example.com']),state);
    assert.throws(()=>parseBrowserStorageState({...state,origins:[{origin:'https://other.example',localStorage:[]}]},['https://example.com']));
    assert.throws(()=>parseBrowserStorageState({...state,cookies:[{...state.cookies[0],domain:'.com'}]},['https://example.com']));
    assert.throws(()=>parseBrowserStorageState({...state,origins:[{origin:'https://example.com',localStorage:[],indexedDB:[]}]},['https://example.com']));
    assert.throws(()=>parseBrowserStorageState({...state,cookies:Array.from({length:301},()=>state.cookies[0])},['https://example.com']));
  });
});
