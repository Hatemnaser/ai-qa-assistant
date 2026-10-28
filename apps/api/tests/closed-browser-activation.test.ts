import assert from 'node:assert/strict';
import {it} from 'node:test';
import {loadEnv} from '../src/config/env.ts';

function closed(extra:Record<string,string>={}){
 return {NODE_ENV:'production',AI_ENABLED:'false',GUEST_AI_ENABLED:'false',PROJECT_DOCUMENT_EMBEDDINGS_ENABLED:'false',QA_PROCESSING_WORKER_ENABLED:'false',
  APP_ORIGIN:'https://app.example.test',CORS_ORIGIN:'https://app.example.test',COOKIE_SECURE:'true',COOKIE_DOMAIN:'',TRUST_PROXY_HOPS:'1',
  CSRF_SECRET:'synthetic-csrf-'.repeat(4),USAGE_IP_HASH_SALT:'synthetic-ip-salt-'.repeat(4),DATABASE_URL:'postgresql://runtime:synthetic@postgres:5432/closed_test',
  EMAIL_PROVIDER:'smtp',EMAIL_FROM:'Synthetic <fixture@example.test>',SMTP_HOST:'smtp.example.test',SMTP_PORT:'587',SMTP_USER:'synthetic',SMTP_PASS:'synthetic',EMAIL_OUTBOX_ENCRYPTION_SECRET:'synthetic-mail-key-'.repeat(4),
  REGISTRATION_MODE:'disabled',QA_EXECUTION_V2_ENABLED:'true',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',QA_BROWSER_RUNTIME_ENABLED:'true',QA_MANUAL_LOGIN_ENABLED:'true',
  QA_MANAGED_ROUTING_ENABLED:'true',QA_MANAGED_HOST_ID:'closed-host',QA_MANAGED_ROUTING_KEY:'a'.repeat(64),QA_MANAGED_PROJECT_KEY:'b'.repeat(64),QA_BROWSER_VIEWER_SIGNING_KEY:'c'.repeat(64),QA_BROWSER_VIEWER_ORIGIN:'https://viewer.example.test',
  QA_CLOSED_REHEARSAL_ENABLED:'true',QA_CLOSED_REHEARSAL_OWNER_IDS:'closed-owner,second-owner',...extra};
}
it('allows the explicit closed production contract without changing NODE_ENV',()=>{const value=loadEnv(closed());assert.equal(value.nodeEnv,'production');assert.equal(value.qaExecutionV2Enabled,true);assert.equal(value.qaClosedRehearsalEnabled,true);assert.deepEqual(value.qaClosedRehearsalOwnerIds,['closed-owner','second-owner']);});
it('preserves the default production v2 block and opt-in defaults',()=>{const value=loadEnv({NODE_ENV:'test'});assert.equal(value.qaClosedRehearsalEnabled,false);assert.deepEqual(value.qaClosedRehearsalOwnerIds,[]);assert.throws(()=>loadEnv(closed({QA_CLOSED_REHEARSAL_ENABLED:'false',QA_CLOSED_REHEARSAL_OWNER_IDS:''})),/QA_EXECUTION_V2_ENABLED must remain false/);});
for(const [name,value] of Object.entries({REGISTRATION_MODE:'invite',AI_ENABLED:'true',GUEST_AI_ENABLED:'true',PROJECT_DOCUMENT_EMBEDDINGS_ENABLED:'true',QA_PROCESSING_WORKER_ENABLED:'true',QA_SAVED_LOGIN_ENABLED:'true',PRIVATE_ASSETS_ENABLED:'true',QA_EXECUTION_V2_ENABLED:'false',QA_BROWSER_RUNTIME_ENABLED:'false',QA_MANAGED_ROUTING_ENABLED:'false',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'true'}))
 it('rejects closed activation with incompatible '+name,()=>assert.throws(()=>loadEnv(closed({[name]:value})),/closed browser rehearsal|Managed routing|draining|requires v2|Saved login/i));
for(const ids of ['', 'owner,owner','owner,*','owner,,other','owner@example.test',Array.from({length:21},(_,i)=>'owner-'+i).join(',')])
 it('rejects an unbounded or malformed closed owner allowlist '+JSON.stringify(ids),()=>assert.throws(()=>loadEnv(closed({QA_CLOSED_REHEARSAL_OWNER_IDS:ids})),/closed browser rehearsal/i));
it('rejects an ambiguous activation value',()=>assert.throws(()=>loadEnv(closed({QA_CLOSED_REHEARSAL_ENABLED:'yes'})),/QA_CLOSED_REHEARSAL_ENABLED/));
it('does not silently use the production interlock in test mode',()=>assert.throws(()=>loadEnv(closed({NODE_ENV:'test'})),/closed browser rehearsal/i));
it('requires host-only cookies and distinct HTTPS viewer/app origins',()=>{assert.throws(()=>loadEnv(closed({COOKIE_DOMAIN:'example.test'})),/closed browser rehearsal/i);assert.throws(()=>loadEnv(closed({QA_BROWSER_VIEWER_ORIGIN:'https://app.example.test'})),/closed browser rehearsal/i);});
