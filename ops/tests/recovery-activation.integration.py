"""Closed current-source activation rehearsal; all DBs and resources synthetic."""
import argparse,datetime,hashlib,json,os,pathlib,re,secrets,subprocess,sys,time,traceback
if os.environ.get('ODDPATH_RECOVERY_ACTIVATION_TESTS')!='1' or sys.platform!='linux':raise SystemExit('Explicit local synthetic Linux test interlock required')
parser=argparse.ArgumentParser();parser.add_argument('--task-dir',required=True);parser.add_argument('--output-name',required=True);args=parser.parse_args()
assert pathlib.Path(args.task_dir).is_absolute() and re.fullmatch(r'run[0-9]{1,3}',args.output_name)
T=pathlib.Path(args.task_dir).resolve();assert T.is_dir() and T==pathlib.Path(args.task_dir)
# Never enter destructive cleanup when an existing host workload is present.
if subprocess.check_output(['docker','ps','-aq'],text=True).strip() or subprocess.check_output(['docker','volume','ls','-q'],text=True).strip():raise SystemExit('Use an empty isolated Docker test host; existing resources are preserved')
O=T/args.output_name;O.mkdir(mode=0o700);S=T/'source';FIXTURES=pathlib.Path(__file__).resolve().parent/'fixtures'
ID='oddpath-recovery-act27-'+secrets.token_hex(3);LABEL='com.oddpath.closed-recovery';images=json.loads((T/'images.json').read_text())['images'];OPS=images['operations'];API=images['runtime'];lock_child=None
PG='sha256:9e2cf6287f25c3151f4c9421ccce2b17f3e60061c111a29165e0d2cdd9ff0a97';MIG='sha256:ef8048a3f0fd94e47226625229a221a423027898edd0dc5df1451745f55c1df1';DRIVER='sha256:146909a67d8aec26ef8ad863586b2cd758bd9c1cb96e420b9af6813c687a2f1e'
SECRET=[secrets.token_hex(32) for _ in range(10)];pw=SECRET[0];R={'status':'RUNNING','scope':'CLOSED_CURRENT_SOURCE_ACTIVATION','phase08Accepted':False,'publicReleaseAuthorized':False,'checks':[],'commands':[],'images':images};SEQ=0;CREATED=[]
def save():(O/'verification.json').write_text(json.dumps(R,indent=2)+'\n')
def safe(s):
 for v in SECRET:s=s.replace(v,'[REDACTED]')
 return s
def d(name,args,data=None,allow=False,timeout=120,sensitive=False):
 global SEQ
 p=subprocess.run(['docker',*args],input=data,text=True,capture_output=True,timeout=timeout);SEQ+=1
 log='command-%03d.log'%SEQ;(O/log).write_text('[PRIVATE_OUTPUT_OMITTED]\n' if sensitive else safe(p.stdout+'\n'+p.stderr));R['commands'].append({'name':name,'code':p.returncode,'log':log});save()
 if p.returncode and not allow:raise RuntimeError(name+' exit '+str(p.returncode)+': '+safe(p.stderr)[-500:])
 return p
def check(name,value):
 R['checks'].append({'name':name,'status':'PASS' if value else 'FAIL'});save()
 if not value:raise AssertionError(name)
def wait(name,fn,seconds=50):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  if fn():return
  time.sleep(.25)
 raise RuntimeError('Timeout '+name)
def ef(name,values):
 p=O/'private'/name;p.write_text('\n'.join(k+'='+str(v) for k,v in values.items())+'\n');os.chmod(p,0o600);return str(p)
def sql(q,db='postgres'):return d('synthetic-SQL',['exec','-i',ID+'-pg','psql','-X','-U','postgres','-v','ON_ERROR_STOP=1','-d',db,'-At'],q).stdout.strip()
def cfg(db,closed=False):
 base={'NODE_ENV':'production','PORT':5000,'APP_ORIGIN':'https://app.example.test','CORS_ORIGIN':'https://app.example.test','COOKIE_SECURE':'true','TRUST_PROXY_HOPS':1,'AUTH_ABUSE_STORE':'postgres','REGISTRATION_MODE':'disabled','AI_ENABLED':'false','GUEST_AI_ENABLED':'false','PROJECT_DOCUMENT_EMBEDDINGS_ENABLED':'false','QA_PROCESSING_WORKER_ENABLED':'false','QA_LEGACY_RUNNER_DISPATCH_ENABLED':'false','QA_EXECUTION_V2_ENABLED':'false','PRIVATE_ASSETS_ENABLED':'false','EMAIL_PROVIDER':'smtp','EMAIL_FROM':'Oddpath <fixture@example.test>','SMTP_HOST':'127.0.0.1','SMTP_PORT':9,'SMTP_USER':'synthetic','SMTP_PASS':SECRET[2],'CSRF_SECRET':SECRET[3],'USAGE_IP_HASH_SALT':SECRET[4],'EMAIL_OUTBOX_ENCRYPTION_SECRET':SECRET[5],'DATABASE_URL':'postgresql://runtime:'+SECRET[1]+'@postgres:5432/'+db+'?schema=public'}
 if closed:base.update(QA_CLOSED_REHEARSAL_ENABLED='true',QA_CLOSED_REHEARSAL_OWNER_IDS='closed-owner',QA_EXECUTION_V2_ENABLED='true',QA_BROWSER_RUNTIME_ENABLED='true',QA_MANUAL_LOGIN_ENABLED='true',QA_MANAGED_ROUTING_ENABLED='true',QA_MANAGED_HOST_ID='recovery-host',QA_MANAGED_ROUTING_KEY=SECRET[6],QA_MANAGED_PROJECT_KEY=SECRET[7],QA_BROWSER_VIEWER_SIGNING_KEY=SECRET[8],QA_BROWSER_VIEWER_ORIGIN='https://viewer.example.test')
 return base
def aa(db,closed=False,background=False):
 return ['run',*(['-d','--name',ID+'-api'] if background else ['--rm','-i']),'--label',LABEL+'='+ID,'--network',ID,'--read-only','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=32m','--env-file',ef('api-'+db+('-closed' if closed else '')+'.env',cfg(db,closed)),API]
def api_code(db,code):return d('actual-compiled-API-fixture',aa(db)+['node','--input-type=module'],code)
def oa(state,fault=False):
 a=['run','--rm','-i','--label',LABEL+'='+ID,'--network',ID,'--read-only','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','--tmpfs','/var/lib/postgresql/data:rw,noexec,nosuid,size=1m','--env-file',controlenv,'-e','ODDPATH_RECOVERY_STATE_DIRECTORY=/state/'+state,'-v',str(O/'private')+':/private:ro','-v',ID+'-state:/state','-v','/var/run/docker.sock:/var/run/docker.sock','-v',ID+'-journal:/recovery-runtime:ro']
 if fault:a+=['-e','ODDPATH_ACTIVATION_TESTS=1','-v',str(FIXTURES/'recovery-activation-fault.mjs')+':/opt/oddpath/ops/activation-fault.mjs:ro']
 a+=['--entrypoint','node',OPS]
 if fault:a+=['--import','./ops/activation-fault.mjs']
 return a
def cli(name,state,args,**kw):return d(name,oa(state)+['ops/recovery.mjs',*args],**kw)
def target(n):return 'oddpath_restore_activation27_'+n
def stage(n,src=None):return cli('stage-'+n,n,['stage-current','--source',src or 'source_'+n,'--target',target(n),'--owner','recovery_owner'])
def activate(n,src=None,active=None,**kw):return cli('activate-'+n,n,['activate-current-closed','--confirm-source',src or 'source_'+n,'--operational-name',active or 'active_'+n,'--runtime-role','runtime'],**kw)
def cancel(n,src=None,**kw):return cli('cancel-'+n,n,['cancel-current','--confirm-source',src or 'source_'+n],**kw)
def flags(db):return json.loads(sql("SELECT json_build_object('open',datallowconn,'oid',oid::text,'comment',shobj_description(oid,'pg_database')) FROM pg_database WHERE datname='"+db+"'"))
def start_api(db,closed=False):
 d('start-production-API',aa(db,closed,True));wait('real HTTP readiness',lambda:d('HTTP-ready',['exec',ID+'-api','node','-e',"fetch('http://127.0.0.1:5000/api/health/ready').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"],allow=True).returncode==0)
def stop_api():d('drain-production-API',['stop','-t','10',ID+'-api']);d('remove-drained-API',['rm',ID+'-api'])
def http(code):return d('actual-HTTP-auth',['exec',ID+'-api','node','--input-type=module','-e',code])
def accounting(db):return json.loads(sql('''SELECT json_build_object('credits',(SELECT "creditsUsed" FROM "UsageEvent" WHERE id='known'),'applied',(SELECT "appliedAt" IS NOT NULL FROM "UsageSettlementReceipt" WHERE "attemptId"='known-attempt'),'users',(SELECT count(*) FROM "User"),'sessions',(SELECT count(*) FROM "Session"),'identities',(SELECT count(*) FROM "UsageEvent" WHERE "userId" IS NOT NULL OR "guestId" IS NOT NULL OR "ipHash" IS NOT NULL))''',db))
# Deterministic real-PG requarantine regressions; used by the maintained test.
CLIENTS=[]
def saved_status(n):
 return d('read-requarantine-status',oa(n)+['-e',"console.log(JSON.parse(require('fs').readFileSync('/state/"+n+"/state.json','utf8')).status)"]).stdout.strip()
def req(n,**kw):return cli('requarantine-'+n,n,['requarantine-current-closed','--confirm-database','active_'+n],**kw)
def new_requarantine_case(n):
 sql('CREATE DATABASE source_'+n+' TEMPLATE source_role;');stage(n);activate(n)
def req_fault(n,mode):
 name=ID+'-requarantine-fault';a=oa(n);a.remove('--rm');a.remove('-i');a[1:1]=['-d','--name',name]
 ix=a.index('--entrypoint');a[ix:ix]=['-e','ODDPATH_ACTIVATION_TESTS=1','-e','ODDPATH_REQUARANTINE_TEST_FAULT='+mode,'-v',str(FIXTURES/'recovery-requarantine-fault.mjs')+':/opt/oddpath/ops/requarantine-test-fault.mjs:ro']
 a+=['--import','./ops/requarantine-test-fault.mjs','ops/recovery.mjs','requarantine-current-closed','--confirm-database','active_'+n]
 d('start-requarantine-fault-'+mode,a);return name
def req_barrier(n,name):
 wait('requarantine-real-query-barrier',lambda:d('read-requarantine-barrier',['exec',name,'node','-e',"process.exit(require('fs').existsSync('/state/"+n+"/requarantine-ready')?0:1)"],allow=True).returncode==0)
def req_release(n,name):d('release-requarantine-barrier',['exec',name,'node','-e',"require('fs').writeFileSync('/state/"+n+"/requarantine-release','GO')"])
def req_finish(name,kill=False):
 if kill:d('SIGKILL-only-requarantine-CLI',['kill','--signal','KILL',name])
 exitcode=d('wait-requarantine-fault',['wait',name]).stdout.strip();logs=d('requarantine-fault-log',['logs',name]);d('remove-requarantine-fault',['rm',name]);return exitcode,logs
def runtime_psql(db,script):
 return d('ordinary-runtime-SQL',['exec','-i','-e','PGPASSWORD='+SECRET[1],ID+'-pg','psql','-X','-h','127.0.0.1','-U','runtime','-d',db,'-At','-v','ON_ERROR_STOP=1'],script,allow=True)
def open_runtime(db):
 p=subprocess.Popen(['docker','exec','-i','-e','PGPASSWORD='+SECRET[1],ID+'-pg','psql','-X','-h','127.0.0.1','-U','runtime','-d',db,'-At','-v','ON_ERROR_STOP=1'],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 CLIENTS.append(p);p.stdin.write("SET application_name='requarantine_late_runtime';SELECT 'CONNECTED';\n");p.stdin.flush()
 wait('ordinary-runtime-connected',lambda:sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='requarantine_late_runtime'")=='1');return p
def close_runtime(p):
 if not p.stdin.closed:p.stdin.close()
 p.wait(timeout=10);return p.stdout.read()+'\n'+p.stderr.read()
def inspect_closed_accounting(n):
 # Privileged synthetic inspection only, never startup authorization. CONNECT is
 # still revoked from ordinary roles; return to the exact admission fence.
 sql('ALTER DATABASE active_'+n+' ALLOW_CONNECTIONS true;')
 try:return accounting('active_'+n)
 finally:sql('ALTER DATABASE active_'+n+' ALLOW_CONNECTIONS false;')

try:
 assert not d('baseline-containers',['ps','-aq']).stdout.strip();assert not d('baseline-volumes',['volume','ls','-q']).stdout.strip()
 (O/'private').mkdir(mode=0o700)
 (O/'private/pgpass').write_text('postgres:5432:*:postgres:'+pw+'\n');os.chmod(O/'private/pgpass',0o600)
 controlenv=ef('control.env',{'PGHOST':'postgres','PGPORT':5432,'PGDATABASE':'postgres','PGUSER':'postgres','PGPASSFILE':'/private/pgpass','PGSSLMODE':'disable','ODDPATH_RECOVERY_SOURCE_ACK':'FREEZE_SOURCE_KEEP_TARGET_QUARANTINED','ODDPATH_RECOVERY_ACTIVATION_ACK':'CURRENT_SOURCE_CLOSED_ONLY','ODDPATH_RECOVERY_POSTGRES_CONTAINER':ID+'-pg','ODDPATH_RECOVERY_SUPERVISOR_CONTAINER':ID+'-supervisor'})
 d('new-internal-network',['network','create','--internal','--label',LABEL+'='+ID,ID])
 for suffix in ['pg','state','journal']:
  v=ID+'-'+suffix;d('new-labelled-volume',['volume','create','--label',LABEL+'='+ID,v]);CREATED.append(v)
 d('init-private-volume',oa('helper')+['--input-type=module'],"import fs from 'node:fs';fs.chmodSync('/state',448)")
 d('start-fresh-PG',['run','-d','--name',ID+'-pg','--label',LABEL+'='+ID,'--network',ID,'--network-alias','postgres','--env-file',ef('pg.env',{'POSTGRES_PASSWORD':pw}),'-v',ID+'-pg:/var/lib/postgresql/data',PG,'-c','max_prepared_transactions=8'])
 wait('PG ready',lambda:d('pg-ready',['exec',ID+'-pg','pg_isready','-U','postgres'],allow=True).returncode==0)
 sql("CREATE ROLE runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '"+SECRET[1]+"';CREATE ROLE recovery_owner NOLOGIN;CREATE DATABASE source_good;")
 d('35-real-migrations',['run','--rm','--label',LABEL+'='+ID,'--network',ID,'--env-file',ef('migration.env',{'DATABASE_URL':'postgresql://postgres:'+pw+'@postgres:5432/source_good?schema=public'}),MIG])
 sql('GRANT USAGE ON SCHEMA public TO runtime;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO runtime;GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO runtime;','source_good')
 seed="""import {prisma as db} from './apps/api/dist/db/prisma.js';import {hashPassword} from './apps/api/dist/modules/auth/auth.security.js';import {usageRepository as u} from './apps/api/dist/modules/usage/usage.repository.js';import {accountDataDeletionCoordinator as a} from './apps/api/dist/modules/account/account-data-deletion.js';try{
 const now=new Date();for(const id of ['deleted-owner','closed-owner'])await db.user.create({data:{id,email:id+'@example.invalid',name:id,passwordHash:await hashPassword(PASSWORD),emailVerifiedAt:now}});
 await db.project.create({data:{id:'closed-project',ownerId:'closed-owner',name:'Recovery'}});
 await db.usageEvent.create({data:{id:'known',userId:'deleted-owner',action:'chat',status:'settlement_pending',units:1,creditsReserved:1,providerAttempts:1,fixedCredits:0,reservationPolicy:{},expiresAt:new Date(Date.now()+1800000)}});
 await db.usageProviderAttempt.create({data:{id:'known-attempt',eventId:'known',ordinal:1,kind:'generation',creditsReserved:1}});
 await db.usageSettlementReceipt.create({data:{attemptId:'known-attempt',eventId:'known',fingerprint:'known-synthetic',credits:2,payload:{id:'known',attemptId:'known-attempt',status:'completed',creditsUsed:2,usageConfirmed:true}}});
 await u.reconcileExpiredUsage({strict:true});await db.$transaction(tx=>a.deleteInTransaction(tx,'deleted-owner'));console.log('KNOWN_TWO_SETTLED_AND_OWNER_DELETED');
 }finally{await db.$disconnect()}""".replace('PASSWORD',json.dumps(SECRET[9]))
 api_code('source_good',seed);check('source-has-confirmed-two-and-no-deleted-owner-identities',accounting('source_good')=={'credits':2,'applied':True,'users':1,'sessions':0,'identities':0})
 start_api('source_good')
 http("import fs from 'node:fs';const root='http://127.0.0.1:5000';const c=await fetch(root+'/api/auth/csrf'),body=await c.json();const cookie=c.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const r=await fetch(root+'/api/auth/login',{method:'POST',headers:{origin:'https://app.example.test',cookie,'x-csrf-token':body.csrfToken,'content-type':'application/json'},body:JSON.stringify({email:'closed-owner@example.invalid',password:"+json.dumps(SECRET[9])+"})});if(r.status!==200)throw Error('LOGIN_'+r.status);fs.writeFileSync('/tmp/old-cookie',r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; '),{mode:384});console.log('LOGIN_OK')")
 # Preserve the cookie privately without logging it.
 old=d('copy-private-old-cookie',['exec',ID+'-api','cat','/tmp/old-cookie'],sensitive=True).stdout.strip();SECRET.append(old);(O/'private/old-cookie').write_text(old);os.chmod(O/'private/old-cookie',0o600)
 check('real-original-HTTP-login-created-session',accounting('source_good')['sessions']==1);stop_api()
 for n in ['unknown','hold','receipt','generation','lost','role']:sql('CREATE DATABASE source_'+n+' TEMPLATE source_good;')
 sql('INSERT INTO "UsageEvent"(id,action,status,units,"creditsReserved") VALUES(\'unknown\',\'chat\',\'unknown\',3,3);','source_unknown')
 sql('INSERT INTO "UsageEvent"(id,action,status,units,"creditsReserved","expiresAt") VALUES(\'hold\',\'chat\',\'reserved\',5,5,now()+interval \'30 minutes\');','source_hold')
 sql('UPDATE "UsageSettlementReceipt" SET "appliedAt"=NULL;','source_receipt')
 api_code('source_generation',"import {prisma as d} from './apps/api/dist/db/prisma.js';try{await d.qaRequest.create({data:{id:'pending-request',projectId:'closed-project',createdByUserId:'closed-owner',title:'Pending',objective:'Synthetic pending generation'}});await d.qaGenerationExecution.create({data:{id:'pending-generation',requestId:'pending-request',kind:'CHECKLIST_GENERATION',status:'PENDING'}});}finally{await d.$disconnect()}")
 # Actual sandboxed Chrome + egress; journal is the supervisor's real volume.
 chrome=d('pin-Chrome',['image','inspect','oddpath/main-refresh-r2-chrome:20261025','--format','{{.Id}}']).stdout.strip();egress=d('pin-egress',['image','inspect','oddpath/main-refresh-r2-egress:20261025','--format','{{.Id}}']).stdout.strip()
 browser={'instanceId':ID,'supervisorContainer':ID+'-supervisor','chromeImage':chrome,'egressImage':egress}
 benv=ef('browser.env',{'ODDPATH_ACTIVATION_BROWSER':json.dumps(browser)})
 d('start-real-browser-supervisor-fixture',['run','-d','--name',ID+'-supervisor','--label',LABEL+'='+ID,'--network',ID,'--read-only','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','--tmpfs','/tmp:rw,noexec,nosuid,size=64m','-v','/var/run/docker.sock:/var/run/docker.sock','-v',ID+'-journal:/var/lib/oddpath','-v',str(O/'private')+':/evidence','-v',str(FIXTURES/'recovery-browser-fixture.mjs')+':/fixture.mjs:ro','--env-file',benv,'--entrypoint','node',DRIVER,'/fixture.mjs'])
 wait('real Chrome readiness',lambda:(O/'private/browser-ready').exists())
 stage('good');blocked=activate('good',allow=True);check('activation-refuses-live-supervisor-and-real-Chrome',blocked.returncode!=0 and 'RECOVERY_SUPERVISOR_NOT_DRAINED' in blocked.stderr and not flags(target('good'))['open'])
 (O/'private/browser-stop').write_text('STOP');wait('confirmed physical Stop',lambda:(O/'private/browser-proof.json').exists());d('wait-drained-supervisor',['wait',ID+'-supervisor']);proof=json.loads((O/'private/browser-proof.json').read_text());R['physicalStop']=proof
 check('actual-Chrome-stop-has-exit-proof-and-settled-creator',proof['status']=='STOPPED' and proof['proof']['processExited'] and proof['creatorFence'] is None)
 stage('role');sql('CREATE ROLE privileged_group NOLOGIN CREATEROLE;GRANT privileged_group TO runtime;')
 bad_role=activate('role',allow=True);check('runtime-SET-ROLE-privilege-escalation-is-refused',bad_role.returncode!=0 and 'RECOVERY_SAFE_EXCLUSIVE_RUNTIME_ROLE_REQUIRED' in bad_role.stderr and not flags(target('role'))['open'])
 sql('REVOKE privileged_group FROM runtime;');cancel('role')
 for n in ['unknown','hold','receipt','generation']:
  stage(n);r=activate(n,allow=True);check(n+'-blocks-activation-without-losing-accounting',r.returncode!=0 and 'RECOVERY_CLOSED_PREREQUISITES_UNRESOLVED' in r.stderr and not flags(target(n))['open'] and not flags('source_'+n)['open'])
  cancel(n);check(n+'-can-cancel-uncommitted-activation-safely',flags('source_'+n)['open'] and not flags(target(n))['open'])
  # Explicit administrator-only inspection after cancellation, still quarantined.
  sql('ALTER DATABASE '+target(n)+' ALLOW_CONNECTIONS true;')
  saved=accounting(target(n));source_hash=sql('SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM "UsageEvent" e','source_'+n);copy_hash=sql('SELECT md5(jsonb_agg(to_jsonb(e) ORDER BY id)::text) FROM "UsageEvent" e',target(n))
  sql('ALTER DATABASE '+target(n)+' ALLOW_CONNECTIONS false;')
  check(n+'-refusal-keeps-exact-usage-and-old-session-unmodified',saved=={'credits':2,'applied':n!='receipt','users':1,'sessions':1,'identities':0} and copy_hash==source_hash)
 # Commit succeeds but the real connection is cut before its reply reaches CLI.
 stage('lost');lost=d('lose-actual-activation-COMMIT-reply',oa('lost',True)+['ops/recovery.mjs','activate-current-closed','--confirm-source','source_lost','--operational-name','active_lost','--runtime-role','runtime'],allow=True)
 check('lost-COMMIT-ack-reports-failure-with-source-still-frozen',lost.returncode!=0 and not flags('source_lost')['open'] and flags('active_lost')['open'])
 denied=cancel('lost',allow=True);check('lost-COMMIT-cannot-reopen-original-source',denied.returncode!=0 and 'RECOVERY_ACTIVATION_SOURCE_RESUME_FORBIDDEN' in denied.stderr)
 again=json.loads(activate('lost').stdout);check('restart-recovers-live-activation-idempotently',again['status']=='CURRENT_SOURCE_ACTIVE_CLOSED' and not again['releaseAuthorized'] and accounting('active_lost')['credits']==2)
 cli('requarantine-lost','lost',['requarantine-current-closed','--confirm-database','active_lost']);check('requarantine-retains-data-and-keeps-source-closed',not flags('active_lost')['open'] and not flags('source_lost')['open'])
 # The operational name must share the same lock namespace as future staging.
 lock_child=subprocess.Popen(['docker','exec','-i',ID+'-pg','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',"SET application_name='activation_name_hold';SELECT pg_advisory_lock(hashtext('oddpath_current_recovery'),hashtext('active_good'));SELECT pg_sleep(120)"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
 wait('actual-operational-name-lock',lambda:sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='activation_name_hold' AND wait_event='PgSleep')")=='t')
 held=activate('good',allow=True);check('activation-serializes-the-new-operational-name',held.returncode!=0 and 'RECOVERY_DATABASE_BUSY' in held.stderr)
 sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='activation_name_hold'");lock_child.wait(timeout=10);lock_child=None
 result=json.loads(activate('good').stdout);R['activation']=result
 check('closed-activation-is-explicit-and-has-no-release-authority',result['status']=='CURRENT_SOURCE_ACTIVE_CLOSED' and result['activationAuthorized'] and not result['releaseAuthorized'])
 check('source-stays-frozen-and-only-new-operational-name-is-open',not flags('source_good')['open'] and flags('active_good')['open'] and sql("SELECT NOT EXISTS(SELECT 1 FROM pg_database WHERE datname='"+target('good')+"')")=='t')
 after=accounting('active_good');R['accounting']=after;check('known-Credits-and-deletion-preserved-old-sessions-invalidated',after=={'credits':2,'applied':True,'users':1,'sessions':0,'identities':0})
 normal=d('normal-profile-refuses-activated-recovery',aa('active_good'),allow=True,timeout=25);check('actual-API-requires-closed-profile-for-activated-recovery',normal.returncode!=0 and 'RESTORE_CLOSED_PROFILE_REQUIRED' in normal.stderr)
 start_api('active_good',True);check('actual-closed-production-HTTP-starts',True)
 old_auth=http("const r=await fetch('http://127.0.0.1:5000/api/auth/me',{headers:{cookie:"+json.dumps(old)+"}});console.log(r.status);if(r.status!==401)throw Error('OLD_SESSION_SURVIVED')")
 check('actual-HTTP-denies-pre-recovery-session',old_auth.stdout.strip()=='401')
 fresh=http("const root='http://127.0.0.1:5000';const c=await fetch(root+'/api/auth/csrf'),body=await c.json();let cookie=c.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const r=await fetch(root+'/api/auth/login',{method:'POST',headers:{origin:'https://app.example.test',cookie,'x-csrf-token':body.csrfToken,'content-type':'application/json'},body:JSON.stringify({email:'closed-owner@example.invalid',password:"+json.dumps(SECRET[9])+"})});if(r.status!==200)throw Error('FRESH_LOGIN_'+r.status);cookie+='; '+r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');const out=await fetch(root+'/api/auth/logout',{method:'POST',headers:{origin:'https://app.example.test',cookie,'x-csrf-token':body.csrfToken}});if(out.status!==200)throw Error('LOGOUT_'+out.status);console.log('FRESH_LOGIN_AND_LOGOUT_OK')")
 check('fresh-owner-HTTP-login-and-logout-work-after-recovery',fresh.stdout.strip()=='FRESH_LOGIN_AND_LOGOUT_OK');stop_api()
 d('restart-real-PG',['restart',ID+'-pg']);wait('PG restart',lambda:d('pg-ready',['exec',ID+'-pg','pg_isready','-U','postgres'],allow=True).returncode==0)
 check('activation-restart-does-not-charge-or-reopen-source',json.loads(activate('good').stdout)['status']=='CURRENT_SOURCE_ACTIVE_CLOSED' and accounting('active_good')==after and not flags('source_good')['open'])
 start_api('active_good',True);stop_api();check('closed-HTTP-recovers-after-PG-restart',True)
 denied=cancel('good',allow=True);check('old-cancel-remains-blocked-after-activation',denied.returncode!=0 and not flags('source_good')['open'])
 cli('explicit-requarantine','good',['requarantine-current-closed','--confirm-database','active_good']);cli('idempotent-requarantine','good',['requarantine-current-closed','--confirm-database','active_good'])
 check('requarantine-closes-active-target-without-reopening-source',not flags('active_good')['open'] and not flags('source_good')['open'])
 refused=activate('good',allow=True);check('requarantined-operation-cannot-auto-reactivate',refused.returncode!=0 and 'RECOVERY_ACTIVATION_STATE_INVALID' in refused.stderr)
 # Regression: a legitimate backend lands after the former zero-session check.
 n='late_regression';new_requarantine_case(n);fault=req_fault(n,'before-close');req_barrier(n,fault)
 late=open_runtime('active_'+n);req_release(n,fault);exitcode,logs=req_finish(fault)
 R['requarantineLateConnection']={'firstExit':exitcode,'firstStatus':saved_status(n),'targetOpen':flags('active_'+n)['open']}
 check('late-session-refuses-success-after-durable-admission-fence',exitcode!='0' and 'RECOVERY_TARGET_NOT_QUIESCENT' in logs.stderr and saved_status(n)=='REQUARANTINE_INTENT' and not flags('active_'+n)['open'] and not flags('source_'+n)['open'])
 refused=runtime_psql('active_'+n,'SELECT 1;')
 check('blocked-requarantine-denies-new-connections-without-killing-existing-one',refused.returncode!=0 and sql("SELECT count(*) FROM pg_stat_activity WHERE application_name='requarantine_late_runtime'")=='1')
 again=req(n,allow=True)
 check('fresh-CLI-retry-rechecks-live-backend-and-remains-incomplete',again.returncode!=0 and 'RECOVERY_TARGET_NOT_QUIESCENT' in again.stderr and saved_status(n)=='REQUARANTINE_INTENT')
 # Compatibility: state left completed by the previous vulnerable implementation.
 d('simulate-old-completed-requarantine-record',oa(n)+['-e',"const fs=require('fs'),p='/state/"+n+"/state.json',s=JSON.parse(fs.readFileSync(p,'utf8'));s.status='CURRENT_SOURCE_REQUARANTINED';fs.writeFileSync(p,JSON.stringify(s),{mode:384})"])
 old=req(n,allow=True)
 check('old-completed-record-cannot-authorize-success-with-live-backend',old.returncode!=0 and 'RECOVERY_TARGET_NOT_QUIESCENT' in old.stderr and saved_status(n)=='REQUARANTINE_INTENT')
 denied=cancel(n,allow=True);check('blocked-requarantine-never-reopens-obsolete-source',denied.returncode!=0 and not flags('source_'+n)['open'])
 late.stdin.write('SELECT current_user;UPDATE "Project" SET name=\'KNOWN_PENDING_CONNECTION\' WHERE id=\'closed-project\';\n');late.stdin.flush()
 output=close_runtime(late);(O/'requarantine-existing-session.log').write_text(safe(output))
 check('operator-explicitly-drains-existing-ordinary-session',late.returncode==0 and 'runtime' in output and 'UPDATE 1' in output)
 done=json.loads(req(n).stdout)
 check('requarantine-completes-only-after-explicit-drain',done['status']=='CURRENT_SOURCE_REQUARANTINED' and saved_status(n)=='CURRENT_SOURCE_REQUARANTINED' and not flags('active_'+n)['open'] and not flags('source_'+n)['open'])
 check('post-drain-requarantine-retry-is-idempotent',json.loads(req(n).stdout)['status']=='CURRENT_SOURCE_REQUARANTINED')
 copied=inspect_closed_accounting(n)
 check('requarantine-preserves-confirmed-Credits-and-account-deletion',copied=={'credits':2,'applied':True,'users':1,'sessions':0,'identities':0})
 # COMMIT succeeds, but no acknowledgment reaches the actual CLI.
 n='close_ack';new_requarantine_case(n);fault=req_fault(n,'lost-close-ack');exitcode,logs=req_finish(fault)
 check('lost-requarantine-COMMIT-ack-fails-with-target-and-source-closed',exitcode!='0' and not flags('active_'+n)['open'] and not flags('source_'+n)['open'] and saved_status(n)=='REQUARANTINE_INTENT')
 check('fresh-retry-recovers-committed-quarantine-from-live-state',json.loads(req(n).stdout)['status']=='CURRENT_SOURCE_REQUARANTINED')
 # A real process crash after the admission fence cannot create cached authority.
 n='close_crash';new_requarantine_case(n);fault=req_fault(n,'after-close-commit');req_barrier(n,fault)
 rival=req(n,allow=True);check('concurrent-requarantine-cannot-steal-live-owner',rival.returncode!=0 and 'RECOVERY_OPERATION_BUSY' in rival.stderr)
 exitcode,logs=req_finish(fault,True)
 check('real-SIGKILL-after-quarantine-COMMIT-retains-incomplete-closed-state',exitcode=='137' and not flags('active_'+n)['open'] and not flags('source_'+n)['open'] and saved_status(n)=='REQUARANTINE_INTENT')
 d('restart-PG-after-quarantine-crash',['restart',ID+'-pg']);wait('PG post-quarantine-crash',lambda:d('pg-ready',['exec',ID+'-pg','pg_isready','-U','postgres'],allow=True).returncode==0)
 check('restart-recovery-rechecks-and-completes-drained-quarantine',json.loads(req(n).stdout)['status']=='CURRENT_SOURCE_REQUARANTINED' and not flags('source_'+n)['open'])
 # Prepared transactions are live write authority even without an active session.
 n='close_prepared';new_requarantine_case(n)
 prepared=runtime_psql('active_'+n,"BEGIN;UPDATE \"Project\" SET name='UNCOMMITTED_PREPARED' WHERE id='closed-project';PREPARE TRANSACTION 'requarantine_pending';")
 check('actual-ordinary-runtime-prepared-transaction-exists',prepared.returncode==0 and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='active_"+n+"'")=='1')
 blocked=req(n,allow=True)
 check('prepared-transaction-prevents-completed-quarantine-after-fence',blocked.returncode!=0 and 'RECOVERY_TARGET_NOT_QUIESCENT' in blocked.stderr and not flags('active_'+n)['open'] and saved_status(n)=='REQUARANTINE_INTENT')
 d('restart-PG-with-prepared-transaction',['restart',ID+'-pg']);wait('PG with prepared transaction',lambda:d('pg-ready',['exec',ID+'-pg','pg_isready','-U','postgres'],allow=True).returncode==0)
 still=req(n,allow=True)
 check('prepared-write-remains-blocking-across-PG-and-CLI-restart',still.returncode!=0 and 'RECOVERY_TARGET_NOT_QUIESCENT' in still.stderr and saved_status(n)=='REQUARANTINE_INTENT' and sql("SELECT count(*) FROM pg_prepared_xacts WHERE database='active_"+n+"'")=='1')
 # Explicit trusted administration of the synthetic private target only.
 sql('ALTER DATABASE active_'+n+' ALLOW_CONNECTIONS true;')
 try:sql("ROLLBACK PREPARED 'requarantine_pending';",'active_'+n)
 finally:sql('ALTER DATABASE active_'+n+' ALLOW_CONNECTIONS false;')
 check('explicit-prepared-rollback-allows-confirmed-quarantine',json.loads(req(n).stdout)['status']=='CURRENT_SOURCE_REQUARANTINED' and not flags('source_'+n)['open'])

 # Uncertain creator with absent resources must remain blocked, not be erased.
 sql('CREATE DATABASE source_fenced TEMPLATE source_unknown;');stage('fenced')
 d('inject-private-unsettled-creator-fixture',['run','--rm','--label',LABEL+'='+ID,'--network','none','--read-only','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','-v',ID+'-journal:/journal','--entrypoint','node',OPS,'--input-type=module','-e',"import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/journal/runtime.sqlite');d.prepare(\"INSERT INTO runtimes(execution,runtime,state,lease,deadline,token,project,binding,allocationOwner) VALUES('uncertain','uncertain','STARTING',1,2,'','closed-project','fixture','creator-not-settled')\").run();d.close();"])
 fenced=activate('fenced',allow=True);check('absent-Docker-resources-cannot-clear-unsettled-creator-fence',fenced.returncode!=0 and 'RECOVERY_RUNTIME_STOP_UNCONFIRMED' in fenced.stderr and not flags(target('fenced'))['open'])
 # A real killed SQLite writer leaves WAL; never inspect a stale main-file copy.
 crash_name=ID+'-journal-crash'
 d('start-only-journal-writer-before-crash',['run','-d','--name',crash_name,'--label',LABEL+'='+ID,'--network','none','--read-only','--user','0:0','--cap-drop','ALL','--security-opt','no-new-privileges:true','-v',ID+'-journal:/journal','--entrypoint','node',OPS,'--input-type=module','-e',"import fs from 'node:fs';import {DatabaseSync} from 'node:sqlite';const d=new DatabaseSync('/journal/runtime.sqlite');d.exec('PRAGMA journal_mode=WAL;PRAGMA synchronous=FULL;PRAGMA wal_autocheckpoint=0');d.prepare(\"INSERT INTO runtimes(execution,runtime,state,lease,deadline,token,project,binding,allocationOwner) VALUES('crashed','crashed','STARTING',1,2,'','closed-project','fixture','unsettled')\").run();fs.writeFileSync('/journal/crash-ready','READY');setInterval(()=>d.prepare('SELECT 1').get(),1000);"])
 wait('committed-WAL-before-kill',lambda:d('private-crash-barrier',oa('reader')+['-e',"const fs=require('fs');process.exit(fs.existsSync('/recovery-runtime/crash-ready')&&fs.statSync('/recovery-runtime/runtime.sqlite-wal').size>0?0:1)"],allow=True).returncode==0)
 d('externally-SIGKILL-only-SQLite-writer',['kill','--signal','KILL',crash_name]);crash=d('wait-confirmed-SIGKILL',['wait',crash_name]);check('SQLite-writer-was-actually-killed-with-137',crash.stdout.strip()=='137')
 wal=activate('fenced',allow=True);check('nonempty-WAL-after-real-writer-SIGKILL-cannot-be-omitted',wal.returncode!=0 and 'RECOVERY_JOURNAL_CHECKPOINT_REQUIRED' in wal.stderr)
 R['status']='PASS'
except Exception as e:
 R['status']='FAIL';R['error']=safe(str(e));(O/'failure-trace.txt').write_text(safe(traceback.format_exc()));save()
 d('failure-supervisor-log',['logs',ID+'-supervisor'],allow=True)
finally:
 try:
  for client in CLIENTS:
   if client.poll() is None:
    close_runtime(client)
  if lock_child:
   sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name='activation_name_hold'");lock_child.wait(timeout=10)
  for c in d('owned-container-inventory',['ps','-aq','--filter','label='+LABEL+'='+ID]).stdout.split():d('remove-owned-container',['rm','-fv',c])
  # Driver-owned allocations have their own exact supervisor label.
  for c in d('owned-runtime-container-inventory',['ps','-aq','--filter','label=oddpath.supervisor='+ID]).stdout.split():d('remove-owned-runtime-container',['rm','-fv',c])
  for net in d('owned-runtime-network-inventory',['network','ls','-q','--filter','label=oddpath.supervisor='+ID]).stdout.split():d('remove-owned-runtime-network',['network','rm',net])
  for v in CREATED:
   assert d('verify-volume-owner',['volume','inspect',v,'--format','{{index .Labels "'+LABEL+'"}}']).stdout.strip()==ID;d('remove-owned-volume',['volume','rm',v])
  n=d('verify-network-owner',['network','inspect',ID,'--format','{{index .Labels "'+LABEL+'"}}'],allow=True)
  if n.returncode==0:assert n.stdout.strip()==ID;d('remove-owned-network',['network','rm',ID])
  for p in (O/'private').glob('*'):assert p.is_file();p.unlink()
  R['cleanup']=True
 except Exception as e:R['cleanup']=False;R['status']='FAIL';R['cleanupError']=str(e)
 save();print(json.dumps({'status':R['status'],'checks':len(R['checks']),'cleanup':R.get('cleanup'),'error':R.get('error')}))
raise SystemExit(0 if R['status']=='PASS' else 1)
