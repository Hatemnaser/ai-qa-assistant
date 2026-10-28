// Explicit real-PG regression. No host ports or existing databases are used.
// Run with ODDPATH_RECOVERY_BROWSER_TESTS=SYNTHETIC_ONLY, ODDPATH_OPERATIONS_IMAGE,
// ODDPATH_MIGRATIONS_IMAGE and an empty ODDPATH_RECOVERY_BROWSER_EVIDENCE_DIR.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,relative,isAbsolute,join} from 'node:path';
import ts from 'typescript';

assert.equal(process.env.ODDPATH_RECOVERY_BROWSER_TESTS,'SYNTHETIC_ONLY');
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.env.ODDPATH_RECOVERY_BROWSER_EVIDENCE_DIR;
assert(out&&isAbsolute(out));
const fromRoot=relative(root,resolve(out));assert(fromRoot.startsWith('..')||isAbsolute(fromRoot),'Evidence must be outside the checkout');
await mkdir(out,{recursive:true});assert.equal((await readdir(out)).length,0,'Use a new empty evidence directory');
const operations=process.env.ODDPATH_OPERATIONS_IMAGE,migrations=process.env.ODDPATH_MIGRATIONS_IMAGE;
assert(operations&&migrations,'Explicit current operations and migrations images required');
const id='recovery-browser-'+randomUUID().slice(0,8),label='com.oddpath.recovery-browser-regression';
const secret=Array.from({length:6},()=>randomBytes(32).toString('hex')),[password,csrf,salt,mail,smtp,viewer]=secret;
const report={status:'RUNNING',scope:'REAL_PG16_FULL_SCHEMA_ACTUAL_API_AND_RECOVERY_PREPARATION',id,checks:[],cleanup:false,commands:[]};
const safe=s=>secret.reduce((v,key)=>v.replaceAll(key,'[REDACTED]'),String(s));
const save=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2)+'\n');
function docker(name,args,{input,allowFailure=false}={}){
 const p=spawnSync('docker',args,{input,encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2000000});
 report.commands.push({name,exitCode:p.status});
 if(p.error||(!allowFailure&&p.status!==0))throw Error(name+': '+safe(p.error||p.stderr));
 return p;
}
const sql=(query,db='postgres')=>docker('real-SQL',['exec','-i',id,'psql','-X','-U','postgres','-d',db,'-At','-v','ON_ERROR_STOP=1'],{input:query}).stdout.trim();
let network=false,pg=false;const volumes=[];
const operator=['run','--rm','-i','--label',label+'='+id,'--network',id,'--user','0:0','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
 '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m','-v',id+'-private:/private:ro','-v',id+'-state:/state',
 '-e','PGHOST='+id,'-e','PGPORT=5432','-e','PGDATABASE=postgres','-e','PGUSER=postgres','-e','PGPASSFILE=/private/pgpass','-e','PGSSLMODE=disable',
 '-e','ODDPATH_RECOVERY_SOURCE_ACK=FREEZE_SOURCE_KEEP_TARGET_QUARANTINED','--entrypoint','node',operations];
try {
 for(const [name,image]of [['operations',operations],['migrations',migrations],['postgres','postgres:16']])report[name+'Image']=docker('pin-'+name,['image','inspect',image,'--format','{{.Id}}']).stdout.trim();
 docker('new-internal-network',['network','create','--internal','--label',label+'='+id,id]);network=true;
 for(const suffix of ['pg','private','state']){const name=id+'-'+suffix;docker('new-owned-volume',['volume','create','--label',label+'='+id,name]);volumes.push(name);}
 docker('init-private-files',['run','--rm','-i','--network','none','--label',label+'='+id,'--user','0:0','-v',id+'-private:/private','-v',id+'-state:/state',
  '--tmpfs','/var/lib/postgresql/data','--entrypoint','node',operations,'-e',
  "const fs=require('fs'),p=JSON.parse(fs.readFileSync(0,'utf8'));fs.chmodSync('/private',0o700);fs.chmodSync('/state',0o700);fs.writeFileSync('/private/admin',p.password,{mode:0o600});fs.writeFileSync('/private/pgpass',p.host+':5432:*:postgres:'+p.password+String.fromCharCode(10),{mode:0o600});"],{input:JSON.stringify({host:id,password})});
 docker('start-test-PG',['run','-d','--name',id,'--label',label+'='+id,'--network',id,'--memory','512m','--cpus','1','-e','POSTGRES_PASSWORD_FILE=/private/admin',
  '-v',id+'-private:/private:ro','-v',id+'-pg:/var/lib/postgresql/data','postgres:16']);pg=true;
 for(let i=0;i<80;i++){if(docker('PG-ready',['exec',id,'pg_isready','-U','postgres'],{allowFailure:true}).status===0)break;if(i===79)throw Error('PG_TIMEOUT');await new Promise(r=>setTimeout(r,250));}
 sql('CREATE ROLE recovery_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE DATABASE source_seed;');
 const url='postgresql://postgres:'+password+'@'+id+':5432/source_seed?schema=public';
 docker('all-current-migrations',['run','--rm','--label',label+'='+id,'--network',id,'-e','DATABASE_URL='+url,migrations]);
 const compile=code=>ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText;
 const helper=compile(await readFile(join(root,'apps/api/tests/helpers/quotaBrowserFixture.ts'),'utf8')).replaceAll('../../src/','/opt/oddpath/apps/api/dist/').replaceAll(".ts'",".js'").replaceAll("'@oddpath/qa-execution-contract'","'/opt/oddpath/packages/qa-execution-contract/dist/index.js'");
 const fixture=compile(await readFile(join(root,'ops/tests/fixtures/recovery-browser-state.ts'),'utf8')).replaceAll('../../../apps/api/src/','/opt/oddpath/apps/api/dist/').replaceAll('../../../apps/api/tests/helpers/quotaBrowserFixture.ts','/tmp/recovery-browser-helper.mjs').replaceAll(".ts'",".js'");
 const config={NODE_ENV:'test',DATABASE_URL:url,PORT:'5000',APP_ORIGIN:'https://app.example.test',CORS_ORIGIN:'https://app.example.test',COOKIE_SECURE:'true',TRUST_PROXY_HOPS:'1',AUTH_ABUSE_STORE:'postgres',REGISTRATION_MODE:'disabled',
  AI_ENABLED:'false',GUEST_AI_ENABLED:'false',PROJECT_DOCUMENT_EMBEDDINGS_ENABLED:'false',QA_PROCESSING_WORKER_ENABLED:'false',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',
  QA_EXECUTION_V2_ENABLED:'true',QA_BROWSER_RUNTIME_ENABLED:'true',QA_BROWSER_VIEWER_SIGNING_KEY:viewer,QA_BROWSER_VIEWER_ORIGIN:'https://viewer.example.test',PRIVATE_ASSETS_ENABLED:'false',EMAIL_PROVIDER:'smtp',EMAIL_FROM:'Oddpath <fixture@example.invalid>',SMTP_HOST:'127.0.0.1',SMTP_PORT:'9',SMTP_USER:'synthetic',SMTP_PASS:smtp,
  CSRF_SECRET:csrf,USAGE_IP_HASH_SALT:salt,EMAIL_OUTBOX_ENCRYPTION_SECRET:mail,ODDPATH_RECOVERY_BROWSER_TESTS:'SYNTHETIC_ONLY'};
 const fixtureInput="import fs from 'node:fs/promises';await fs.writeFile('/tmp/recovery-browser-helper.mjs',"+JSON.stringify(helper)+");await fs.writeFile('/tmp/recovery-browser-fixture.mjs',"+JSON.stringify(fixture)+");await import('file:///tmp/recovery-browser-fixture.mjs');";
 const api=docker('actual-API-lifecycle',['run','--rm','-i','--label',label+'='+id,'--network',id,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m',...Object.entries(config).flatMap(([k,v])=>['-e',k+'='+v]),'--entrypoint','node',operations,'--input-type=module'],{input:fixtureInput});
 report.apiLifecycle=JSON.parse(api.stdout.trim());await save();
 // Assert the real schema also rejects a foreign journal state and a terminal
 // row without exit proof. No constraint is removed to manufacture fixtures.
 for(const [name,query,constraint]of [
  ['journal_state_rejected_by_PG',`UPDATE "QaBrowserRuntime" SET state='STOPPED';`,'QaBrowserRuntime_state_check'],
  ['missing_exit_rejected_by_PG',`UPDATE "QaBrowserRuntime" SET "exitObservedAt"=NULL;`,'QaBrowserRuntime_stop_check']
 ]){
  const p=docker('constraint-'+name,['exec','-i',id,'psql','-X','-U','postgres','-d','source_seed','-At','-v','ON_ERROR_STOP=1'],{input:query,allowFailure:true});
  report.checks.push({name,status:p.status!==0&&p.stderr.includes(constraint)?'PASS':'FAIL',layer:'REAL_PG_CONSTRAINT',constraint});await save();
 }
 const source=await readFile(join(root,'ops/recovery-activation.mjs'),'utf8');report.moduleSha256=createHash('sha256').update(source.replaceAll('\r\n','\n')).digest('hex');
 // Expose the private preparation function in a memory-only copy. Its body is
 // unchanged; actual current-source locks/metadata/SQL/finally execute normally.
 const module=source.replaceAll("'./current-source.mjs'","'file:///opt/oddpath/ops/current-source.mjs'").replaceAll("'./recovery-runtime-proof.mjs'","'file:///opt/oddpath/ops/recovery-runtime-proof.mjs'").replaceAll("'./lib/private-files.mjs'","'file:///opt/oddpath/ops/lib/private-files.mjs'");
 const cases=[
  ['confirmed','',true],
  ['live',`UPDATE "QaBrowserRuntime" SET state='LIVE',"stopRequestedAt"=NULL,"exitObservedAt"=NULL;`,false],
  ...['STOP_REQUESTED','STOP_UNCONFIRMED'].map((state,i)=>['state_'+i,`UPDATE "QaBrowserRuntime" SET state='${state}',"exitObservedAt"=NULL;`,false]),
  ['active_hold',`UPDATE "QaBrowserReservation" SET state='ACTIVE',"releasedAt"=NULL;`,false],
  ['unknown_usage',`INSERT INTO "UsageEvent" (id,action,status,units,"creditsReserved") VALUES ('unknown','chat','unknown',1,1);`,false],
  ['restarted','',true]
 ];
 for(const [name,mutation,accepted]of cases){
  if(name==='restarted'){docker('restart-real-PG',['restart',id]);for(let i=0;i<80;i++){if(docker('PG-ready-after-restart',['exec',id,'pg_isready','-U','postgres'],{allowFailure:true}).status===0)break;if(i===79)throw Error('PG_RESTART_TIMEOUT');await new Promise(r=>setTimeout(r,250));}}
  const db='source_'+name,target='oddpath_restore_browser_'+name;
  sql('CREATE DATABASE '+db+' TEMPLATE source_seed;');if(mutation)sql(mutation,db);
  const code=`import {stageCurrentSource,withCurrentSourceOperation} from './ops/current-source.mjs';
   let source=${JSON.stringify(module)};source=source.replaceAll("'pg'",JSON.stringify(import.meta.resolve('pg'))).replaceAll("'@oddpath/qa-execution-contract'",JSON.stringify(import.meta.resolve('@oddpath/qa-execution-contract')));source+=String.fromCharCode(10)+'export {prepareTarget};';
   const {prepareTarget}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
   const options={stateDirectory:'/state/${name}'};await stageCurrentSource({...options,source:'${db}',target:'${target}',owner:'recovery_owner'});
   let result;await withCurrentSourceOperation(options,async(ctx,s)=>{s.activation={};try{await prepareTarget(ctx,s,process.env);result={accepted:true};}catch(e){result={accepted:false,code:e.code||e.message};}result.targetClosed=!(await ctx.metadata('${target}')).allowsConnections;result.sourceClosed=!(await ctx.metadata('${db}')).allowsConnections;});console.log(JSON.stringify(result));`;
  const actual=JSON.parse(docker('preparation-'+name,[...operator,'--input-type=module'],{input:code}).stdout.trim());
  const passed=actual.accepted===accepted&&actual.sourceClosed&&actual.targetClosed&&(accepted||actual.code==='RECOVERY_CLOSED_PREREQUISITES_UNRESOLVED');
  report.checks.push({name,expectedAccepted:accepted,...actual,status:passed?'PASS':'FAIL'});await save();
 }
 report.status=report.checks.every(c=>c.status==='PASS')?'PASS':'FAIL';
} catch(e){report.status='ERROR';report.error=safe(e.stack||e);}
finally {
 try {
  if(pg){const info=JSON.parse(docker('verify-container-owner',['inspect',id]).stdout)[0];assert.equal(info.Config.Labels[label],id);docker('remove-test-PG',['rm','-fv',id]);}
  for(const volume of volumes){const info=JSON.parse(docker('verify-volume-owner',['volume','inspect',volume]).stdout)[0];assert.equal(info.Labels[label],id);docker('remove-test-volume',['volume','rm',volume]);}
  if(network){const info=JSON.parse(docker('verify-network-owner',['network','inspect',id]).stdout)[0];assert.equal(info.Labels[label],id);docker('remove-test-network',['network','rm',id]);}
  report.cleanup=true;
 }catch(e){report.cleanup=false;report.status='ERROR';report.cleanupError=safe(e.stack||e);}
 await save();console.log(JSON.stringify(report,null,2));
}
if(report.status!=='PASS')process.exitCode=1;
