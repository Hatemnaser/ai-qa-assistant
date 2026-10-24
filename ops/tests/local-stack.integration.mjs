import assert from 'node:assert/strict';
import {randomBytes,createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,writeFile,readdir,rm} from 'node:fs/promises';
import {resolve,join,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync,spawn} from 'node:child_process';
import https from 'node:https';
import {setTimeout as delay} from 'node:timers/promises';
import ts from 'typescript';
import {checkedOutputDirectory} from '../../apps/api/scripts/verify-release.mjs';
import {systemEnvironment,sanitizeOutput} from '../../apps/api/scripts/verify-release-manifest.mjs';
import {stackBrowser} from './fixtures/stack-browser.mjs';

assert.equal(process.env.ODDPATH_STACK_LOCAL_TESTS,'1','Explicit synthetic local stack interlock required');
const root=resolve(import.meta.dirname,'../..'),args=process.argv.slice(2);assert.equal(args.length,2);assert.equal(args[0],'--output-dir');
const out=await checkedOutputDirectory(args[1],root);assert.equal((await readdir(out)).length,0);
const id='stack-'+Date.now()+'-'+randomBytes(3).toString('hex'),label='com.oddpath.stack-rehearsal';
const privateDir=await mkdtemp(join(tmpdir(),id+'-')),secrets=Array.from({length:14},()=>randomBytes(32).toString('hex'));
const [admin,migrator,runtime,backupPw,restorePw,backupKey,password,csrf,ipSalt,mail,viewer,routing,projectKey,revocationKey]=secrets;
const smtpPassword=randomBytes(32).toString('hex');secrets.push(smtpPassword);
const vaultKeys={storage:{activeVersion:'v1',keys:{v1:randomBytes(32).toString('hex')}},transfer:{activeVersion:'v1',keys:{v1:randomBytes(32).toString('hex')}},revocationKey};
secrets.push(...Object.values(vaultKeys.storage.keys),...Object.values(vaultKeys.transfer.keys));
const image={api:process.env.ODDPATH_STACK_API_IMAGE||'oddpath/phase08-api:stack-20261023',migrations:process.env.ODDPATH_STACK_MIGRATION_IMAGE||'oddpath/phase08-api-migrations:stack-20261023',operations:process.env.ODDPATH_STACK_OPERATIONS_IMAGE||'oddpath/phase08-operations:stack-20261023',web:process.env.ODDPATH_STACK_WEB_IMAGE||'oddpath/web:stack-ws-20261023',supervisor:process.env.ODDPATH_STACK_SUPERVISOR_IMAGE||'oddpath/browser-supervisor:stack-20261023',chrome:process.env.ODDPATH_STACK_CHROME_IMAGE||'oddpath/chrome-runtime:login-repair-20261021',egress:process.env.ODDPATH_STACK_EGRESS_IMAGE||'oddpath/browser-egress:transport-fixed-20261022'};
const volumeNames=['pg','vault','journal','maintenance','backup-state','archives','pg-secrets','api-secrets','control-secrets','tls-secrets','backup-secrets'].map(s=>id+'-'+s);
const [pgV,vaultV,journalV,maintV,backupV,archivesV,pgS,apiS,controlS,tlsS,backupS]=volumeNames;
const report={id,status:'RUNNING',phaseAccepted:false,publicReleaseAuthorized:false,scope:'LOCAL_THREE_FILE_STACK',checks:[],commands:[],cleanup:false};
const persist=()=>writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));
const safe=s=>sanitizeOutput(s,secrets);
// Docker Desktop locates its Compose plugin through Windows ProgramFiles.
// Preserve only those system paths in addition to the existing allowlist.
const dockerEnv={...systemEnvironment(process.env),...Object.fromEntries(Object.entries(process.env).filter(([key])=>/^(?:Common)?ProgramFiles(?:\(x86\))?$/i.test(key)))};
async function check(name,value){report.checks.push({name,status:value?'PASS':'FAIL'});await persist();assert.ok(value,name);}
async function docker(name,argv,{input,allowFailure=false,timeout=120000}={}){
 const child=spawn('docker',argv,{cwd:root,env:dockerEnv,windowsHide:true,stdio:['pipe','pipe','pipe']});let stdout='',stderr='';
 const timer=setTimeout(()=>child.kill(),timeout);child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.on('error',()=>{});child.stdin.end(input);
 const code=await new Promise((r,j)=>{child.once('error',j);child.once('close',r);});clearTimeout(timer);
 const log='command-'+String(report.commands.length+1).padStart(3,'0')+'.log';await writeFile(join(out,log),safe(stdout+'\n'+stderr));report.commands.push({name,code,log});await persist();
 if(!allowFailure)assert.equal(code,0,name+': '+safe(stderr));return {code,stdout,stderr};
}
const envPath=join(privateDir,'compose.env'),transport=join(out,'test-transport.compose.yml'),active=join(out,'synthetic-browser.compose.yml');
const base=['compose','--env-file',envPath,'-p',id,'-f',join(root,'deploy/self-hosted.compose.yml'),'-f',join(root,'deploy/self-hosted.operations.compose.yml'),'-f',join(root,'deploy/self-hosted.stack.compose.yml'),'-f',transport];
let browserMode=false,pg,api,ui;const executionProjects=[],createdVolumes=[];let created=false;
const compose=(name,argv,options)=>docker(name,[...base,...(browserMode?['-f',active]:[]),...argv],options);
const container=async service=>(await compose('container-'+service,['ps','-aq',service])).stdout.trim();
const inspect=async name=>JSON.parse((await docker('inspect-owned',['inspect',name])).stdout)[0];
const sql=async(query,database='oddpath')=>(await docker('synthetic-SQL',['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d',database,'-At'],{input:query})).stdout.trim();
async function until(name,fn,timeout=90000){const end=Date.now()+timeout;while(Date.now()<end){const result=await fn();if(result)return result;await delay(400);}throw Error('Timed out: '+name);}
let ca;const appOrigin='https://app.oddpath.test:8443',apiOrigin='https://api.oddpath.test:8443',viewerOrigin='https://browser.oddpath.test:8443';
function request(host,path,{method='GET',headers={},body,trust=true}={}){
 return new Promise((r,j)=>{const req=https.request({host:'127.0.0.1',port:8443,servername:host,ca:trust?ca:undefined,path,method,headers:{host:host+':8443',...headers},timeout:5000},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>r({status:res.statusCode,headers:res.headers,text}));});req.on('error',j);req.on('timeout',()=>req.destroy(Error('TLS request timeout')));req.end(body===undefined?undefined:JSON.stringify(body));});
}
let cookie='',csrfToken='';
const ownerRequest=(path,body,method='POST')=>request('api.oddpath.test',path,{method,headers:{origin:appOrigin,cookie,'content-type':'application/json','x-csrf-token':csrfToken},body});
const compiledFixture=async()=>{
 const helper=ts.transpileModule(await readFile(join(root,'apps/api/tests/helpers/quotaBrowserFixture.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('../../src/','/opt/oddpath/apps/api/dist/').replaceAll('.ts\'', '.js\'').replaceAll("'@oddpath/qa-execution-contract'","'/opt/oddpath/packages/qa-execution-contract/dist/index.js'");
 const main=ts.transpileModule(await readFile(join(root,'ops/tests/fixtures/stack-qa.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022}}).outputText.replaceAll('../../../apps/api/src/','/opt/oddpath/apps/api/dist/').replaceAll('../../../apps/api/tests/helpers/quotaBrowserFixture.ts','/tmp/oddpath-stack-qafixture.mjs').replaceAll('.ts\'', '.js\'');
 return "const fs=await import('node:fs/promises');await fs.writeFile('/tmp/oddpath-stack-qafixture.mjs',"+JSON.stringify(helper)+");await fs.writeFile('/tmp/oddpath-stack-main.mjs',"+JSON.stringify(main)+");await import('file:///tmp/oddpath-stack-main.mjs');";
};
async function fixture(phase,data={}){const code=await compiledFixture();const result=await docker('fixture-'+phase,['exec','-i','-e','ODDPATH_STACK_INPUT='+JSON.stringify({phase,...data}),api,'node','--input-type=module'],{input:code});return JSON.parse(result.stdout.trim());}
try{
 const endpoint=JSON.parse((await docker('local-context',['context','inspect','--format','{{json .Endpoints.docker.Host}}'])).stdout);assert.match(endpoint,/^(unix:\/\/\/|npipe:\/\/\/\/\.\/pipe\/)/);
 const originalFormat='{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"health":{{json .State.Health.Status}}}';
 report.originalDatabase=JSON.parse((await docker('original-DB-metadata-only',['inspect','ai-qa-assistant-postgres','--format',originalFormat])).stdout);
 const digests={};for(const [name,tag]of Object.entries(image))digests[name]=(await docker('image-'+name,['image','inspect',tag,'--format','{{.Id}}'])).stdout.trim();report.images=digests;
 const openssl=process.platform==='win32'?'C:/Program Files/Git/usr/bin/openssl.exe':'openssl';
 execFileSync(openssl,['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(privateDir,'tls-key'),'-out',join(privateDir,'tls-chain'),'-days','1','-subj','/CN=app.oddpath.test','-addext','subjectAltName=DNS:app.oddpath.test,DNS:api.oddpath.test,DNS:browser.oddpath.test'],{stdio:'ignore',windowsHide:true});
 ca=await readFile(join(privateDir,'tls-chain'));const tlsKey=await readFile(join(privateDir,'tls-key'),'utf8');secrets.push(tlsKey);
 const publicKey=execFileSync(openssl,['x509','-in',join(privateDir,'tls-chain'),'-pubkey','-noout'],{windowsHide:true});
 const der=execFileSync(openssl,['pkey','-pubin','-outform','DER'],{input:publicKey,windowsHide:true});const spki=createHash('sha256').update(der).digest('base64');
 const apiEnv=[`DATABASE_URL=postgresql://oddpath_runtime:${runtime}@postgres:5432/oddpath?schema=public`,`APP_ORIGIN=${appOrigin}`,`CORS_ORIGIN=${appOrigin}`,`CSRF_SECRET=${csrf}`,`USAGE_IP_HASH_SALT=${ipSalt}`,'EMAIL_PROVIDER=smtp','EMAIL_FROM=Oddpath <no-reply@example.test>','SMTP_HOST=127.0.0.1','SMTP_PORT=9','SMTP_USER=synthetic',`SMTP_PASS=${smtpPassword}`,`EMAIL_OUTBOX_ENCRYPTION_SECRET=${mail}`,`QA_BROWSER_VIEWER_SIGNING_KEY=${viewer}`,`QA_BROWSER_VIEWER_ORIGIN=${viewerOrigin}`,`QA_MANAGED_ROUTING_KEY=${routing}`,`QA_MANAGED_PROJECT_KEY=${projectKey}`,'QA_MANAGED_HOST_ID=stack-host'];
 await writeFile(join(privateDir,'api.env'),apiEnv.join('\n')+'\nCURRENT_TERMS_VERSION=stack-test-v1\n',{mode:0o600});
 await writeFile(join(privateDir,'migration.env'),`DATABASE_URL=postgresql://oddpath_migrator:${migrator}@postgres:5432/oddpath?schema=public`,{mode:0o600});
 await writeFile(join(privateDir,'backup.env'),'PGHOST=postgres\nPGPORT=5432\nPGDATABASE=oddpath\nPGUSER=oddpath_backup\nPGSSLMODE=disable\n',{mode:0o600});
 await writeFile(join(privateDir,'dummy'),'synthetic volume-transport placeholder',{mode:0o600});
 const dummy=join(privateDir,'dummy'),interpolation={ODDPATH_API_IMAGE:image.api,ODDPATH_MIGRATION_IMAGE:image.migrations,ODDPATH_POSTGRES_IMAGE:'postgres:16',ODDPATH_POSTGRES_VOLUME:pgV,ODDPATH_POSTGRES_PASSWORD_FILE:dummy,ODDPATH_API_ENV_FILE:join(privateDir,'api.env'),ODDPATH_MIGRATION_ENV_FILE:join(privateDir,'migration.env'),ODDPATH_OPERATIONS_IMAGE:image.operations,ODDPATH_MAINTENANCE_STATE_VOLUME:maintV,ODDPATH_BACKUP_STATE_VOLUME:backupV,ODDPATH_ENCRYPTED_BACKUP_VOLUME:archivesV,ODDPATH_BACKUP_ENV_FILE:join(privateDir,'backup.env'),ODDPATH_BACKUP_KEY_FILE:dummy,ODDPATH_BACKUP_PGPASS_FILE:dummy,ODDPATH_WEB_IMAGE:image.web,ODDPATH_NGINX_IMAGE:'nginx@sha256:47928bf67eb62a1863cb08d9ecb52d3e704304ba614eaee17884204677702951',ODDPATH_APP_HOST:'app.oddpath.test',ODDPATH_API_HOST:'api.oddpath.test',ODDPATH_VIEWER_HOST:'browser.oddpath.test',ODDPATH_API_ORIGIN:apiOrigin,ODDPATH_VIEWER_ORIGIN:viewerOrigin,ODDPATH_HTTPS_PORT:'8443',ODDPATH_SUPERVISOR_IMAGE:image.supervisor,ODDPATH_SUPERVISOR_CONTAINER:id+'-supervisor',ODDPATH_SUPERVISOR_CONFIG_FILE:dummy,ODDPATH_VIEWER_KEY_FILE:dummy,ODDPATH_ROUTING_KEY_FILE:dummy,ODDPATH_TRANSFER_KEYRING_FILE:dummy,ODDPATH_VAULT_KEYRING_FILE:dummy,ODDPATH_VAULT_VOLUME:vaultV,ODDPATH_BROWSER_JOURNAL_VOLUME:journalV,ODDPATH_CONTROL_CA_FILE:dummy,ODDPATH_TLS_CHAIN_FILE:dummy,ODDPATH_TLS_KEY_FILE:dummy};
 await writeFile(envPath,Object.entries(interpolation).map(([k,v])=>k+'='+v.replaceAll('\\','/')).join('\n'),{mode:0o600});
 const mount={postgres:['pg-secret-volume'],api:['api-secret-volume'],gateway:['tls-secret-volume'],'browser-supervisor':['control-secret-volume'],'browser-reaper':['control-secret-volume'],'api-reaper':['api-secret-volume'],backup:['backup-secret-volume']};
 const transportYaml='services:\n'+Object.entries(mount).map(([service,volumes])=>'  '+service+':\n    secrets: !reset []\n    volumes:\n'+volumes.map(v=>'      - '+v+':/run/secrets:ro\n').join('')).join('')+'volumes:\n'+Object.entries({'pg-secret-volume':pgS,'api-secret-volume':apiS,'tls-secret-volume':tlsS,'control-secret-volume':controlS,'backup-secret-volume':backupS}).map(([name,v])=>'  '+name+':\n    external: true\n    name: '+v+'\n').join('');
 await writeFile(transport,transportYaml);
 // Deliberately test-only override in the isolated output directory. Maintained
 // deployment remains NODE_ENV=production and its v2 guard is unchanged.
 const testEnvironment={NODE_ENV:'test',EMAIL_PROVIDER:'noop',QA_EXECUTION_V2_ENABLED:'true',QA_BROWSER_RUNTIME_ENABLED:'true',QA_MANUAL_LOGIN_ENABLED:'true',QA_MANAGED_ROUTING_ENABLED:'true',QA_INTEGRATION_IP_RATE_LIMIT_MAX:'1000',QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX:'1000'};
 await writeFile(active,'services:\n'+['api','api-reaper'].map(s=>'  '+s+':\n    environment:\n'+Object.entries(testEnvironment).map(([k,v])=>'      '+k+': "'+v+'"\n').join('')).join(''));
 const config=JSON.parse((await compose('merged-closed-config',['--profile','browser','--profile','maintenance','--profile','backup','config','--format','json'])).stdout);
 await check('maintained-topology-keeps-production-and-public-feature-gates-closed',config.services.api.environment.NODE_ENV==='production'&&config.services.api.environment.QA_EXECUTION_V2_ENABLED==='false'&&config.services.api.environment.REGISTRATION_MODE==='disabled');
 await check('only-loopback-HTTPS-is-published',Object.entries(config.services).every(([s,c])=>s==='gateway'?c.ports.length===1&&c.ports[0].host_ip==='127.0.0.1':!c.ports?.length));
 await check('API-and-independent-reaper-share-only-their-vault-journal',config.services.api.volumes.some(v=>v.source==='vault-revocations')&&config.services['api-reaper'].volumes.some(v=>v.source==='vault-revocations')&&!JSON.stringify(config.services.api).includes('docker.sock'));
 for(const v of volumeNames){const exists=await docker('unused-volume',['volume','inspect',v],{allowFailure:true});assert.notEqual(exists.code,0);await docker('create-owned-volume',['volume','create','--label',label+'='+id,v]);createdVolumes.push(v);created=true;}
 const configJSON={instanceId:id,supervisorContainer:id+'-supervisor',chromeImage:digests.chrome,egressImage:digests.egress,publicOrigin:viewerOrigin,viewerFrameOrigin:appOrigin,allowManualLogin:true,discovery:{serverUrl:apiOrigin,keyFile:'/run/secrets/managed_routing_key'}};
 const payload={dirs:{'/vault':1000,'/journal':0,'/maintenance':999,'/backup-state':999,'/archives':999,'/pg':999,'/api':1000,'/control':0,'/tls':101,'/backup':999},files:{'/pg/postgres_admin_password':{uid:999,value:admin},'/api/browser_vault_keyring':{uid:1000,value:JSON.stringify(vaultKeys)},'/control/supervisor_config':{uid:0,value:JSON.stringify(configJSON)},'/control/browser_viewer_key':{uid:0,value:viewer},'/control/managed_routing_key':{uid:0,value:routing},'/control/vault_transfer_keyring':{uid:0,value:JSON.stringify(vaultKeys.transfer)},'/control/control_ca':{uid:0,value:ca.toString()},'/tls/ingress_tls_chain':{uid:101,value:ca.toString()},'/tls/ingress_tls_key':{uid:101,value:tlsKey},'/backup/backup_key':{uid:999,value:backupKey},'/backup/backup_pgpass':{uid:999,value:`postgres:5432:oddpath:oddpath_backup:${backupPw}\n`}}};
 const init="const fs=require('fs');let b='';process.stdin.on('data',v=>b+=v);process.stdin.on('end',()=>{const s=JSON.parse(b);for(const[p,u]of Object.entries(s.dirs)){fs.chmodSync(p,448);fs.chownSync(p,u,u);}for(const[p,v]of Object.entries(s.files)){fs.writeFileSync(p,v.value,{mode:384});fs.chownSync(p,v.uid,v.uid);}})";
 await docker('private-volume-bootstrap',['run','--rm','-i','--pull=never','--network','none','--user','0:0','--label',label+'='+id,'--entrypoint','node',...[[vaultV,'vault'],[journalV,'journal'],[maintV,'maintenance'],[backupV,'backup-state'],[archivesV,'archives'],[pgS,'pg'],[apiS,'api'],[controlS,'control'],[tlsS,'tls'],[backupS,'backup']].flatMap(([v,p])=>['-v',v+':/'+p]),image.api,'-e',init],{input:JSON.stringify(payload)});
 await compose('start-only-synthetic-postgres',['up','-d','--no-build','postgres']);pg=await container('postgres');
 await until('PG ready',async()=>(await docker('pg-ready',['exec',pg,'pg_isready','-U','postgres'],{allowFailure:true})).code===0);
 await docker('bootstrap-synthetic-roles',['exec','-i',pg,'psql','-X','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres'],{input:`CREATE ROLE oddpath_migrator LOGIN PASSWORD '${migrator}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE oddpath_runtime LOGIN PASSWORD '${runtime}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE oddpath_backup LOGIN PASSWORD '${backupPw}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE ROLE oddpath_restore_operator LOGIN PASSWORD '${restorePw}' NOSUPERUSER NOCREATEDB NOCREATEROLE;CREATE DATABASE oddpath OWNER oddpath_migrator;REVOKE ALL ON DATABASE oddpath FROM PUBLIC;GRANT CONNECT ON DATABASE oddpath TO oddpath_runtime,oddpath_backup;\n\\connect oddpath\nALTER SCHEMA public OWNER TO oddpath_migrator;REVOKE ALL ON SCHEMA public FROM PUBLIC;GRANT USAGE ON SCHEMA public TO oddpath_runtime,oddpath_backup;`});
 await compose('migrate-once-with-owner',['--profile','operations','run','--rm','--no-deps','migrate']);
 await sql('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO oddpath_runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_runtime;REVOKE INSERT,UPDATE,DELETE ON _prisma_migrations FROM oddpath_runtime;GRANT SELECT ON ALL TABLES IN SCHEMA public TO oddpath_backup;GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO oddpath_backup;');
 await check('all-current-migrations-applied',Number(await sql('SELECT count(*) FROM _prisma_migrations WHERE finished_at IS NOT NULL'))===35);
 await compose('start-production-closed-API',['up','-d','--no-build','api']);api=await container('api');
 await until('packaged API DB readiness before proxy',async()=>(await docker('direct-readiness',['exec',api,'node','-e',"fetch('http://127.0.0.1:5000/api/health/ready').then(async r=>{console.log(await r.text());process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message);process.exit(1)})"],{allowFailure:true})).code===0,45000);
 await compose('start-production-TLS-gateway',['up','-d','--no-build','gateway']);
 await until('HTTPS ready',async()=>{try{return(await request('api.oddpath.test','/api/health/ready')).status===200;}catch{return false;}});
 const front=await request('app.oddpath.test','/');await check('built-SPA-has-enforced-exact-origin-CSP',front.status===200&&front.headers['content-security-policy'].includes("frame-src "+viewerOrigin)&&front.headers['content-security-policy'].includes(apiOrigin));
 let untrusted=false;try{await request('api.oddpath.test','/api/health/ready',{trust:false});}catch{untrusted=true;}await check('TLS-requires-the-explicit-fixture-CA',untrusted);
 await check('closed-viewer-is-not-false-success',(await request('browser.oddpath.test','/open')).status===503);
 await fixture('owner',{password});await fixture('mark-vault');
 const csrfResponse=await request('api.oddpath.test','/api/auth/csrf');csrfToken=JSON.parse(csrfResponse.text).csrfToken;cookie=csrfResponse.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');
 const missing=await request('api.oddpath.test','/api/auth/login',{method:'POST',headers:{origin:appOrigin,'content-type':'application/json',cookie},body:{email:'stack@example.test',password}});await check('real-proxy-preserves-CSRF-enforcement',missing.status===403);
 const login=await ownerRequest('/api/auth/login',{email:'stack@example.test',password});assert.equal(login.status,200,login.text);cookie+='; '+login.headers['set-cookie'].map(c=>c.split(';')[0]).join('; ');
 await check('Secure-HttpOnly-cookies-survive-real-TLS-proxy',login.headers['set-cookie'].some(c=>c.includes('Secure')&&c.includes('HttpOnly')));
 await compose('start-existing-maintenance-supervisor',['--profile','maintenance','up','-d','--no-build','maintenance']);
 const maintenance=await container('maintenance');
 await until('actual scheduled cleanup/reconciliation completes',async()=>(await docker('maintenance-health',['exec',maintenance,'node','ops/maintenance.mjs','health'],{allowFailure:true})).code===0);
 await check('existing-maintenance-jobs-complete-under-the-shared-quota-policy',true);
 await compose('restart-packaged-API',['restart','api']);api=await container('api');await until('API restart ready',async()=>{try{return(await ownerRequest('/api/auth/me',undefined,'GET')).status===200;}catch{return false;}});
 await check('session-and-independent-vault-revocation-survive-restart',(await fixture('check-vault')).retainedRevocation);
 // The existing backup CLI is reused. Multi-component data is never presented
 // as covered by its closed database-only scope.
 await compose('verified-closed-backup',['--profile','backup','run','--rm','--no-deps','backup','once']);
 await check('closed-DB-encrypted-backup-supervision-succeeds',true);
 const archiveList=await docker('list-encrypted-only-archives',['run','--rm','--network','none','--user','999:999','--label',label+'='+id,'--read-only','--mount','type=volume,src='+archivesV+',dst=/archives,readonly',image.api,'node','-e',"console.log(JSON.stringify(require('fs').readdirSync('/archives').filter(n=>n.endsWith('.opb'))))"]);
 const archives=JSON.parse(archiveList.stdout);assert.equal(archives.length,1);const restoreDb='oddpath_restore_stack'+randomBytes(8).toString('hex');
 await sql(`CREATE DATABASE ${restoreDb} OWNER oddpath_restore_operator;REVOKE ALL ON DATABASE ${restoreDb} FROM PUBLIC;`,'postgres');
 // Test-only credential file on a private owned volume, cleaned immediately.
 await docker('write-isolated-restore-credential',['run','--rm','--network','none','--label',label+'='+id,'--user','0:0','--entrypoint','node','-v',backupS+':/private',image.api,'-e',"const f=require('fs');f.writeFileSync('/private/restore_pgpass',"+JSON.stringify(`postgres:5432:*:oddpath_restore_operator:${restorePw}\n`)+",{mode:384});f.chownSync('/private/restore_pgpass',999,999)"]);
 const restored=await docker('restore-encrypted-backup-to-quarantined-new-DB',['run','--rm','--pull=never','--label',label+'='+id,'--network',id+'_database','--read-only','--cap-drop','ALL','--tmpfs','/tmp:rw,noexec,nosuid,size=256m','--tmpfs','/var/lib/postgresql/data:rw,size=1m','-v',archivesV+':/archives','-v',backupS+':/run/secrets:ro','-e','PGHOST=postgres','-e','PGPORT=5432','-e','PGDATABASE='+restoreDb,'-e','PGUSER=oddpath_restore_operator','-e','PGSSLMODE=disable','-e','PGPASSFILE=/run/secrets/restore_pgpass','-e','ODDPATH_BACKUP_DIRECTORY=/archives','-e','ODDPATH_BACKUP_KEY_FILE=/run/secrets/backup_key','-e','ODDPATH_RESTORE_ACK=ISOLATED_EMPTY_TARGET',image.operations,'restore','/archives/'+archives[0],'--confirm-target',restoreDb]);
 await check('real-restore-stays-quarantined-and-preserves-synthetic-data',JSON.parse(restored.stdout).status==='RESTORED_QUARANTINED'&&await sql(`SELECT count(*) FROM "Chat" WHERE id='stack-chat'`,restoreDb)==='1');
 await docker('remove-test-restore-credential',['run','--rm','--network','none','--label',label+'='+id,'--user','0:0','--entrypoint','node','-v',backupS+':/private',image.api,'-e',"require('fs').unlinkSync('/private/restore_pgpass')"]);
 browserMode=true;
 await compose('start-explicitly-synthetic-browser-rehearsal',['--profile','browser','up','-d','--no-build','api','gateway','api-reaper','browser-supervisor','browser-reaper']);api=await container('api');
 await until('synthetic API ready',async()=>{try{return(await request('api.oddpath.test','/api/health/ready')).status===200;}catch{return false;}});
 ui=await stackBrowser({appOrigin,apiOrigin,password,spki,check,output:out});
 for(const stop of [false,true]){
  const qa=await fixture('qa');executionProjects.push(qa.projectId);
  const prepared=await until('automatic manual-profile registration',async()=>{const p=await fixture('prepare',qa);return p.pending?false:p;});
  const started=await ownerRequest(`/api/projects/${qa.projectId}/qa/requests/${qa.requestId}/runs`,prepared.body);assert.equal(started.status,201,started.text);
  await until('managed runtime allocation before human preparation',async()=>{const s=await fixture('state',qa);return s.job?.browserRuntime?.state==='LIVE';});
  const popup=await ui.open(qa);
  const beforeExit=await fixture('state',qa);
  await check('active-browser-keeps-reservation-before-completion-or-Stop',beforeExit.job.browserRuntime.state==='LIVE'&&beforeExit.reservation.state==='ACTIVE');
  if(stop)await ui.stop();else await ui.complete();
  const finished=await until('physical browser exit and terminal result',async()=>{const s=await fixture('state',qa);return s.job?.browserRuntime?.state==='STOP_CONFIRMED'&&['SUCCEEDED','FAILED','CANCELLED','STOPPED'].includes(s.job.status)?s:false;},120000);
  if(!stop)await check('approved-manual-QA-persists-one-PASS-with-evidence',finished.job.status==='SUCCEEDED'&&finished.job.attempts===1&&finished.job.run.results[0].status==='PASS'&&finished.job.run.evidence.length>0);
  else await check('UI-Stop-confirms-physical-exit-without-test-replay',finished.job.status!=='SUCCEEDED'&&finished.job.attempts===1);
  await until('reservation reconciliation',async()=>{const s=await fixture('state',qa);return s.reservation?.state==='RELEASED';});
  await check('reservation-released-only-after-confirmed-exit',true);await popup.close();
 }
 await ui.close();ui=null;
 await compose('restart-idle-control-plane',['--profile','browser','restart','api','api-reaper','browser-supervisor','browser-reaper','gateway']);
 await until('restarted ingress ready',async()=>{try{return(await ownerRequest('/api/auth/me',undefined,'GET')).status===200;}catch{return false;}});
 await check('full-idle-restart-keeps-session-and-revocation',(await fixture('check-vault')).retainedRevocation);
 const forbiddenBackup=await compose('DB-only-backup-refuses-browser-data',['--profile','backup','run','--rm','--no-deps','--entrypoint','node','backup','ops/backup.mjs','create'],{allowFailure:true});
 await check('browser-data-refuses-unsupported-database-only-backup',forbiddenBackup.code!==0&&(forbiddenBackup.stderr+forbiddenBackup.stdout).includes('BACKUP_FULL_RUNTIME_OR_ASSET_TOPOLOGY_REQUIRED'));
 report.status='PASS';
}catch(error){
 // Setup below runs only after TLS generation succeeds; failures remain visible.
 report.status='FAIL';report.error=safe(error.message);process.exitCode=1;
 if(api)for(const projectId of executionProjects)try{await fixture('state',{projectId});}catch{}
 try{await compose('failure-diagnostics-before-owned-cleanup',['--profile','browser','--profile','maintenance','--profile','backup','logs','--no-color','--tail','80'],{allowFailure:true});}catch{}
}finally{
 if(ui)try{await ui.abort();}catch{}
 if(created){
  try{
   await compose('stop-owned-control-before-cleanup',['--profile','browser','--profile','maintenance','--profile','backup','stop']);
   const {DockerRuntimeDriver}=await import('../../apps/browser-runtime/src/docker-driver.mjs');
   const driver=new DockerRuntimeDriver({instanceId:id,supervisorContainer:id+'-supervisor',chromeImage:report.images.chrome,egressImage:report.images.egress});
   for(const runtimeId of await driver.list())await driver.stop(runtimeId);
   await compose('remove-owned-compose-containers-networks',['--profile','browser','--profile','maintenance','--profile','backup','down','--remove-orphans']);
   for(const v of createdVolumes){const info=JSON.parse((await docker('volume-ownership',['volume','inspect',v])).stdout)[0];assert.equal(info.Labels[label],id);await docker('remove-owned-volume',['volume','rm',v]);}
   report.cleanup=true;
  }catch(error){report.cleanupError=safe(error.message);report.status='FAIL';process.exitCode=1;}
 }
 const original=JSON.parse((await docker('original-DB-metadata-after',['inspect','ai-qa-assistant-postgres','--format','{"id":{{json .Id}},"startedAt":{{json .State.StartedAt}},"health":{{json .State.Health.Status}}}'])).stdout);
 assert.equal(original.startedAt,report.originalDatabase.startedAt);assert.equal(original.id,report.originalDatabase.id);assert.equal(original.health,'healthy');
 assert.ok(resolve(privateDir).startsWith(resolve(tmpdir())+sep));await rm(privateDir,{recursive:true,force:true});
 await persist();
 console.log(JSON.stringify({status:report.status,checks:report.checks.length,failed:report.checks.filter(c=>c.status==='FAIL'),cleanup:report.cleanup,error:report.error?.slice(0,400),output:out}));
}
