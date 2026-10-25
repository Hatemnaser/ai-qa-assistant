import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {join,resolve,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {checkedOutputDirectory} from '../../apps/api/scripts/verify-release.mjs';
import {sanitizeOutput,systemEnvironment} from '../../apps/api/scripts/verify-release-manifest.mjs';

assert.equal(process.env.ODDPATH_ALERT_LOCAL_TESTS,'1');
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);assert.deepEqual(args.slice(0,1),['--output-dir']);assert.equal(args.length,2);
const output=await checkedOutputDirectory(args[1],root);assert.equal((await readdir(output)).length,0);
const id='alerts-'+Date.now()+'-'+randomBytes(3).toString('hex'),label='com.oddpath.alert-test',privateDir=await mkdtemp(join(tmpdir(),id+'-'));
const image=process.env.ODDPATH_ALERT_TEST_IMAGE||'oddpath/phase08-operations:alerts-fixed-r1-20261023',apiImage='oddpath/phase08-api:stack-20261023',migrationImage='oddpath/phase08-api-migrations:stack-20261023';
const secrets=Array.from({length:10},()=>randomBytes(32).toString('hex')),[admin,migrator,runtime,backupPassword,key,smtpPassword,csrf,ipSalt,mail,unused]=secrets;
const names=['pg','pg-secret','maintenance','backup','archives','backup-secret','alert-state','alert-secrets','fixture'].map(n=>id+'-'+n);
const [pgV,pgS,maintV,backupV,archivesV,backupS,alertV,alertS,fixtureV]=names,created=[];
const report={id,status:'RUNNING',phaseAccepted:false,publicReleaseAuthorized:false,checks:[],commands:[],cleanup:false};
const persist=()=>writeFile(join(output,'verification.json'),JSON.stringify(report,null,2));
const safe=s=>sanitizeOutput(s,secrets),environment={...systemEnvironment(process.env),...Object.fromEntries(Object.entries(process.env).filter(([k])=>/^(?:Common)?ProgramFiles(?:\(x86\))?$/i.test(k)))};
async function docker(name,argv,{input,allowFailure=false,timeout=120000}={}) {
 const child=spawn('docker',argv,{cwd:root,env:environment,stdio:['pipe','pipe','pipe'],windowsHide:true});let stdout='',stderr='';const timer=setTimeout(()=>child.kill(),timeout);
 child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.stdin.end(input);
 const code=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});clearTimeout(timer);
 const log='command-'+String(report.commands.length+1).padStart(3,'0')+'.log';await writeFile(join(output,log),safe(stdout+'\n'+stderr));report.commands.push({name,code,log});await persist();if(!allowFailure)assert.equal(code,0,name+': '+safe(stderr));return{code,stdout,stderr};
}
async function check(name,condition){report.checks.push({name,status:condition?'PASS':'FAIL'});await persist();assert(condition,name);}
async function until(name,fn,timeout=90000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await fn())return;await delay(500);}throw Error('Timed out: '+name);}
const envFile=join(privateDir,'compose.env'),override=join(output,'fixture.compose.yml');
const base=['compose','--env-file',envFile,'-p',id,...['self-hosted.compose.yml','self-hosted.operations.compose.yml','self-hosted.alerts.compose.yml'].flatMap(f=>['-f',join(root,'deploy',f)]),'-f',override];
const compose=(name,args,options)=>docker(name,[...base,...args],options);
let pg,maintenance,backup,alerts,api,fixture;
const sql=async(query,database='oddpath')=>(await docker('synthetic-postgres-SQL',['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-At'],{input:query})).stdout.trim();
const readState=async(container,path)=>(JSON.parse((await docker('read-private-status',['exec',container,'node','-e',`console.log(require('fs').readFileSync(${JSON.stringify(path)},'utf8'))`])).stdout));
const alertState=()=>readState(alerts,'/var/lib/oddpath-alerts/status.json');
const fixtureState=async()=>JSON.parse((await docker('fixture-only-observations',['exec',fixture,'node','-e',"fetch('http://localhost:8080/state').then(r=>r.text()).then(console.log)"])).stdout);
const mode=change=>docker('fixture-only-failure-injection',['exec',fixture,'node','-e',`fetch('http://localhost:8080/mode',{method:'POST',body:${JSON.stringify(JSON.stringify(change))}}).then(r=>{if(!r.ok)process.exit(1)})`]);
const health=()=>docker('actual-alert-health',['exec',alerts,'node','ops/alerts.mjs','health'],{allowFailure:true});
try {
 const endpoint=(await docker('local-Docker-context',['context','inspect','--format','{{.Endpoints.docker.Host}}'])).stdout.trim();assert.match(endpoint,/^(npipe:|unix:)/);
 report.originalDatabase=JSON.parse((await docker('original-database-metadata-before',['inspect','ai-qa-assistant-postgres','--format','{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"health":{{json .State.Health.Status}}}'])).stdout);
 report.image=(await docker('actual-operations-image',['image','inspect',image,'--format','{{.Id}}'])).stdout.trim();
 const apiEnv=[`DATABASE_URL=postgresql://oddpath_runtime:${runtime}@postgres:5432/oddpath?schema=public`,'APP_ORIGIN=https://app.oddpath.test','CORS_ORIGIN=https://app.oddpath.test',`CSRF_SECRET=${csrf}`,`USAGE_IP_HASH_SALT=${ipSalt}`,'EMAIL_PROVIDER=smtp','EMAIL_FROM=Oddpath <no-reply@example.test>','SMTP_HOST=127.0.0.1','SMTP_PORT=9','SMTP_USER=synthetic',`SMTP_PASS=${smtpPassword}`,`EMAIL_OUTBOX_ENCRYPTION_SECRET=${mail}`];
 for(const[file,content]of Object.entries({'api.env':apiEnv.join('\n'),'migration.env':`DATABASE_URL=postgresql://oddpath_migrator:${migrator}@postgres:5432/oddpath?schema=public`,'backup.env':'PGHOST=postgres\nPGPORT=5432\nPGDATABASE=oddpath\nPGUSER=oddpath_backup\nPGSSLMODE=disable','admin':admin,'key':key,'pgpass':'placeholder','alerts.json':'placeholder','smtp-password':'placeholder'}))await writeFile(join(privateDir,file),content,{mode:0o600});
 const values={ODDPATH_API_IMAGE:apiImage,ODDPATH_MIGRATION_IMAGE:migrationImage,ODDPATH_POSTGRES_IMAGE:'postgres:16',ODDPATH_API_PORT:'0',ODDPATH_POSTGRES_VOLUME:pgV,ODDPATH_POSTGRES_PASSWORD_FILE:join(privateDir,'admin'),ODDPATH_API_ENV_FILE:join(privateDir,'api.env'),ODDPATH_MIGRATION_ENV_FILE:join(privateDir,'migration.env'),ODDPATH_OPERATIONS_IMAGE:image,ODDPATH_MAINTENANCE_STATE_VOLUME:maintV,ODDPATH_BACKUP_STATE_VOLUME:backupV,ODDPATH_ENCRYPTED_BACKUP_VOLUME:archivesV,ODDPATH_BACKUP_ENV_FILE:join(privateDir,'backup.env'),ODDPATH_BACKUP_KEY_FILE:join(privateDir,'key'),ODDPATH_BACKUP_PGPASS_FILE:join(privateDir,'pgpass'),ODDPATH_ALERT_STATE_VOLUME:alertV,ODDPATH_ALERT_BACKUP_STATE_VOLUME:backupV,ODDPATH_ALERT_CONFIG_FILE:join(privateDir,'alerts.json'),ODDPATH_ALERT_SMTP_PASSWORD_FILE:join(privateDir,'smtp-password')};
 await writeFile(envFile,Object.entries(values).map(([k,v])=>k+'='+v.replaceAll('\\','/')).join('\n'),{mode:0o600});
 // Windows secrets are provisioned as private native Linux files, not weakened.
 await writeFile(override,`services:\n  postgres:\n    secrets: !reset []\n    volumes:\n      - fixture-pg-secret:/run/secrets:ro\n  backup:\n    secrets: !reset []\n    volumes:\n      - fixture-backup-secret:/run/secrets:ro\n  alerts:\n    secrets: !reset []\n    environment:\n      NODE_EXTRA_CA_CERTS: /fixture/tls.crt\n    volumes:\n      - fixture-alert-secret:/run/secrets:ro\n      - fixture-data:/fixture:ro\nvolumes:\n  fixture-pg-secret: {external: true, name: ${pgS}}\n  fixture-backup-secret: {external: true, name: ${backupS}}\n  fixture-alert-secret: {external: true, name: ${alertS}}\n  fixture-data: {external: true, name: ${fixtureV}}\n`);
 await compose('validate-maintained-alert-overlay',['config','--quiet']);
 for(const v of names){assert.notEqual((await docker('confirm-unique-volume',['volume','inspect',v],{allowFailure:true})).code,0);await docker('create-owned-volume',['volume','create','--label',label+'='+id,v]);created.push(v);}
 const config={schemaVersion:1,instance:'synthetic',maintenanceState:'/observe/maintenance/status.json',backupState:'/observe/backup/status.json',backupScope:'CLOSED_DATABASE_ONLY',assets:false,apiReadyUrl:'http://api:5000/api/health/ready',smtp:{host:'fixture',port:2525,user:'synthetic',from:'ops@example.test',to:'owner@example.test',passwordFile:'/run/secrets/alert_smtp_password'}};
 const writes={'/pg-secret/postgres_admin_password':admin,'/backup-secret/backup_key':key,'/backup-secret/backup_pgpass':`postgres:5432:oddpath:oddpath_backup:${backupPassword}\n`,'/alert-secret/alert_config':JSON.stringify(config),'/alert-secret/alert_smtp_password':smtpPassword};
 await docker('provision-native-private-Linux-files',['run','--rm','-i','--network','none','--label',label+'='+id,'--user','0:0','--entrypoint','node',...[[pgS,'/pg-secret'],[backupS,'/backup-secret'],[alertS,'/alert-secret'],[maintV,'/maintenance'],[backupV,'/backup'],[archivesV,'/archives'],[alertV,'/alert'],[fixtureV,'/fixture']].flatMap(([v,p])=>['-v',v+':'+p]),'--tmpfs','/var/lib/postgresql/data',image,'--input-type=module','-e',"import fs from 'node:fs';let text='';for await(const c of process.stdin)text+=c;for(const p of ['/pg-secret','/backup-secret','/maintenance','/backup','/archives']){fs.chmodSync(p,0o700);fs.chownSync(p,999,999);}for(const p of ['/alert-secret','/alert'])fs.chmodSync(p,0o700);for(const [p,b]of Object.entries(JSON.parse(text))){fs.writeFileSync(p,b,{mode:0o600});if(!p.startsWith('/alert-secret/'))fs.chownSync(p,999,999);}"],{input:JSON.stringify(writes)});
 await compose('start-only-synthetic-postgres',['up','-d','--no-build','postgres']);pg=(await compose('owned-postgres',['ps','-q','postgres'])).stdout.trim();
 await until('PostgreSQL ready',async()=>(await docker('synthetic-pg-ready',['exec',pg,'pg_isready','-h','127.0.0.1','-U','postgres'],{allowFailure:true})).code===0);
 await sql(`CREATE ROLE oddpath_migrator LOGIN PASSWORD '${migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE oddpath_runtime LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE oddpath_backup LOGIN PASSWORD '${backupPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE DATABASE oddpath OWNER oddpath_migrator;REVOKE ALL ON DATABASE oddpath FROM PUBLIC;GRANT CONNECT ON DATABASE oddpath TO oddpath_runtime,oddpath_backup;`,'postgres');
 await sql('ALTER SCHEMA public OWNER TO oddpath_migrator;REVOKE ALL ON SCHEMA public FROM PUBLIC;GRANT USAGE ON SCHEMA public TO oddpath_runtime,oddpath_backup;');
 await compose('all-real-Prisma-migrations',['--profile','operations','run','--rm','--no-deps','migrate']);
 await sql('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO oddpath_runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_runtime;REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM oddpath_runtime;GRANT SELECT ON ALL TABLES IN SCHEMA public TO oddpath_backup;');
 await check('fresh-PostgreSQL-has-all-35-current-migrations',Number(await sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'))===35);
 await docker('create-private-SMTP-TLS-fixture',['run','-d','--name',id+'-fixture','--label',label+'='+id,'--network',id+'_database','--network-alias','fixture','--user','0:0','--entrypoint','sh','-v',fixtureV+':/fixture','-e','FIXTURE_PASSWORD='+smtpPassword,'--tmpfs','/var/lib/postgresql/data',image,'-c','openssl req -x509 -newkey rsa:2048 -nodes -keyout /fixture/tls.key -out /fixture/tls.crt -days 1 -subj /CN=fixture -addext subjectAltName=DNS:fixture >/dev/null 2>&1 && chmod 600 /fixture/tls.key && sleep infinity']);fixture=id+'-fixture';
 await until('fixture certificate ready',async()=>(await docker('fixture-cert',['exec',fixture,'test','-s','/fixture/tls.crt'],{allowFailure:true})).code===0);
 await docker('copy-synthetic-service-fixture',['cp',join(root,'ops/tests/fixtures/alerts-services.mjs'),fixture+':/fixture/services.mjs']);
 await docker('start-authenticated-STARTTLS-fixture',['exec','-d',fixture,'node','/fixture/services.mjs']);
 await until('fixture listening',async()=>{try{return(await fixtureState()).smtp==='accept';}catch{return false;}});
 await compose('start-real-closed-API-and-operations',['--profile','maintenance','--profile','backup','up','-d','--no-build','api','maintenance','backup']);
 api=(await compose('owned-api',['ps','-q','api'])).stdout.trim();maintenance=(await compose('owned-maintenance',['ps','-q','maintenance'])).stdout.trim();backup=(await compose('owned-backup',['ps','-q','backup'])).stdout.trim();
 await until('real maintenance completes',async()=>{try{const s=await readState(maintenance,'/var/lib/oddpath-ops/status.json');return s.jobs.usage?.outcome==='PASS'&&s.jobs.retention?.outcome==='PASS';}catch{return false;}});
 await until('real backup completes',async()=>{try{return(await readState(backup,'/var/lib/oddpath-backup-state/status.json')).jobs.backup?.outcome==='PASS';}catch{return false;}});
 await compose('start-maintained-notifier-service',['--profile','alerts','up','-d','--no-deps','--no-build','alerts']);alerts=(await compose('owned-alerts',['ps','-q','alerts'])).stdout.trim();
 await until('initial healthy scan',async()=>(await health()).code===0);
 await check('healthy-startup-sends-no-mail',(await fixtureState()).messages.length===0);
 const inspection=JSON.parse((await docker('inspect-only-own-notifier',['inspect',alerts])).stdout)[0];
 await check('notifier-has-no-DB-API-vault-credentials-or-socket',!inspection.Config.Env.some(v=>/^(DATABASE_URL|PGPASSFILE|CSRF_SECRET|GEMINI_API_KEY)=/.test(v))&&!inspection.Mounts.some(m=>m.Destination.includes('docker.sock')));
 await check('source-state-mounts-are-read-only',inspection.Mounts.filter(m=>m.Destination.startsWith('/observe/')).length===2&&inspection.Mounts.filter(m=>m.Destination.startsWith('/observe/')).every(m=>!m.RW));
 const denied=await docker('read-only-source-write-is-refused',['exec',alerts,'node','-e',"require('fs').writeFileSync('/observe/backup/status.json','overwrite')"],{allowFailure:true});await check('actual-Linux-mount-denies-notifier-source-write',denied.code!==0&&denied.stderr.includes('EROFS'));
 await mode({smtp:'reject'});
 await sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='oddpath-ops-maintenance'");
 await until('real supervisor persisted disconnect failure',async()=>{const s=await readState(maintenance,'/var/lib/oddpath-ops/status.json');return Object.values(s.jobs).some(j=>j.failurePending);});
 await until('real SMTP rejection seen',async()=>(await fixtureState()).messages.length===1);
 const pending=await alertState();await check('SMTP-451-retains-durable-incident-and-fails-health',pending.pending?.type==='FAILURE'&&pending.incident&&(await health()).code!==0);
 await docker('SIGKILL-only-notifier',['kill','--signal','KILL',alerts]);await docker('restart-only-notifier',['start',alerts]);
 await until('restarted notifier resumes same incident',async()=>{try{return(await alertState()).pending?.id===pending.pending.id;}catch{return false;}});
 await delay(1000);await check('restart-cannot-immediately-resend-durable-backoff',(await fixtureState()).messages.length===1&&(await health()).code!==0);
 await mode({smtp:'accept'});
 await until('same notice accepted on bounded retry',async()=>{const s=await alertState();return !s.pending&&s.incident?.alertAcceptedAt;},90000);
 let messages=(await fixtureState()).messages;await check('retry-uses-same-Message-ID-over-real-STARTTLS',messages.length===2&&messages[0].id===messages[1].id&&messages.every(m=>m.secured&&m.authenticated));
 await compose('recover-real-maintenance-after-DB-disconnect',['--profile','maintenance','up','-d','--no-deps','maintenance']);
 await until('real recovery mail and health',async()=>(await health()).code===0,120000);
 await check('recovery-follows-confirmed-new-job-success',(await fixtureState()).messages.at(-1).subject.includes('RECOVERY'));
 const priorCount=(await fixtureState()).messages.length;
 await docker('stop-only-owned-backup',['stop',backup]);await sql('REVOKE SELECT ON "User" FROM oddpath_backup');
 const failure=await compose('actual-pg-dump-permission-failure',['--profile','backup','run','--rm','--no-deps','backup','once'],{allowFailure:true});
 await check('real-backup-failure-is-nonzero',failure.code!==0);
 await until('backup failure notification',async()=>(await fixtureState()).messages.length>priorCount);
 await check('failed-backup-never-reuses-previous-success-health',(await health()).code!==0&&(await alertState()).failures.includes('backup'));
 await sql('GRANT SELECT ON "User" TO oddpath_backup');await compose('explicit-real-backup-retry',['--profile','backup','run','--rm','--no-deps','backup','once']);await compose('resume-normal-backup-supervision',['--profile','backup','up','-d','--no-deps','backup']);
 await until('verified backup recovery health',async()=>(await health()).code===0);
 const beforeAPI=(await fixtureState()).messages.length;await docker('stop-only-owned-API',['stop',api]);
 await until('API unavailable notification',async()=>(await fixtureState()).messages.length>beforeAPI);
 await check('real-HTTP-connection-loss-is-alerted',(await alertState()).failures.includes('api')&&(await health()).code!==0);
 await docker('restart-only-owned-API',['start',api]);await until('actual API recovery',async()=>(await health()).code===0);
 const count=(await fixtureState()).messages.length;await delay(16000);await check('healthy-polls-do-not-send-duplicates',(await fixtureState()).messages.length===count);
 const duplicate=await compose('second-notifier-owner-refused',['--profile','alerts','run','--rm','--no-deps','alerts','once'],{allowFailure:true});await check('second-process-cannot-take-state-ownership',duplicate.code!==0&&(await health()).code===0);
 const test=await docker('explicit-SMTP-test-with-trusted-CA',['exec',alerts,'node','ops/alerts.mjs','test']);await check('test-reports-SMTP-acceptance-without-inbox-claim',test.stdout.includes('SMTP_ACCEPTED')&&test.stdout.includes('UNVERIFIED'));
 await mode({smtp:'anonymous'});const beforeAnonymous=(await fixtureState()).messages.length;
 await docker('test-only-anonymous-TLS-negative-control',['exec',alerts,'node','--input-type=module','-e',"import nodemailer from 'nodemailer';const fs=await import('node:fs/promises');const c=JSON.parse(await fs.readFile('/run/secrets/alert_config'));await nodemailer.createTransport({host:c.smtp.host,port:c.smtp.port,requireTLS:true,tls:{rejectUnauthorized:true}}).sendMail({from:c.smtp.from,to:c.smtp.to,subject:'synthetic anonymous negative control',text:'synthetic test only'});"]);
 let anonymousMessages=(await fixtureState()).messages;
 await check('negative-control-proves-server-accepts-anonymous-TLS-mail',anonymousMessages.length===beforeAnonymous+1&&anonymousMessages.at(-1).secured&&!anonymousMessages.at(-1).authenticated);
 const anonymous=await docker('production-notifier-must-authenticate',['exec',alerts,'node','ops/alerts.mjs','test'],{allowFailure:true});
 await check('SMTP-cannot-succeed-without-authentication',anonymous.code!==0&&!anonymous.stdout.includes('SMTP_ACCEPTED')&&anonymous.stderr.includes('MONITOR_FAILED')&&(await fixtureState()).messages.length===beforeAnonymous+1);
 await mode({smtp:'hidden-auth'});const beforeHidden=(await fixtureState()).messages.length;
 const hidden=await docker('SMTP-with-unadvertised-AUTH-still-must-authenticate',['exec',alerts,'node','ops/alerts.mjs','test']);anonymousMessages=(await fixtureState()).messages;
 await check('SMTP-success-without-advertised-AUTH-requires-a-real-authenticated-exchange',hidden.stdout.includes('SMTP_ACCEPTED')&&anonymousMessages.length===beforeHidden+1&&anonymousMessages.at(-1).authenticated&&anonymousMessages.at(-1).secured);
 await mode({smtp:'accept'});
 const beforeUntrusted=(await fixtureState()).messages.length;
 const untrusted=await docker('untrusted-SMTP-certificate-refused',['exec',alerts,'env','-u','NODE_EXTRA_CA_CERTS','node','ops/alerts.mjs','test'],{allowFailure:true});
 await check('SMTP-requires-a-trusted-certificate',untrusted.code!==0&&untrusted.stderr.includes('MONITOR_FAILED')&&(await fixtureState()).messages.length===beforeUntrusted);
 await mode({smtp:'no-tls'});const beforeTls=(await fixtureState()).messages.length;
 const tlsFailure=await docker('SMTP-without-STARTTLS-is-refused',['exec',alerts,'node','ops/alerts.mjs','test'],{allowFailure:true});await check('SMTP-cannot-downgrade-to-plaintext',tlsFailure.code!==0&&tlsFailure.stderr.includes('MONITOR_FAILED')&&(await fixtureState()).messages.length===beforeTls);
 await mode({smtp:'hang'});const started=Date.now();const timeout=await docker('bounded-SMTP-ack-timeout',['exec',alerts,'node','ops/alerts.mjs','test'],{allowFailure:true,timeout:25000});await check('missing-SMTP-ack-never-reports-accepted',timeout.code!==0&&!timeout.stdout.includes('SMTP_ACCEPTED')&&timeout.stderr.includes('MONITOR_FAILED')&&Date.now()-started<20000);
 await mode({smtp:'accept'});messages=(await fixtureState()).messages;
 await check('notifications-contain-no-product-secrets-or-user-content',!secrets.some(secret=>JSON.stringify(messages).includes(secret))&&!JSON.stringify(messages).includes('DATABASE_URL'));
 await check('existing-prod-gates-stay-closed',(await docker('own-closed-API-config',['inspect',api,'--format','{{json .Config.Env}}'])).stdout.includes('QA_EXECUTION_V2_ENABLED=false'));
 report.status='PASS';
}catch(error){report.status='FAIL';report.error=safe(error.message);process.exitCode=1;
 try{await compose('owned-failure-diagnostics',['--profile','alerts','--profile','maintenance','--profile','backup','logs','--no-color','--tail','25']);}catch{}
}finally{
 if(fixture)try{assert.equal((await docker('verify-fixture-ownership',['inspect',fixture,'--format','{{index .Config.Labels "'+label+'"}}'])).stdout.trim(),id);await docker('remove-only-owned-fixture',['rm','-f',fixture]);}catch(error){report.cleanupError=safe(error.message);}
 if(created.length)try{await compose('stop-only-owned-compose',['--profile','alerts','--profile','maintenance','--profile','backup','down','--remove-orphans']);for(const v of created){assert.equal((await docker('verify-volume-ownership',['volume','inspect',v,'--format','{{index .Labels "'+label+'"}}'])).stdout.trim(),id);await docker('remove-only-owned-volume',['volume','rm',v]);}report.cleanup=true;}catch(error){report.cleanupError=safe(error.message);report.status='FAIL';process.exitCode=1;}
 if(report.originalDatabase){const after=JSON.parse((await docker('original-database-metadata-after',['inspect','ai-qa-assistant-postgres','--format','{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"health":{{json .State.Health.Status}}}'])).stdout);assert.deepEqual(after,report.originalDatabase);}
 assert(resolve(privateDir).startsWith(resolve(tmpdir())+sep));await rm(privateDir,{recursive:true,force:true});await persist();console.log(JSON.stringify({status:report.status,checks:report.checks.length,cleanup:report.cleanup,error:report.error,output}));
}
