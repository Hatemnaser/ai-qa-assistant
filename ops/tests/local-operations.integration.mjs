import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { resolve, dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { checkedOutputDirectory, runCommand } from '../../apps/api/scripts/verify-release.mjs';
import { sanitizeOutput, systemEnvironment } from '../../apps/api/scripts/verify-release-manifest.mjs';

// Destructive work is restricted to new uniquely labeled local Docker resources.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
assert.equal(process.env.ODDPATH_OPS_LOCAL_TESTS,'1','Set ODDPATH_OPS_LOCAL_TESTS=1');
const argv=process.argv.slice(2);assert.equal(argv.length,2);assert.equal(argv[0],'--output-dir');
const output=await checkedOutputDirectory(argv[1],root);assert.equal((await readdir(output)).length,0);
const id=`ops-${Date.now()}-${randomBytes(3).toString('hex')}`,label='com.oddpath.ops-rehearsal';
const ownVolume=suffix=>`${id}-${suffix}`;
const volumes=['pg','state','backup-state','backups','secrets','restore-secrets','pg-secrets'].map(ownVolume);
const [pgVolume,stateVolume,backupStateVolume,backupVolume,secretsVolume,restoreSecretsVolume,pgSecretsVolume]=volumes;
const privateDir=await mkdtemp(join(tmpdir(),`${id}-`));
const secretValues=Array.from({length:11},()=>randomBytes(32).toString('hex'));
const [admin,migrator,runtime,backupPassword,restorePassword,key,csrf,mail,loginPassword,ipSalt,smtpPassword]=secretValues;
const apiImage='oddpath/phase08-api:local-20261018',migrationImage='oddpath/phase08-api-migrations:local-20261019',image=process.env.ODDPATH_OPS_TEST_IMAGE??'oddpath/phase08-operations:state-ownership-fix-20261020';
const report={schemaVersion:1,id,scope:'LOCAL_CLOSED_OPERATIONS_BACKUP_RESTORE',phaseAccepted:false,publicReleaseAuthorized:false,status:'RUNNING',startedAt:new Date().toISOString(),checks:[],commands:[],cleanup:{},limits:['No off-host uploader or live notification delivery','Database-only backup refuses browser/vault/object data','Restore remains quarantined; no post-snapshot financial/deletion continuity inferred','Windows Docker Desktop test secrets use owned private Linux volumes instead of host-file binds']};
const persist=()=>writeFile(join(output,'verification.json'),JSON.stringify(report,null,2)+'\n');
const safe=text=>sanitizeOutput(text,secretValues);
const dockerEnvironment={...systemEnvironment(process.env),...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:Common)?ProgramFiles(?:\(x86\))?$/i.test(key)))};
async function check(name,condition,details={}){report.checks.push({name,status:condition?'PASS':'FAIL',...details});await persist();assert.ok(condition,name);}
async function command(name,args,{input,allowFailure=false,timeoutMs=120000}={}){
 const started=Date.now();let result,failure;
 try {
 if(input!==undefined){
   // runCommand intentionally has no stdin; Docker stdin fixtures use execFile.
   const {spawn}=await import('node:child_process');
   result=await new Promise((accept,reject)=>{const c=spawn('docker',args,{cwd:root,env:dockerEnvironment,windowsHide:true,stdio:['pipe','pipe','pipe']});let out='',err='';const t=setTimeout(()=>c.kill(),timeoutMs);c.stdout.on('data',v=>{out+=v;});c.stderr.on('data',v=>{err+=v;});c.on('error',reject);c.on('close',code=>{clearTimeout(t);accept({code,stdout:out,stderr:err});});c.stdin.on('error',()=>{});c.stdin.end(input);});
 }else result=await runCommand('docker',args,{env:dockerEnvironment,cwd:root,timeoutMs});
 }catch(error){failure=error;result=error.result??{code:null,stdout:'',stderr:error.message};}
 const log=`command-${String(report.commands.length+1).padStart(3,'0')}.log`;
 await writeFile(join(output,log),safe(result.stdout+'\n'+result.stderr));report.commands.push({name,code:result.code,durationMs:Date.now()-started,log});await persist();
 if(failure)throw new Error(`${name}: ${failure.message}`);
 if(!allowFailure)assert.equal(result.code,0,`${name}: ${safe(result.stderr)}`);return result;
}
const envFile=join(privateDir,'compose.env'),override=join(output,'test-transport.compose.yml');
const composeArgs=['compose','--env-file',envFile,'-p',id,'-f',join(root,'deploy/self-hosted.compose.yml'),'-f',join(root,'deploy/self-hosted.operations.compose.yml'),'-f',override];
const compose=(name,args,options)=>command(name,[...composeArgs,...args],options);
let pg,maintenance,backupContainer,created=[];
async function sql(name,query,database='oddpath'){return(command(name,['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-A','-t','-U','postgres','-d',database],{input:query})).then(r=>r.stdout.trim());}
async function until(name,probe,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){if(await probe())return;await delay(1000);}throw new Error(`${name} timed out`);}
async function inspect(name){return JSON.parse((await command('inspect-own-resource',['inspect',name])).stdout)[0];}
async function state(container,path='/var/lib/oddpath-ops/status.json'){const r=await command('read-private-ops-status',['exec',container,'node','-e',`process.stdout.write(require('node:fs').readFileSync(${JSON.stringify(path)}))`],{allowFailure:true});return r.code===0?JSON.parse(r.stdout):undefined;}
const apiEnv=[`DATABASE_URL=postgresql://oddpath_runtime:${runtime}@postgres:5432/oddpath?schema=public`,'APP_ORIGIN=https://oddpath.example.invalid','CORS_ORIGIN=https://oddpath.example.invalid',`CSRF_SECRET=${csrf}`,`USAGE_IP_HASH_SALT=${ipSalt}`,'EMAIL_PROVIDER=smtp','EMAIL_FROM=Oddpath <no-reply@example.invalid>','SMTP_HOST=127.0.0.1','SMTP_PORT=9','SMTP_USER=synthetic',`SMTP_PASS=${smtpPassword}`,`EMAIL_OUTBOX_ENCRYPTION_SECRET=${mail}`];
const sharedEnv=['--network',`${id}_database`,'--label',`${label}=${id}`,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m'];
const backupEnv=['-e','PGHOST=postgres','-e','PGPORT=5432','-e','PGDATABASE=oddpath','-e','PGUSER=oddpath_backup','-e','PGSSLMODE=disable','-e','PGPASSFILE=/run/secrets/backup_pgpass','-e','ODDPATH_BACKUP_KEY_FILE=/run/secrets/backup_key','-e','ODDPATH_BACKUP_DIRECTORY=/var/lib/oddpath-backups'];
const backupMounts=['-v',`${secretsVolume}:/run/secrets:ro`,'-v',`${backupVolume}:/var/lib/oddpath-backups`];
const backupCommand=(name,args,options={})=>command(name,['run','--rm','--pull=never',...sharedEnv,...backupMounts,...backupEnv,image,...args],options);
const restoreDb=`oddpath_restore_${randomBytes(8).toString('hex')}`;
const editPrivate=(name,code)=>command(name,['run','--rm','--network','none','--user','0:0','--label',`${label}=${id}`,'--entrypoint','node','-v',`${backupVolume}:/archives`,'-v',`${secretsVolume}:/private`,'-v',`${stateVolume}:/state`,'-v',`${backupStateVolume}:/backup-state`,'--tmpfs','/var/lib/postgresql/data',image,'-e',code]);
async function restoreCommand(name,archive,{db=restoreDb,ack='ISOLATED_EMPTY_TARGET',allowFailure=false}={}){
 return command(name,['run','--rm','--pull=never',...sharedEnv,'-v',`${restoreSecretsVolume}:/run/secrets:ro`,'-v',`${backupVolume}:/var/lib/oddpath-backups`,...backupEnv,'-e',`PGDATABASE=${db}`,'-e','PGUSER=oddpath_restore_operator','-e','PGPASSFILE=/run/secrets/restore_pgpass','-e',`ODDPATH_RESTORE_ACK=${ack}`,image,'restore',`/var/lib/oddpath-backups/${archive}`,'--confirm-target',db],{allowFailure});
}
try{
 const endpoint=JSON.parse((await command('verify-local-docker-context',['context','inspect','--format','{{json .Endpoints.docker.Host}}'])).stdout);assert.ok(endpoint.startsWith('npipe:////./pipe/')||endpoint.startsWith('unix:///'),'Only local Docker sockets are permitted');
 await command('review-required-cached-images',['image','inspect',image,apiImage,migrationImage,'postgres:16']);
 await writeFile(join(privateDir,'admin'),admin,{mode:0o600});await writeFile(join(privateDir,'key'),key,{mode:0o600});await writeFile(join(privateDir,'pgpass'),'synthetic',{mode:0o600});
 await writeFile(join(privateDir,'api.env'),apiEnv.join('\n')+'\n',{mode:0o600});
 await writeFile(join(privateDir,'migration.env'),`DATABASE_URL=postgresql://oddpath_migrator:${migrator}@postgres:5432/oddpath?schema=public\n`,{mode:0o600});
 await writeFile(join(privateDir,'backup.env'),'PGHOST=postgres\nPGPORT=5432\nPGDATABASE=oddpath\nPGUSER=oddpath_backup\nPGSSLMODE=disable\n',{mode:0o600});
 const interpolation={ODDPATH_API_IMAGE:apiImage,ODDPATH_MIGRATION_IMAGE:migrationImage,ODDPATH_POSTGRES_IMAGE:'postgres:16',ODDPATH_API_PORT:'0',ODDPATH_POSTGRES_VOLUME:pgVolume,ODDPATH_POSTGRES_PASSWORD_FILE:join(privateDir,'admin'),ODDPATH_API_ENV_FILE:join(privateDir,'api.env'),ODDPATH_MIGRATION_ENV_FILE:join(privateDir,'migration.env'),ODDPATH_OPERATIONS_IMAGE:image,ODDPATH_MAINTENANCE_STATE_VOLUME:stateVolume,ODDPATH_BACKUP_STATE_VOLUME:backupStateVolume,ODDPATH_ENCRYPTED_BACKUP_VOLUME:backupVolume,ODDPATH_BACKUP_ENV_FILE:join(privateDir,'backup.env'),ODDPATH_BACKUP_KEY_FILE:join(privateDir,'key'),ODDPATH_BACKUP_PGPASS_FILE:join(privateDir,'pgpass')};
 await writeFile(envFile,Object.entries(interpolation).map(([k,v])=>`${k}=${v.replaceAll('\\','/')}`).join('\n')+'\n',{mode:0o600});
 await writeFile(override,`services:\n  postgres:\n    secrets: !reset []\n    volumes:\n      - rehearsal-pg-secrets:/run/secrets:ro\n  backup:\n    secrets: !reset []\n    volumes:\n      - rehearsal-backup-secrets:/run/secrets:ro\nvolumes:\n  rehearsal-backup-secrets:\n    external: true\n    name: ${secretsVolume}\n  rehearsal-pg-secrets:\n    external: true\n    name: ${pgSecretsVolume}\n`);
 await compose('validate-real-operations-overlay',['config','--quiet']);
 for(const volume of volumes){const prior=await command('ensure-test-volume-unused',['volume','inspect',volume],{allowFailure:true});assert.notEqual(prior.code,0);await command('create-owned-test-volume',['volume','create','--label',`${label}=${id}`,volume]);created.push(volume);}
 const init=`import fs from 'node:fs';let t='';for await(const c of process.stdin)t+=c;const s=JSON.parse(t);for(const p of ['/state','/backup-state','/archives','/private','/restore-private','/pg-private']){fs.chmodSync(p,0o700);fs.chownSync(p,999,999);}for(const [p,value]of Object.entries(s)){fs.writeFileSync(p,value,{mode:0o600});fs.chownSync(p,999,999);}`;
 await command('initialize-private-owned-Linux-volumes',['run','--rm','--network','none','--user','0:0','--label',`${label}=${id}`,'--entrypoint','node','-i','-v',`${stateVolume}:/state`,'-v',`${backupStateVolume}:/backup-state`,'-v',`${backupVolume}:/archives`,'-v',`${secretsVolume}:/private`,'-v',`${restoreSecretsVolume}:/restore-private`,'-v',`${pgSecretsVolume}:/pg-private`,'--tmpfs','/var/lib/postgresql/data',image,'--input-type=module','-e',init],{input:JSON.stringify({'/private/backup_key':key,'/private/backup_pgpass':`postgres:5432:oddpath:oddpath_backup:${backupPassword}\n`,'/restore-private/backup_key':key,'/restore-private/restore_pgpass':`postgres:5432:*:oddpath_restore_operator:${restorePassword}\n`,'/pg-private/postgres_admin_password':admin})});
 await compose('start-isolated-postgres',['up','-d','--no-build','postgres']);pg=(await compose('get-postgres-id',['ps','-q','postgres'])).stdout.trim();
 await until('PostgreSQL ready',async()=> (await command('pg-isready',['exec',pg,'pg_isready','-U','postgres'],{allowFailure:true})).code===0);
 await command('bootstrap-restricted-synthetic-roles',['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:`CREATE ROLE oddpath_migrator LOGIN PASSWORD '${migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;CREATE ROLE oddpath_runtime LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;CREATE ROLE oddpath_backup LOGIN PASSWORD '${backupPassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;CREATE ROLE oddpath_restore_operator LOGIN PASSWORD '${restorePassword}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;CREATE DATABASE oddpath OWNER oddpath_migrator;CREATE DATABASE ${restoreDb} OWNER oddpath_restore_operator;REVOKE ALL ON DATABASE oddpath FROM PUBLIC;REVOKE ALL ON DATABASE ${restoreDb} FROM PUBLIC;GRANT CONNECT ON DATABASE oddpath TO oddpath_runtime,oddpath_backup;\n\\connect oddpath\nALTER SCHEMA public OWNER TO oddpath_migrator;REVOKE ALL ON SCHEMA public FROM PUBLIC;GRANT USAGE ON SCHEMA public TO oddpath_runtime,oddpath_backup;`});
 await compose('apply-real-migrations',['--profile','operations','run','--rm','--no-deps','migrate'],{timeoutMs:180000});
 await sql('grant-existing-runtime-and-read-only-backup',`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO oddpath_runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_runtime;REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM oddpath_runtime;GRANT SELECT ON ALL TABLES IN SCHEMA public TO oddpath_backup;GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_backup;ALTER DEFAULT PRIVILEGES FOR ROLE oddpath_migrator IN SCHEMA public GRANT SELECT ON TABLES TO oddpath_backup;`);
 const seed=await readFile(new URL('./fixtures/operations-seed.mjs',import.meta.url),'utf8');
 await compose('seed-real-relational-and-accounting-data',['run','--rm','--no-deps','--entrypoint','node','-T','-i','api','--input-type=module','-e',seed],{input:JSON.stringify({password:loginPassword})});
 await check('all-34-migrations-present',Number(await sql('migration-count','SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;'))===34);
 const readonly=await sql('backup-role-is-read-only',`SELECT NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT has_schema_privilege('oddpath_backup','public','CREATE') AND NOT has_table_privilege('oddpath_backup','"User"','INSERT') AND NOT has_table_privilege('oddpath_backup','"User"','UPDATE') AND NOT has_table_privilege('oddpath_backup','"User"','DELETE') FROM pg_roles WHERE rolname='oddpath_backup';`);
 await check('backup-uses-distinct-read-only-role',readonly==='t');
 const create=JSON.parse((await backupCommand('create-and-authenticate-encrypted-backup',['create'])).stdout.trim());
 await check('real-pg-dump-encrypted-and-verified',create.status==='ENCRYPTED_BACKUP_VERIFIED'&&create.offHostCopyVerified===false);report.backup=create;
 const listing=await command('verify-no-plaintext-or-part-files',['run','--rm','--network','none','--label',`${label}=${id}`,'--entrypoint','node','-v',`${backupVolume}:/archives:ro`,'--tmpfs','/var/lib/postgresql/data',image,'-e',"const fs=require('node:fs');const names=fs.readdirSync('/archives');if(names.some(n=>n.endsWith('.dump')||n.endsWith('.part')))process.exit(2);const archive=fs.readFileSync('/archives/'+names.find(n=>n.endsWith('.opb')));if(archive.includes(Buffer.from('ops@example.invalid')))process.exit(3);console.log('NO_PLAINTEXT');"]);
 await check('archive-storage-has-no-plaintext-or-partials',listing.stdout.includes('NO_PLAINTEXT'));
 await editPrivate('make-tampered-owned-copy',`const fs=require('node:fs');fs.mkdirSync('/archives/tampered',{mode:0o700});fs.chownSync('/archives/tampered',999,999);const p=${JSON.stringify('/archives/'+create.archive)},b=fs.readFileSync(p);b[b.length-20]^=1;const target=${JSON.stringify('/archives/tampered/'+create.archive)};fs.writeFileSync(target,b,{mode:0o600});fs.chownSync(target,999,999);`);
 const badDb=restoreDb+'_bad';await sql('create-only-empty-tamper-test-target',`CREATE DATABASE ${badDb} OWNER oddpath_restore_operator;REVOKE ALL ON DATABASE ${badDb} FROM PUBLIC;`);
 const tampered=await restoreCommand('tampered-backup-refused-before-restore',`tampered/${create.archive}`,{db:badDb,allowFailure:true});
 await check('tampered-archive-cannot-write-any-target-table',tampered.code!==0&&await sql('tamper-target-remains-empty',`SELECT to_regclass('public."User"') IS NULL;`,badDb)==='t');
 await editPrivate('make-owned-key-too-permissive',"require('node:fs').chmodSync('/private/backup_key',0o644)");
 const weakKey=await backupCommand('unsafe-key-permissions-fail-closed',['create'],{allowFailure:true});await check('actual-Linux-key-mode-is-enforced',weakKey.code!==0&&weakKey.stderr.includes('OPS_FILE_PERMISSIONS'));
 await editPrivate('restore-private-key-mode',"require('node:fs').chmodSync('/private/backup_key',0o600)");
 await sql('revoke-backup-select-to-inject-dump-failure','REVOKE SELECT ON "User" FROM oddpath_backup;');
 const failedDump=await backupCommand('real-pg-dump-fails-without-read-access',['create'],{allowFailure:true});await check('pg-dump-error-is-not-success',failedDump.code!==0);
 await sql('restore-read-only-backup-access','GRANT SELECT ON "User" TO oddpath_backup;');
 const failedFiles=await editPrivate('failed-backup-left-no-published-or-partial-new-archive',"const fs=require('node:fs'),names=fs.readdirSync('/archives');console.log(JSON.stringify({archives:names.filter(n=>n.endsWith('.opb')).length,parts:names.filter(n=>n.endsWith('.part')).length}));");
 const failedFileCounts=JSON.parse(failedFiles.stdout);await check('failed-dump-retains-prior-good-backup-without-partials',failedFileCounts.archives===1&&failedFileCounts.parts===0);
 await restoreCommand('authenticated-restore-to-new-empty-database',create.archive);
 const publicDb=restoreDb+'_public';await sql('create-only-test-target-with-unsafe-default-PUBLIC-access',`CREATE DATABASE ${publicDb} OWNER oddpath_restore_operator;`);
 const publicTarget=await restoreCommand('restore-refuses-empty-but-public-target',create.archive,{db:publicDb,allowFailure:true});await check('restored-data-is-never-written-to-publicly-connectable-database',publicTarget.code!==0&&await sql('public-target-remains-empty',`SELECT to_regclass('public."User"') IS NULL;`,publicDb)==='t');
 const accountingSql=`SELECT json_build_object('credits', (SELECT "creditsUsed" FROM "UsageEvent" WHERE id='ops-pending'),'receiptApplied',(SELECT "appliedAt" IS NOT NULL FROM "UsageSettlementReceipt" WHERE "attemptId"='ops-attempt'),'unknownStatus',(SELECT status FROM "UsageEvent" WHERE id='ops-unknown'),'unknownCredits',(SELECT "creditsUsed" FROM "UsageEvent" WHERE id='ops-unknown'),'holdStatus',(SELECT status FROM "UsageEvent" WHERE id='ops-active-hold'),'holdUnits',(SELECT units FROM "UsageEvent" WHERE id='ops-active-hold'),'receiptCount',(SELECT count(*) FROM "UsageSettlementReceipt"));`;
 const beforeRecovery=JSON.parse(await sql('restored-accounting-before-reconciliation',accountingSql,restoreDb));
 await check('snapshot-preserves-pending-receipt-unknown-and-active-hold',beforeRecovery.receiptApplied===false&&beforeRecovery.unknownStatus==='unknown'&&beforeRecovery.unknownCredits===null&&beforeRecovery.holdStatus==='reserved'&&beforeRecovery.holdUnits===5);
 await command('real-Prisma-migration-status-on-restored-database',['run','--rm','--pull=never',...sharedEnv,'-e',`DATABASE_URL=postgresql://oddpath_restore_operator:${restorePassword}@postgres:5432/${restoreDb}?schema=public`,migrationImage,'node','node_modules/prisma/build/index.js','migrate','status','--config','apps/api/prisma.config.ts']);
 await check('restored-migration-history-matches-current-build',Number(await sql('restored-migration-count','SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL;',restoreDb))===34);
 for(const table of ['User','Project','Chat','Message','ProjectDocument','ProjectMemory','Memory']){
   const query=`SELECT md5(coalesce(jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text)::text,'')) FROM "${table}" t;`;
   await check(`restored-${table}-content-matches-snapshot`,await sql('source-data-hash',query)===await sql('restored-data-hash',query,restoreDb));
 }
 const refused=await restoreCommand('restore-refuses-non-empty-target',create.archive,{allowFailure:true});await check('non-empty-target-is-never-overwritten',refused.code!==0);
 const missingAck=await restoreCommand('restore-refuses-missing-acknowledgement',create.archive,{ack:'',allowFailure:true});await check('restore-needs-explicit-isolated-target-ack',missingAck.code!==0);
 // Direct ACLs alone do not fence inherited, SET-only or mixed role paths.
 await sql('create-only-synthetic-quarantine-members',`CREATE ROLE ops_ordinary LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE ops_bridge NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;`);
 const memberships=[
   {name:'inherited',grant:'GRANT oddpath_restore_operator TO ops_ordinary',connect:true,set:true},
   {name:'transitive',grant:'GRANT oddpath_restore_operator TO ops_bridge;GRANT ops_bridge TO ops_ordinary',connect:true,set:true},
   {name:'set_only',grant:'GRANT oddpath_restore_operator TO ops_ordinary WITH INHERIT FALSE, SET TRUE',connect:false,set:true},
   {name:'mixed_path',grant:'GRANT oddpath_restore_operator TO ops_bridge WITH INHERIT TRUE, SET FALSE;GRANT ops_bridge TO ops_ordinary WITH INHERIT FALSE, SET TRUE',connect:false,set:false},
 ];
 for(const membership of memberships){
   const target=restoreDb+'_'+membership.name;
   await sql('prepare-empty-target-with-membership-'+membership.name,`CREATE DATABASE ${target} OWNER oddpath_restore_operator;REVOKE ALL ON DATABASE ${target} FROM PUBLIC;${membership.grant};`);
   const access=JSON.parse(await sql('assert-real-privilege-path-'+membership.name,`SELECT json_build_object('connect',has_database_privilege('ops_ordinary','${target}','CONNECT'),'set',pg_has_role('ops_ordinary','oddpath_restore_operator','SET'),'member',pg_has_role('ops_ordinary','oddpath_restore_operator','MEMBER'));`));
   assert.deepEqual(access,{connect:membership.connect,set:membership.set,member:true});
   const refusedMembership=await restoreCommand('restore-refuses-'+membership.name+'-access',create.archive,{db:target,allowFailure:true});
   await check('quarantine-rejects-'+membership.name+'-access-before-writing',refusedMembership.code!==0&&refusedMembership.stderr.includes('RESTORE_TARGET_NOT_EMPTY_OR_ISOLATED')&&await sql('unsafe-target-stays-empty-'+membership.name,`SELECT to_regclass('public."User"') IS NULL;`,target)==='t');
   await sql('remove-only-test-memberships-'+membership.name,'REVOKE oddpath_restore_operator FROM ops_ordinary,ops_bridge;REVOKE ops_bridge FROM ops_ordinary;');
 }
 // Recovery executes database accounting only, twice, with existing runtime role.
  await sql('grant-restored-runtime-dml',`GRANT CONNECT ON DATABASE ${restoreDb} TO oddpath_runtime;GRANT USAGE ON SCHEMA public TO oddpath_runtime;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO oddpath_runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_runtime;REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM oddpath_runtime;`,restoreDb);
  await sql('inject-real-transient-settlement-failure',`CREATE SEQUENCE ops_failure_sequence MINVALUE 0 START 0;GRANT USAGE,SELECT ON ops_failure_sequence TO oddpath_runtime;CREATE FUNCTION ops_fail_once() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF nextval('ops_failure_sequence')=0 THEN RAISE EXCEPTION 'synthetic transient settlement failure';END IF;RETURN NEW;END$$;CREATE TRIGGER ops_settlement_failure BEFORE UPDATE OF "appliedAt" ON "UsageSettlementReceipt" FOR EACH ROW WHEN (OLD."appliedAt" IS NULL AND NEW."appliedAt" IS NOT NULL) EXECUTE FUNCTION ops_fail_once();`,restoreDb);
 for(let n=0;n<2;n++) await compose('reconcile-restored-receipt-without-provider',['run','--rm','--no-deps','--entrypoint','node','-e',`DATABASE_URL=postgresql://oddpath_runtime:${runtime}@postgres:5432/${restoreDb}?schema=public`,'api','apps/api/dist/scripts/usage-reconcile.js']);
  await check('actual-PostgreSQL-settlement-failure-was-exercised',Number(await sql('fault-sequence-evidence','SELECT last_value FROM ops_failure_sequence;',restoreDb))>=1);
  await sql('remove-only-test-failure-injection','DROP TRIGGER ops_settlement_failure ON "UsageSettlementReceipt";DROP FUNCTION ops_fail_once();DROP SEQUENCE ops_failure_sequence;',restoreDb);
 const recovered=JSON.parse(await sql('restored-accounting-after-idempotent-recovery',accountingSql,restoreDb));
 await check('recovery-applies-confirmed-credits-once-and-keeps-unknown-separate',recovered.credits===2&&recovered.receiptApplied===true&&recovered.receiptCount===1&&recovered.unknownCredits===null&&recovered.unknownStatus==='unknown'&&recovered.holdStatus==='reserved'&&recovered.holdUnits===5);
 await compose('start-real-maintenance-and-backup-supervisors',['--profile','maintenance','--profile','backup','up','-d','--no-build','api','maintenance','backup']);
 maintenance=(await compose('maintenance-id',['ps','-q','maintenance'])).stdout.trim();backupContainer=(await compose('backup-id',['ps','-q','backup'])).stdout.trim();
 await until('maintenance completes real commands',async()=>{const s=await state(maintenance);return s?.jobs?.usage?.outcome==='PASS'&&s.jobs.retention?.outcome==='PASS';});
 await until('backup supervisor completes real backup',async()=>{const s=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');return s?.jobs?.backup?.outcome==='PASS';});
 await check('both-supervisors-complete-their-real-jobs',true);
 await check('retention-actually-deletes-expired-session',await sql('expired-session-is-gone',`SELECT count(*) FROM "Session" WHERE id='ops-expired-session';`)==='0');
 const maintained=JSON.parse(await sql('source-accounting-after-maintenance',accountingSql));await check('maintenance-recovers-receipt-without-double-charge-or-lost-hold',maintained.credits===2&&maintained.receiptCount===1&&maintained.unknownCredits===null&&maintained.holdUnits===5&&maintained.holdStatus==='reserved');
 const inspectMaintenance=await inspect(maintenance),inspectBackup=await inspect(backupContainer);
 await check('maintenance-inherits-closed-gates-with-no-public-ports',inspectMaintenance.Config.Env.includes('QA_EXECUTION_V2_ENABLED=false')&&inspectMaintenance.Config.Env.includes('AI_ENABLED=false')&&Object.values(inspectMaintenance.NetworkSettings.Ports??{}).every(v=>v===null));
 await check('backup-nonroot-readonly-no-socket-or-application-secrets',inspectBackup.Config.User==='postgres:postgres'&&inspectBackup.HostConfig.ReadonlyRootfs&&inspectBackup.HostConfig.CapDrop.includes('ALL')&&!inspectBackup.Mounts.some(m=>m.Destination.includes('docker.sock'))&&!inspectBackup.Config.Env.some(v=>v.startsWith('DATABASE_URL=')||v.startsWith('CSRF_SECRET=')||v.includes(migrator)||v.includes(runtime)));
 const duplicate=await compose('attempt-concurrent-second-maintenance',['run','--rm','--no-deps','maintenance','once'],{allowFailure:true});await check('concurrent-supervisor-cannot-run-or-overwrite-active-state',duplicate.code!==0&&(await state(maintenance)).status==='RUNNING');
 // Failure injection on actual PostgreSQL, not a mocked accounting exception.
 await compose('stop-postgres-to-test-supervision',['stop','postgres']);
 await until('lost lock becomes durable failure',async()=>{const s=await state(maintenance);return s?.status==='FAILED';},45000);
 const unhealthy=await command('actual-health-fails-after-database-disconnect',['exec',maintenance,'node','ops/maintenance.mjs','health'],{allowFailure:true});
 await check('DB-disconnection-is-not-reported-as-healthy',unhealthy.code!==0);
 const expired=`oddpath-${new Date(Date.now()-8*86400000).toISOString().replace(/[-:.]/g,'')}-${randomUUID()}.opb`;
 await editPrivate('seed-owned-expired-archive',`require('node:fs').writeFileSync(${JSON.stringify('/archives/'+expired)},'synthetic expired artifact',{mode:0o600});`);
 const offlinePrune=await command('archive-retention-with-no-DB-or-key-configuration',['run','--rm','--network','none','--label',`${label}=${id}`,'--read-only','--cap-drop','ALL','--tmpfs','/var/lib/postgresql/data','-v',`${backupVolume}:/archives`,'-e','ODDPATH_BACKUP_DIRECTORY=/archives',image,'prune']);
 await check('seven-day-retention-continues-during-DB-and-key-unavailability',JSON.parse(offlinePrune.stdout).expiredRemoved===1);
 await compose('recover-postgres',['start','postgres']);
 await until('supervisor restarts and recovers',async()=>{const s=await state(maintenance);return s?.status==='RUNNING'&&s.jobs.usage.outcome==='PASS'&&s.jobs.retention.outcome==='PASS';},120000);
 const restarted=await inspect(maintenance);await check('supervisor-restarted-after-lock-loss',restarted.RestartCount>=1);
 await compose('restart-maintenance-container',['restart','maintenance']);
 await until('restart retains schedule and status',async()=>{const s=await state(maintenance);return s?.status==='RUNNING'&&s.jobs.usage.outcome==='PASS';});
 const after=JSON.parse(await sql('final-credit-hold-invariants',accountingSql));await check('restart-and-recovery-preserve-credit-hold-invariants',after.credits===2&&after.receiptCount===1&&after.unknownCredits===null&&after.holdStatus==='reserved'&&after.holdUnits===5);
 const beforeDiskFailure=await inspect(maintenance);
 await editPrivate('make-only-test-state-volume-unwritable',"require('node:fs').chmodSync('/state',0o500)");
 await until('state-write-failure-releases-client-and-exits',async()=> (await inspect(maintenance)).RestartCount>beforeDiskFailure.RestartCount,45000);
 await check('state-write-failure-does-not-strand-the-database-client-or-process',true);
 const repairedAt=Date.now();
 await editPrivate('restore-test-state-volume-permissions',"require('node:fs').chmodSync('/state',0o700)");
 await until('maintenance-recovers-after-state-storage-repaired',async()=>{const s=await state(maintenance);return s?.status==='RUNNING'&&s.heartbeatAt>=repairedAt&&s.jobs.usage.outcome==='PASS';},90000);
 // Kill only the real backup child, after decrypted data exists. The daemon's
 // container must restart and clear its tmpfs before health can succeed again.
 await compose('pause-owned-backup-before-child-fault',['stop','backup']);
 await sql('prepare-real-backup-child-fault-payload',`CREATE TABLE ops_kill_payload(id integer PRIMARY KEY,body text);INSERT INTO ops_kill_payload SELECT n,string_agg(md5(random()::text),'') FROM generate_series(1,1000)n CROSS JOIN generate_series(1,512)b GROUP BY n;GRANT SELECT ON ops_kill_payload TO oddpath_backup;`);
 await editPrivate('make-next-backup-due-without-changing-live-supervisor-state',"const fs=require('node:fs'),p='/backup-state/status.json',s=JSON.parse(fs.readFileSync(p));s.jobs.backup.finishedAt=0;s.jobs.backup.outcome='FAIL';fs.writeFileSync(p,JSON.stringify(s),{mode:0o600});");
 await compose('start-owned-backup-for-child-fault',['start','backup']);
 const beforeChildFault=await inspect(backupContainer);
 const killChild=`const fs=await import('node:fs/promises'),sleep=ms=>new Promise(r=>setTimeout(r,ms)),end=Date.now()+30000;let killed=false;while(Date.now()<end&&!killed){for(const n of await fs.readdir('/tmp'))if(n.startsWith('oddpath-restore-')){const p='/tmp/'+n+'/verified.dump';let info;try{info=await fs.stat(p);}catch{continue;}if(info.size<65536)continue;for(const pid of await fs.readdir('/proc'))if(/^[0-9]+$/.test(pid)){let args;try{args=(await fs.readFile('/proc/'+pid+'/cmdline','utf8')).split('\\0');}catch{continue;}if(args[1]==='ops/backup.mjs'&&args[2]==='create'){const file=await fs.open('/var/lib/oddpath-backup-state/child-kill.json','w',0o600);await file.writeFile(JSON.stringify({path:p,bytes:info.size,at:Date.now()}));await file.sync();await file.close();process.kill(+pid,'SIGKILL');killed=true;break;}}if(killed)break;}if(!killed)await sleep(1);}if(!killed)throw new Error('No real backup plaintext child was observed');`;
 await command('kill-only-backup-child-during-real-plaintext-verification',['exec',backupContainer,'node','--input-type=module','-e',killChild],{allowFailure:true,timeoutMs:45000});
 await until('child-failure-restarts-its-own-container',async()=>{const i=await inspect(backupContainer);return i.State.Running&&i.RestartCount>beforeChildFault.RestartCount&&i.State.StartedAt!==beforeChildFault.State.StartedAt;},45000);
 const killedChild=JSON.parse((await command('read-durable-child-only-fault-receipt',['exec',backupContainer,'node','-e',"process.stdout.write(require('node:fs').readFileSync('/var/lib/oddpath-backup-state/child-kill.json'))"])).stdout);
 await check('backup-child-SIGKILL-is-terminal-and-restarts-container',killedChild.bytes>=65536);
 const tempsAfterFault=JSON.parse((await command('inspect-new-container-tmpfs-after-child-only-death',['exec',backupContainer,'node','-e',"console.log(JSON.stringify(require('node:fs').readdirSync('/tmp').filter(n=>n.startsWith('oddpath-restore-'))))"])).stdout);
 await check('child-only-failure-clears-orphan-plaintext-before-retry',tempsAfterFault.length===0);
 const pendingHealth=await command('health-cannot-hide-interrupted-backup-before-retry',['exec',backupContainer,'node','ops/maintenance.mjs','health'],{allowFailure:true});
 await check('backup-health-stays-failed-until-fresh-success',pendingHealth.code!==0);
 // Hold the replacement pg_dump after the real child failure/restart. A recent
 // success from BEFORE the failure must not make this in-progress retry healthy.
 const lockApplication='ops_backup_retry_health_lock';
 const holder=runCommand('docker',['exec',pg,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','oddpath','-c',`SET application_name='${lockApplication}';BEGIN;LOCK TABLE ops_kill_payload IN ACCESS EXCLUSIVE MODE;SELECT pg_sleep(110);ROLLBACK;`],{env:dockerEnvironment,cwd:root,timeoutMs:120000});
 holder.catch(()=>{});
 try{
   await until('independent-retry-lock-is-held',async()=>Number(await sql('observe-real-retry-lock',`SELECT count(*) FROM pg_stat_activity WHERE application_name='${lockApplication}' AND wait_event='PgSleep';`))===1);
   await until('replacement-pg-dump-is-blocked',async()=>Number(await sql('observe-replacement-dump-waiting',"SELECT count(*) FROM pg_stat_activity WHERE application_name='pg_dump' AND datname='oddpath' AND wait_event_type='Lock';"))>0,90000);
   const retry=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');
   const retryHealth=await command('health-during-blocked-replacement-backup',['exec',backupContainer,'node','ops/maintenance.mjs','health'],{allowFailure:true});
   await check('blocked-backup-retry-cannot-reuse-pre-failure-health',retry.jobs.backup.outcome==='RUNNING'&&retry.jobs.backup.lastSuccessAt<killedChild.at&&retryHealth.code!==0);
   await until('retry-receives-a-new-heartbeat-without-completing',async()=>{const s=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');return s?.jobs.backup.outcome==='RUNNING'&&s.heartbeatAt>retry.heartbeatAt;},20000);
   const freshRetryHealth=await command('health-after-fresh-blocked-retry-heartbeat',['exec',backupContainer,'node','ops/maintenance.mjs','health'],{allowFailure:true});
   await check('fresh-heartbeat-does-not-clear-unresolved-backup-failure',freshRetryHealth.code!==0);
 }finally{
   await sql('release-only-synthetic-retry-lock',`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='${lockApplication}';`);
   const result=await holder;await writeFile(join(output,'backup-retry-lock.log'),safe(result.stdout+'\n'+result.stderr));
 }
 await until('backup-retries-after-clean-container-restart',async()=>{const s=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');return s?.jobs?.backup?.outcome==='PASS'&&s.jobs.backup.lastSuccessAt>killedChild.at;},100000);
 const recoveredBackupHealth=await command('health-succeeds-only-after-clean-backup-retry',['exec',backupContainer,'node','ops/maintenance.mjs','health']);
 const previousHash=(await editPrivate('earlier-encrypted-archive-survives-child-death',`const fs=require('node:fs'),crypto=require('node:crypto');console.log(crypto.createHash('sha256').update(fs.readFileSync(${JSON.stringify('/archives/'+create.archive)})).digest('hex'));`)).stdout.trim();
 await check('fresh-backup-success-retains-prior-good-encrypted-archive',recoveredBackupHealth.code===0&&previousHash===create.sha256);
 await sql('remove-only-synthetic-child-fault-payload','DROP TABLE ops_kill_payload;');
 const backupBefore=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json'),killedAt=Date.now();
 await command('abruptly-kill-only-backup-supervisor',['kill','--signal','KILL',backupContainer]);await compose('restart-only-owned-backup-supervisor',['start','backup']);
 await until('backup OS lock recovered after abrupt exit',async()=>{const s=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');return s?.status==='RUNNING'&&s.heartbeatAt>killedAt;});
 const backupAfter=await state(backupContainer,'/var/lib/oddpath-backup-state/status.json');await check('abrupt-restart-releases-local-lock-and-preserves-daily-backup-schedule',backupAfter.jobs.backup.lastSuccessAt===backupBefore.jobs.backup.lastSuccessAt);
 await sql('introduce-object-row-to-prove-database-only-scope',`INSERT INTO "StoredAsset" (id,"ownerId","objectKey",purpose,"originalName","declaredMimeType","expectedSizeBytes","checksumSha256","updatedAt") VALUES('ops-asset','ops-user','synthetic-object','CHAT_ATTACHMENT','synthetic.txt','text/plain',1,'${'a'.repeat(64)}',now());`);
 const unsupported=await backupCommand('database-only-backup-refuses-object-data',['create'],{allowFailure:true});await check('incomplete-object-backup-is-refused',unsupported.code!==0&&unsupported.stderr.includes('BACKUP_FULL_RUNTIME_OR_ASSET_TOPOLOGY_REQUIRED'));
 await sql('remove-only-synthetic-object-scope-fixture',`DELETE FROM "StoredAsset" WHERE id='ops-asset';`);
 // API smoke on the restored DB stays closed; actual cookie/session writes work.
 const restoredApi=`${id}-restored-api`;
 await compose('start-restored-closed-API',['run','--detach','--no-deps','--name',restoredApi,'--publish','127.0.0.1::5000','-e',`DATABASE_URL=postgresql://oddpath_runtime:${runtime}@postgres:5432/${restoreDb}?schema=public`,'api']);
 const restoredInspection=await inspect(restoredApi),port=restoredInspection.NetworkSettings.Ports['5000/tcp'][0];assert.equal(port.HostIp,'127.0.0.1');const url=`http://127.0.0.1:${port.HostPort}`;
 await until('restored API readiness',async()=>{try{return(await fetch(`${url}/api/health/ready`,{signal:AbortSignal.timeout(3000)})).status===200}catch{return false;}});
 const csrfResponse=await fetch(`${url}/api/auth/csrf`,{headers:{'X-Forwarded-Proto':'https'}}),csrfBody=await csrfResponse.json();secretValues.push(csrfBody.csrfToken);
 const login=await fetch(`${url}/api/auth/login`,{method:'POST',headers:{Origin:'https://oddpath.example.invalid','Content-Type':'application/json','X-CSRF-Token':csrfBody.csrfToken,Cookie:`qa_csrf=${csrfBody.csrfToken}`,'X-Forwarded-Proto':'https'},body:JSON.stringify({email:'ops@example.invalid',password:loginPassword}),signal:AbortSignal.timeout(10000)});
 const body=await login.json(),session=login.headers.getSetCookie().find(c=>c.startsWith('qa_session='));
 await check('real-restored-HTTP-login-and-cookie-succeed',login.status===200&&body.user?.id==='ops-user'&&Boolean(session)&&/; Secure/i.test(session));
 const me=await fetch(`${url}/api/auth/me`,{headers:{Cookie:session.split(';')[0]},signal:AbortSignal.timeout(10000)});await check('real-restored-HTTP-session-is-readable',me.status===200&&(await me.json()).user.id==='ops-user');
 const restoreStatus=await command('read-quarantined-restore-receipt',['run','--rm','--network','none','--label',`${label}=${id}`,'--entrypoint','node','-v',`${backupVolume}:/archives:ro`,'--tmpfs','/var/lib/postgresql/data',image,'-e',"process.stdout.write(require('node:fs').readFileSync('/archives/restore-status.json'))"]);const receipt=JSON.parse(restoreStatus.stdout);await check('restore-never-authorizes-release-or-claims-financial-continuity',receipt.status==='RESTORED_QUARANTINED'&&receipt.releaseAuthorized===false&&receipt.financialContinuity==='UNVERIFIED');
 report.status='PASS_LOCAL_OPERATIONS';
}catch(error){report.status='FAIL';report.error=safe(error.stack??error.message);process.exitCode=1;}
finally{
 try{
  const ids=new Set();for(const filter of [`label=com.docker.compose.project=${id}`,`label=${label}=${id}`])for(const c of (await command('find-owned-containers',['ps','-aq','--filter',filter])).stdout.trim().split(/\s+/).filter(Boolean))ids.add(c);
  for(const c of ids){const info=await inspect(c);assert.ok(info.Config.Labels?.[label]===id||info.Config.Labels?.['com.docker.compose.project']===id);await command('remove-exact-owned-container',['rm','-f','-v',c]);}
  const networks=(await command('find-owned-networks',['network','ls','-q','--filter',`label=com.docker.compose.project=${id}`])).stdout.trim().split(/\s+/).filter(Boolean);for(const n of networks){const info=JSON.parse((await command('inspect-own-network',['network','inspect',n])).stdout)[0];assert.equal(info.Labels['com.docker.compose.project'],id);assert.equal(Object.keys(info.Containers??{}).length,0);await command('remove-own-network',['network','rm',n]);}
  for(const v of created){const info=JSON.parse((await command('inspect-own-volume',['volume','inspect',v])).stdout)[0];assert.equal(info.Labels[label],id);await command('remove-own-test-volume',['volume','rm',v]);}
  report.cleanup.resourcesRemoved=true;
 }catch(error){report.cleanup.resourcesRemoved=false;report.cleanup.error=safe(error.message);report.status='FAIL';process.exitCode=1;}
 assert.ok(resolve(privateDir).startsWith(resolve(tmpdir())+sep)&&dirname(privateDir)===resolve(tmpdir()));await rm(privateDir,{recursive:true,force:true});report.cleanup.syntheticSecretFilesRemoved=true;report.finishedAt=new Date().toISOString();await persist();
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='FAIL'),cleanup:report.cleanup,output}));
}
