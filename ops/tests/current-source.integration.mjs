import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdtemp,readdir,rm} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {spawn} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {checkedOutputDirectory} from '../../apps/api/scripts/verify-release.mjs';
import {sanitizeOutput,systemEnvironment} from '../../apps/api/scripts/verify-release-manifest.mjs';

assert.equal(process.env.ODDPATH_RECOVERY_LOCAL_TESTS,'1');
const root=resolve(import.meta.dirname,'../..'),argv=process.argv.slice(2);assert.equal(argv.length,2);assert.equal(argv[0],'--output-dir');
const out=await checkedOutputDirectory(argv[1],root);assert.equal((await readdir(out)).length,0);
const id='current-'+Date.now()+'-'+randomBytes(3).toString('hex'),label='com.oddpath.current-source-test',network=id+'-net',pg=id+'-pg';
const ops=process.env.ODDPATH_RECOVERY_OPS_IMAGE,api=process.env.ODDPATH_RECOVERY_API_IMAGE,migration=process.env.ODDPATH_RECOVERY_MIGRATION_IMAGE,pgImage=process.env.ODDPATH_RECOVERY_PG_IMAGE;
assert.ok([ops,api,migration,pgImage].every(v=>typeof v==='string'&&v.length>0),'Provide exact reviewed image refs');
const secret=Array.from({length:8},()=>randomBytes(32).toString('hex')),[admin,runtime,password,csrf,salt,mail,smtp]=secret;
const privateRoot=resolve(process.env.ODDPATH_RECOVERY_TEST_PRIVATE_ROOT??tmpdir());
const privateDir=await mkdtemp(join(privateRoot,id+'-')),volumes=[id+'-pg',id+'-state'],containers=[],created=[];
const report={schemaVersion:1,id,status:'RUNNING',scope:'CURRENT_QUIESCED_PG_SAME_CLUSTER_COPY',publicReleaseAuthorized:false,phaseAccepted:false,checks:[],commands:[],cleanup:false};
const persist=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
const env=systemEnvironment(process.env),safe=s=>sanitizeOutput(s,secret);
async function docker(name,args,{input,allowFailure=false,timeout=90_000}={}){
 const child=spawn('docker',args,{cwd:root,env,stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';
 child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.stdin.on('error',()=>{});child.stdin.end(input);
 const timer=setTimeout(()=>child.kill(),timeout);const code=await new Promise((yes,no)=>{child.once('error',no);child.once('close',yes);});clearTimeout(timer);
 const log='command-'+String(report.commands.length+1).padStart(3,'0')+'.log';await writeFile(join(out,log),safe(stdout+'\n'+stderr));report.commands.push({name,code,log});await persist();
 if(!allowFailure)assert.equal(code,0,name+': '+safe(stderr));return {code,stdout,stderr};
}
async function check(name,value){report.checks.push({name,status:value?'PASS':'FAIL'});await persist();assert(value,name);}
async function until(name,probe,ms=60_000){const end=Date.now()+ms;while(Date.now()<end){if(await probe())return;await delay(250);}throw Error('Timeout: '+name);}
const sql=async(q,db='postgres')=>(await docker('synthetic-SQL',['exec','-i',pg,'psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-d',db,'-At'],{input:q})).stdout.trim();
const target=n=>'oddpath_restore_current_'+id.slice(-10).replaceAll('-','_')+'_'+n;
const tools=(state,{name,background=false,extra=[]}={})=>['run',...(background?['-d']:['--rm','-i']),...(name?['--name',name]:[]),'--label',label+'='+id,'--network',network,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--user','0:0','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m',
 '--env-file',join(privateDir,'control.env'),'-e','ODDPATH_RECOVERY_STATE_DIRECTORY=/state/'+state,'-v',privateDir+':/private:ro','-v',volumes[1]+':/state',...extra,'--entrypoint','node',ops];
const command=(name,state,args,options)=>docker(name,[...tools(state),'ops/recovery.mjs',...args],options);
const stage=(name,state,source,targetName,owner='recovery_owner',options)=>command(name,state,['stage-current','--source',source,'--target',targetName,'--owner',owner],options);
const cancel=(state,source,options)=>command('explicit-cancellation',state,['cancel-current','--confirm-source',source],options);
const flags=['NODE_ENV=production','PORT=5000','APP_ORIGIN=https://app.oddpath.test','CORS_ORIGIN=https://app.oddpath.test',`CSRF_SECRET=${csrf}`,`USAGE_IP_HASH_SALT=${salt}`,'TRUST_PROXY_HOPS=1','COOKIE_SECURE=true','AUTH_ABUSE_STORE=postgres','REGISTRATION_MODE=disabled','AI_ENABLED=false','GUEST_AI_ENABLED=false','PROJECT_DOCUMENT_EMBEDDINGS_ENABLED=false','QA_PROCESSING_WORKER_ENABLED=false','QA_LEGACY_RUNNER_DISPATCH_ENABLED=false','QA_EXECUTION_V2_ENABLED=false','PRIVATE_ASSETS_ENABLED=false','EMAIL_PROVIDER=smtp','EMAIL_FROM=Oddpath <no-reply@example.test>','SMTP_HOST=127.0.0.1','SMTP_PORT=9','SMTP_USER=synthetic',`SMTP_PASS=${smtp}`,`EMAIL_OUTBOX_ENCRYPTION_SECRET=${mail}`];
const apiArgs=db=>['run','--rm','-i','--label',label+'='+id,'--network',network,...flags.flatMap(v=>['-e',v]),'-e',`DATABASE_URL=postgresql://runtime:${runtime}@postgres:5432/${db}?schema=public`,api];
async function apiCode(name,db,code){return docker(name,[...apiArgs(db),'node','--input-type=module'],{input:code});}
async function ready(db){
 const name=id+'-api';await docker('start-closed-source-API',['run','-d','--name',name,'--label',label+'='+id,'--network',network,...flags.flatMap(v=>['-e',v]),'-e',`DATABASE_URL=postgresql://runtime:${runtime}@postgres:5432/${db}?schema=public`,api]);containers.push(name);
 await until('actual HTTP readiness',async()=>(await docker('HTTP-readiness',['exec',name,'node','-e',"fetch('http://127.0.0.1:5000/api/health/ready',{signal:AbortSignal.timeout(1000)}).then(async r=>{const b=await r.json();process.exit(r.status===200&&b.checks.database==='ok'?0:1)}).catch(()=>process.exit(1))"],{allowFailure:true})).code===0);
 await docker('drain-only-owned-API',['stop','-t','10',name]);await docker('remove-drained-API',['rm',name]);
}
async function snapshot(db){return JSON.parse(await sql(`SELECT json_build_object(
 'users',(SELECT count(*) FROM "User"),'events',(SELECT count(*) FROM "UsageEvent"),'receipts',(SELECT count(*) FROM "UsageSettlementReceipt"),
 'pending',(SELECT status FROM "UsageEvent" WHERE id='ops-pending'),'credits',(SELECT "creditsUsed" FROM "UsageEvent" WHERE id='ops-pending'),
 'unknown',(SELECT "creditsUsed" FROM "UsageEvent" WHERE id='ops-unknown'),'unknownStatus',(SELECT status FROM "UsageEvent" WHERE id='ops-unknown'),
 'hold',(SELECT units FROM "UsageEvent" WHERE id='ops-active-hold'),'holdStatus',(SELECT status FROM "UsageEvent" WHERE id='ops-active-hold'),
 'applied',(SELECT "appliedAt" IS NOT NULL FROM "UsageSettlementReceipt" WHERE "attemptId"='ops-attempt'),
 'personalIdentities',(SELECT count(*) FROM "UsageEvent" WHERE "userId" IS NOT NULL OR "guestId" IS NOT NULL OR "ipHash" IS NOT NULL),
 'rows',(SELECT md5(coalesce(jsonb_agg(to_jsonb(e) ORDER BY id)::text,'')) FROM "UsageEvent" e))` ,db));}
let lockChild;
try{
 const before=await docker('host-preexisting-containers',['ps','-a','--format','{{.Names}}']);report.originalContainers=before.stdout.trim().split('\n').filter(Boolean);
 report.operationsImage=(await docker('exact-operations-image',['image','inspect',ops,'--format','{{.Id}}'])).stdout.trim();
 assert(report.originalContainers.every(n=>n===process.env.ODDPATH_RECOVERY_TEST_OPERATOR),'Only an explicitly named harness operator may preexist');
 const control=['PGHOST=postgres','PGPORT=5432','PGDATABASE=postgres','PGUSER=postgres','PGPASSFILE=/private/admin_pgpass','PGSSLMODE=disable','ODDPATH_RECOVERY_SOURCE_ACK=FREEZE_SOURCE_KEEP_TARGET_QUARANTINED'];
 await writeFile(join(privateDir,'control.env'),control.join('\n'),{mode:0o600});await writeFile(join(privateDir,'admin_pgpass'),`postgres:5432:*:postgres:${admin}\n`,{mode:0o600});
 await docker('new-internal-network',['network','create','--internal','--label',label+'='+id,network]);created.push('network');
 for(const v of volumes){await docker('new-owned-volume',['volume','create','--label',label+'='+id,v]);created.push(v);}
 await docker('private-state-volume',[...tools('initial'),'--input-type=module'],{input:"import fs from 'node:fs';fs.chmodSync('/state',448);"});
 await docker('start-only-test-PG',['run','-d','--name',pg,'--label',label+'='+id,'--network',network,'--network-alias','postgres','-e','POSTGRES_PASSWORD='+admin,'-v',volumes[0]+':/var/lib/postgresql/data',pgImage,'postgres','-c','max_prepared_transactions=10']);containers.push(pg);
 await until('PG ready',async()=>(await docker('PG-ready',['exec',pg,'pg_isready','-U','postgres'],{allowFailure:true})).code===0);
 await sql(`CREATE ROLE runtime LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE recovery_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE DATABASE oddpath_current;`);
 await docker('all-current-migrations',['run','--rm','--label',label+'='+id,'--network',network,'-e',`DATABASE_URL=postgresql://postgres:${admin}@postgres:5432/oddpath_current?schema=public`,migration]);
 await sql('GRANT USAGE ON SCHEMA public TO runtime;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO runtime;CREATE TABLE recovery_probe(n int);INSERT INTO recovery_probe VALUES(1);', 'oddpath_current');
 await ready('oddpath_current');await check('closed-production-HTTP-works-before-quiescence',true);
 const seed=(await readFile(join(root,'ops/tests/fixtures/operations-seed.mjs'),'utf8')).replace("let input='';for await(const chunk of process.stdin)input+=chunk;",'let input='+JSON.stringify(JSON.stringify({password}))+';');
 await apiCode('seed-real-accounting','oddpath_current',seed);
 await apiCode('actual-account-deletion-before-current-copy','oddpath_current',"import {prisma as db} from './apps/api/dist/db/prisma.js';import {accountDataDeletionCoordinator} from './apps/api/dist/modules/account/account-data-deletion.js';try{await db.$transaction(tx=>accountDataDeletionCoordinator.deleteInTransaction(tx,'ops-user'));console.log('DELETED_BY_COORDINATOR');}finally{await db.$disconnect();}");
 const original=await snapshot('oddpath_current');report.beforeCurrentCopy=original;
 await check('current-source-has-ownerless-hold-and-confirmed-receipt-awaiting-settlement',original.users===0&&original.personalIdentities===0&&original.pending==='settlement_pending'&&!original.applied&&original.unknown===null&&original.hold===5&&original.holdStatus==='reserved');
 for(const suffix of ['busy','prepared','lost','race','invalid','unsafe','late','offline'])await sql(`CREATE DATABASE oddpath_${suffix} TEMPLATE oddpath_current;`);
 await sql("COMMENT ON DATABASE oddpath_current IS 'Owner''s current source';");
 const current=target('main');const result=JSON.parse((await stage('stage-current-source','main','oddpath_current',current)).stdout);report.stage=result;
 await check('current-source-copied-with-no-activation-or-release-authority',result.status==='CURRENT_SOURCE_STAGED_QUARANTINED'&&!result.activationAuthorized&&!result.releaseAuthorized&&result.postgresContinuity==='CURRENT_QUIESCED_SAME_CLUSTER_COPY'&&result.revocationContinuity==='UNVERIFIED'&&result.physicalStop==='UNVERIFIED');
 await check('source-and-target-durably-refuse-every-new-connection',await sql(`SELECT bool_and(NOT datallowconn) FROM pg_database WHERE datname IN ('oddpath_current','${current}')`)==='t');
 for(const db of ['oddpath_current',current]){const blocked=await docker('PG-rejects-even-superuser-new-connection',['exec',pg,'psql','-X','-U','postgres','-d',db,'-c','SELECT 1'],{allowFailure:true});await check('database-connection-fence-'+db,blocked.code!==0);}
 const fresh=JSON.parse((await command('fresh-process-revalidates-live-fences','main',['inspect-current'])).stdout);await check('fresh-process-revalidates-source-target-and-cluster',fresh.status==='CURRENT_SOURCE_FENCES_VALIDATED'&&!fresh.activationAuthorized);
 await docker('restart-PG-under-durable-fences',['restart',pg]);await until('PG restart',async()=>(await docker('PG-ready',['exec',pg,'pg_isready','-U','postgres'],{allowFailure:true})).code===0);
 await check('PG-restart-preserves-closed-source-and-target',(JSON.parse((await command('inspect-after-PG-restart','main',['inspect-current'])).stdout)).status==='CURRENT_SOURCE_FENCES_VALIDATED');
 const wrong=await cancel('main','wrong_source',{allowFailure:true});await check('wrong-cancellation-cannot-reopen-source',wrong.code!==0&&await sql("SELECT NOT datallowconn FROM pg_database WHERE datname='oddpath_current'")==='t');
 await cancel('main','oddpath_current');await cancel('main','oddpath_current');
 await check('explicit-cancel-is-idempotent-and-restores-exact-source-comment',await sql("SELECT datallowconn AND shobj_description(oid,'pg_database')='Owner''s current source' FROM pg_database WHERE datname='oddpath_current'")==='t');
 await check('cancel-keeps-target-closed',await sql(`SELECT NOT datallowconn FROM pg_database WHERE datname='${current}'`)==='t');
 await ready('oddpath_current');await check('source-HTTP-can-resume-after-explicit-cancel',true);
 // Deliberate administrator-only inspection of a cancelled historical copy.
 await sql(`ALTER DATABASE ${current} ALLOW_CONNECTIONS true;GRANT CONNECT ON DATABASE ${current} TO runtime;`);
 await check('current-copy-preserves-every-usage-row-and-account-deletion',JSON.stringify(await snapshot(current))===JSON.stringify(original));
 const denied=await docker('historical-copy-cannot-start-production-API',apiArgs(current),{allowFailure:true,timeout:20_000});await check('manual-target-opening-still-hits-application-quarantine',denied.code!==0&&denied.stderr.includes('RESTORE_DATABASE_QUARANTINED'));
 const reconcile="import {prisma} from './apps/api/dist/db/prisma.js';import {usageRepository} from './apps/api/dist/modules/usage/usage.repository.js';try{await usageRepository.reconcileExpiredUsage({strict:true});console.log('RECONCILED_TEST_ONLY');}finally{await prisma.$disconnect();}";
 for(let i=0;i<2;i++)await apiCode('isolated-accounting-primitive-no-provider',current,reconcile);
 const settled=await snapshot(current);await check('known-credits-settle-once-with-unknown-and-unexpired-hold-preserved',settled.credits===2&&settled.applied&&settled.unknown===null&&settled.unknownStatus==='unknown'&&settled.hold===5&&settled.holdStatus==='reserved'&&settled.users===0&&settled.events===3&&settled.receipts===1);
 const old=await command('cancelled-receipt-cannot-revalidate','main',['inspect-current'],{allowFailure:true});await check('cancelled-operation-never-becomes-current-proof-again',old.code!==0);
 // Existing target/unsafe owner are rejected before source closure.
 await sql(`CREATE ROLE bad_login LOGIN;CREATE ROLE bad_inherited NOLOGIN;CREATE ROLE ordinary LOGIN;GRANT bad_inherited TO ordinary;CREATE DATABASE ${target('existing')};`);
 for(const [suffix,ownerName,targetName] of [['login','bad_login',target('login')],['inherit','bad_inherited',target('inherit')],['existing','recovery_owner',target('existing')]]){
  const bad=await stage('reject-unsafe-'+suffix,suffix,'oddpath_unsafe',targetName,ownerName,{allowFailure:true});await check('unsafe-'+suffix+'-does-not-freeze-source',bad.code!==0&&await sql("SELECT datallowconn FROM pg_database WHERE datname='oddpath_unsafe'")==='t');
 }
 // A source session is real, not a mocked zero count.
 const hold=spawn('docker',['exec',pg,'psql','-X','-U','postgres','-d','oddpath_busy','-c',"SET application_name='current_source_hold';SELECT pg_sleep(90)"],{env,stdio:'ignore'});lockChild=new Promise((yes,no)=>{hold.once('close',yes);hold.once('error',no);});
 await until('source connection present',async()=>await sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='current_source_hold' AND wait_event='PgSleep')")==='t');
 const busy=await stage('busy-source-must-not-clone','busy','oddpath_busy',target('busy'),'recovery_owner',{allowFailure:true});await check('active-source-session-refused-before-freeze',busy.code!==0&&busy.stderr.includes('RECOVERY_SOURCE_NOT_QUIESCENT')&&await sql("SELECT datallowconn FROM pg_database WHERE datname='oddpath_busy'")==='t');
 await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='current_source_hold'");await lockChild;lockChild=undefined;
 await sql("BEGIN;INSERT INTO recovery_probe VALUES(2);PREPARE TRANSACTION 'current_source_prepared';",'oddpath_prepared');
 const prepared=await stage('prepared-transaction-refused','prepared','oddpath_prepared',target('prepared'),'recovery_owner',{allowFailure:true});await check('prepared-transaction-cannot-be-omitted-from-current-copy',prepared.code!==0&&prepared.stderr.includes('RECOVERY_SOURCE_NOT_QUIESCENT')&&await sql("SELECT datallowconn FROM pg_database WHERE datname='oddpath_prepared'")==='t');await sql("ROLLBACK PREPARED 'current_source_prepared'",'oddpath_prepared');
 // Lose a real CREATE reply after its PostgreSQL commit.
 const faultArgs=(mode,state,source,targetName,name)=>[...tools(state,{name,background:true,extra:['-e','ODDPATH_RECOVERY_LOCAL_TESTS=1','-e','ODDPATH_RECOVERY_TEST_FAULT='+mode,'-e','ODDPATH_RECOVERY_TEST_SOURCE='+source,'-e','ODDPATH_RECOVERY_TEST_TARGET='+targetName,'--mount','type=bind,src='+join(root,'ops/tests/fixtures/current-source-fault.mjs')+',dst=/opt/oddpath/ops/tests/fixtures/current-source-fault.mjs,readonly']}),'ops/tests/fixtures/current-source-fault.mjs'];
 const lateName=id+'-late';await docker('new-session-races-between-precheck-and-freeze',faultArgs('late-source-session','late','oddpath_late',target('late'),lateName));containers.push(lateName);await docker('wait-late-session-failure',['wait',lateName]);
 await check('late-source-session-cannot-slip-past-post-freeze-check',await sql("SELECT NOT datallowconn FROM pg_database WHERE datname='oddpath_late'")==='t'&&await sql(`SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='${target('late')}')`)==='t');await cancel('late','oddpath_late');
 const lostName=id+'-lost';await docker('inject-lost-CREATE-ack',faultArgs('lost-create-ack','lost','oddpath_lost',target('lost'),lostName));containers.push(lostName);await docker('wait-lost-ack-process',['wait',lostName]);
 await check('lost-CREATE-ack-keeps-source-and-target-closed',await sql(`SELECT count(*)=2 AND bool_and(NOT datallowconn) FROM pg_database WHERE datname IN ('oddpath_lost','${target('lost')}')`)==='t');
 const lostInspect=await command('lost-ack-cannot-report-current-success','lost',['inspect-current'],{allowFailure:true});await check('uncertain-persistence-cannot-issue-success',lostInspect.code!==0);
 await cancel('lost','oddpath_lost');await check('explicit-cancel-recovers-source-without-opening-lost-ack-target',await sql(`SELECT datallowconn FROM pg_database WHERE datname='oddpath_lost'`)==='t'&&await sql(`SELECT NOT datallowconn FROM pg_database WHERE datname='${target('lost')}'`)==='t');
 // Pause after the real freeze commit, compete, then cut the actual PG session.
 const raceName=id+'-race';await docker('pause-owner-after-real-freeze',faultArgs('pause-after-freeze','race','oddpath_race',target('race'),raceName));containers.push(raceName);
 await until('fault barrier',async()=>(await docker('read-only-barrier-probe',[...tools('reader'),'--input-type=module'],{input:"import fs from 'node:fs';process.exit(fs.existsSync('/state/fault-ready')?0:1)",allowFailure:true})).code===0);
 const contender=await stage('concurrent-owner-must-not-clone','contender','oddpath_race',target('contender'),'recovery_owner',{allowFailure:true});await check('concurrent-operation-cannot-steal-source-fence',contender.code!==0&&contender.stderr.includes('RECOVERY_DATABASE_BUSY'));
 await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='postgres' AND application_name='oddpath-backup' AND wait_event='PgSleep'");await docker('wait-disconnected-owner',['wait',raceName]);
 const restart=await stage('restart-with-new-state-cannot-adopt-frozen-source','race_restart','oddpath_race',target('retry'),'recovery_owner',{allowFailure:true});await check('disconnect-and-restart-do-not-auto-resume-or-reclone',restart.code!==0&&restart.stderr.includes('RECOVERY_OPERATIONAL_SOURCE_REQUIRED')&&await sql("SELECT NOT datallowconn FROM pg_database WHERE datname='oddpath_race'")==='t');
 await cancel('race','oddpath_race');await check('operator-can-explicitly-cancel-after-control-loss',await sql("SELECT datallowconn FROM pg_database WHERE datname='oddpath_race'")==='t');
 // A detected fence change permanently invalidates the saved success.
 const invalid=target('invalid');await stage('stage-for-live-revalidation','invalid','oddpath_invalid',invalid);await sql('ALTER DATABASE '+invalid+' ALLOW_CONNECTIONS true');
 const changed=await command('observe-opened-target','invalid',['inspect-current'],{allowFailure:true});await sql('ALTER DATABASE '+invalid+' ALLOW_CONNECTIONS false');
 const stale=await command('old-receipt-cannot-revive-after-reclosing','invalid',['inspect-current'],{allowFailure:true});await check('detected-target-change-cannot-revive-historical-success',changed.code!==0&&stale.code!==0&&stale.stderr.includes('RECOVERY_STAGE_NOT_COMPLETE'));await cancel('invalid','oddpath_invalid');
 await stage('stage-before-connection-outage','offline','oddpath_offline',target('offline'));
 await docker('stop-owned-PG-for-actual-outage',['stop','-t','10',pg]);
 const unavailable=await command('saved-success-cannot-replace-unavailable-PG','offline',['inspect-current'],{allowFailure:true});await check('database-outage-cannot-reuse-cached-success',unavailable.code!==0&&!unavailable.stdout.includes('CURRENT_SOURCE_FENCES_VALIDATED'));
 await docker('restart-owned-PG-after-outage',['start',pg]);await until('PG after outage',async()=>(await docker('PG-ready',['exec',pg,'pg_isready','-U','postgres'],{allowFailure:true})).code===0);
 await check('recovery-requires-new-live-fence-validation',(JSON.parse((await command('fresh-validation-after-PG-recovery','offline',['inspect-current'])).stdout)).status==='CURRENT_SOURCE_FENCES_VALIDATED');await cancel('offline','oddpath_offline');
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=safe(error.message);process.exitCode=1;
 await docker('failure-PG-diagnostics',['logs','--tail','60',pg],{allowFailure:true}).catch(()=>{});
 await docker('failure-operation-journal',[...tools('diagnostic'),'--input-type=module'],{input:"import fs from 'node:fs';for(const d of fs.readdirSync('/state')){const p='/state/'+d+'/state.json';if(fs.existsSync(p))console.log(fs.readFileSync(p,'utf8'));}",allowFailure:true}).catch(()=>{});
}
finally{
 if(lockChild){await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='current_source_hold'").catch(()=>{});await lockChild.catch(()=>{});}
 const owned=(await docker('owned-container-inventory',['ps','-aq','--filter','label='+label+'='+id])).stdout.trim().split('\n').filter(Boolean);
 for(const c of owned)await docker('remove-owned-container',['rm','-fv',c]);
 for(const v of volumes)if(created.includes(v)){assert.equal((await docker('volume-owner',['volume','inspect',v,'--format','{{index .Labels "'+label+'"}}'])).stdout.trim(),id);await docker('remove-owned-volume',['volume','rm',v]);}
 if(created.includes('network')){assert.equal((await docker('network-owner',['network','inspect',network,'--format','{{index .Labels "'+label+'"}}'])).stdout.trim(),id);await docker('remove-owned-network',['network','rm',network]);}
 assert.equal(dirname(resolve(privateDir)),privateRoot);assert(privateDir.startsWith(join(privateRoot,id+'-')));await rm(privateDir,{recursive:true,force:true});report.cleanup=true;await persist();console.log(JSON.stringify({status:report.status,checks:report.checks.length,cleanup:report.cleanup,error:report.error}));
}
