import {Client} from 'pg';
import {CLOSED_RECOVERY_DATABASE_MARKER,RECOVERY_DATABASE_MARKER} from '@oddpath/qa-execution-contract';
import {withCurrentSourceOperation} from './current-source.mjs';
import {proveRecoveryRuntime} from './recovery-runtime-proof.mjs';
import {requireCondition} from './lib/private-files.mjs';

const id=v=>{requireCondition(typeof v==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(v),'RECOVERY_IDENTIFIER_INVALID');return '"'+v+'"';};
const lit=v=>"'"+v.replaceAll("'","''")+"'";
const ACTIVE='CURRENT_SOURCE_ACTIVE_CLOSED';
const result=s=>({schemaVersion:1,status:s.status,operationId:s.operationId,source:s.source.name,database:s.activation.database,
 sourceMustRemainFrozen:true,closedProfileRequired:true,activationAuthorized:s.status===ACTIVE,releaseAuthorized:false,
 savedLoginAuthority:'NONE_NO_SAVED_STATE_ALLOWED',physicalStop:s.activation.runtimeProof?'VERIFIED_AT_ACTIVATION':'UNVERIFIED',physicalStopObservedAt:s.activation.runtimeProof?.observedAt??null});
async function runtimeRole(ctx,state,name){
 id(name);const r=(await ctx.query(`SELECT r.oid::text AS oid,NOT(r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AND r.rolcanlogin AS safe,
 NOT EXISTS(SELECT 1 FROM pg_roles o WHERE o.oid<>r.oid AND NOT o.rolsuper AND pg_has_role(o.oid,r.oid,'MEMBER')) AS exclusive,
 NOT EXISTS(SELECT 1 FROM pg_roles g WHERE g.oid<>r.oid AND pg_has_role(r.oid,g.oid,'MEMBER')) AS standalone,
 pg_has_role(r.oid,$2::oid,'MEMBER') OR pg_has_role(r.oid,$3::oid,'MEMBER') AS owner FROM pg_roles r WHERE r.rolname=$1`,[name,state.source.ownerOid,state.target.ownerOid])).rows[0];
 requireCondition(r?.safe===true&&r.exclusive===true&&r.standalone===true&&r.owner===false,'RECOVERY_SAFE_EXCLUSIVE_RUNTIME_ROLE_REQUIRED');return r;
}
async function targetInfo(ctx,state,name,{open=false,active=false}={}){
 const meta=await ctx.metadata(name);
 requireCondition(meta?.oid===state.target.oid&&meta.ownerOid===state.target.ownerOid&&!meta.template&&meta.allowsConnections===open&&meta.comment===(active?CLOSED_RECOVERY_DATABASE_MARKER:RECOVERY_DATABASE_MARKER)+':'+state.operationId,'RECOVERY_ACTIVATION_TARGET_CHANGED');
 const allowed=[state.target.ownerOid,...(active?[state.activation.runtimeOid]:[])];
 const acl=(await ctx.query(`SELECT NOT EXISTS(SELECT 1 FROM pg_database d,LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
 WHERE d.datname=$1 AND a.privilege_type='CONNECT' AND NOT(a.grantee=ANY($2::oid[]))) AS safe`,[name,allowed])).rows[0];
 requireCondition(acl.safe===true,'RECOVERY_ACTIVATION_ACCESS_CHANGED');await ctx.role(state.target.owner);return meta;
}
async function prepareTarget(ctx,state,env,signal){
 let client;
 await targetInfo(ctx,state,state.target.name);
 await ctx.query('ALTER DATABASE '+id(state.target.name)+' ALLOW_CONNECTIONS true');
 try{
  client=new Client({database:state.target.name,application_name:'oddpath-recovery-preparation',connectionTimeoutMillis:5000,query_timeout:10000});
  client.on('error',()=>{});await client.connect();
  const q=async(sql,args)=>{ctx.alive();signal?.throwIfAborted();const value=await client.query(sql,args);ctx.alive();return value;};
  await q('BEGIN ISOLATION LEVEL SERIALIZABLE');
  await q(`LOCK TABLE "UsageEvent","UsageProviderAttempt","UsageSettlementReceipt","QaBrowserReservation","QaBrowserRuntime","QaExecutionJob","QaGenerationExecution","QaSavedBrowserState","StoredAsset","Session" IN ACCESS EXCLUSIVE MODE`);
  const counts=(await q(`SELECT
   (SELECT count(*)::int FROM "UsageEvent" WHERE status NOT IN ('completed','failed') OR status='completed' AND "creditsUsed" IS NULL) AS usage,
   (SELECT count(*)::int FROM "UsageProviderAttempt" WHERE status<>'completed' OR "creditsUsed" IS NULL) AS attempts,
   (SELECT count(*)::int FROM "UsageSettlementReceipt" WHERE "appliedAt" IS NULL) AS receipts,
   (SELECT count(*)::int FROM "QaBrowserReservation" WHERE state<>'RELEASED') AS holds,
   (SELECT count(*)::int FROM "QaBrowserRuntime" WHERE state<>'STOP_CONFIRMED' OR "exitObservedAt" IS NULL) AS browsers,
   (SELECT count(*)::int FROM "QaExecutionJob" WHERE status IN ('QUEUED','CLAIMED','RUNNING')) AS jobs,
   (SELECT count(*)::int FROM "QaGenerationExecution" WHERE status IN ('PENDING','PROCESSING')) AS generations,
   (SELECT count(*)::int FROM "QaSavedBrowserState") AS saved,
   (SELECT count(*)::int FROM "StoredAsset") AS assets`)).rows[0];
  requireCondition(Object.values(counts).every(v=>v===0),'RECOVERY_CLOSED_PREREQUISITES_UNRESOLVED');
  const sessions=(await q('DELETE FROM "Session"')).rowCount;
  await q('COMMIT');state.activation.invalidatedSessions=sessions;state.activation.preparationCounts=counts;
 }catch(e){await client?.query('ROLLBACK').catch(()=>{});throw e;}
 finally{await client?.end().catch(()=>{});await ctx.query('ALTER DATABASE '+id(state.target.name)+' ALLOW_CONNECTIONS false');}
 await targetInfo(ctx,state,state.target.name);
}

/** Closed profile only. All external-cost ambiguity and active holds block it. */
export async function activateCurrentClosed({confirmation,database,runtimeRole:name,env=process.env,signal,...options}={}){
 id(database);id(name);requireCondition(!['postgres','template0','template1'].includes(database)&&!database.startsWith('oddpath_restore_'),'RECOVERY_OPERATIONAL_NAME_INVALID');
 requireCondition(env.ODDPATH_RECOVERY_ACTIVATION_ACK==='CURRENT_SOURCE_CLOSED_ONLY','RECOVERY_CLOSED_ACTIVATION_ACK_REQUIRED');
 return withCurrentSourceOperation({...options,env,signal},async(ctx,state)=>{
  requireCondition(confirmation===state.source.name&&database!==state.source.name&&database!==state.target.name,'RECOVERY_ACTIVATION_CONFIRMATION_REQUIRED');
  requireCondition(['CURRENT_SOURCE_STAGED_QUARANTINED','ACTIVATION_INTENT','ACTIVATION_PREPARED',ACTIVE].includes(state.status),'RECOVERY_ACTIVATION_STATE_INVALID');
  await ctx.frozen(state);
  if(state.activation)requireCondition(state.activation.database===database&&state.activation.runtimeRole===name,'RECOVERY_ACTIVATION_IDENTITY_CHANGED');
  const role=await runtimeRole(ctx,state,name);
  if(state.activation)requireCondition(role.oid===state.activation.runtimeOid,'RECOVERY_ACTIVATION_IDENTITY_CHANGED');
  else state.activation={database,runtimeRole:name,runtimeOid:role.oid};
  // The first activation learns its operational name here. Subsequent commands
  // acquire it from saved state too, sharing staging's database lock namespace.
  await ctx.locks(state);
  const existing=await ctx.metadata(database);
  if(existing){
   // COMMIT may have succeeded without its reply or final JSON publication.
   requireCondition(!await ctx.metadata(state.target.name),'RECOVERY_ACTIVATION_NAME_CONFLICT');
   await targetInfo(ctx,state,database,{open:true,active:true});state.status=ACTIVE;await ctx.save(state);return result(state);
  }
  requireCondition(state.status!==ACTIVE,'RECOVERY_ACTIVATION_TARGET_CHANGED');
  const meta=await ctx.metadata(state.target.name);
  // Only our persisted intent permits closing an interrupted private preparation.
  if(state.status!=='CURRENT_SOURCE_STAGED_QUARANTINED'&&meta?.allowsConnections){
   await targetInfo(ctx,state,state.target.name,{open:true});
   requireCondition((await ctx.query('SELECT count(*)::int AS n FROM pg_stat_activity WHERE datid=$1::oid',[state.target.oid])).rows[0].n===0,'RECOVERY_TARGET_NOT_QUIESCENT');
   await ctx.query('ALTER DATABASE '+id(state.target.name)+' ALLOW_CONNECTIONS false');
  }
  await ctx.closed(state);
  state.activation.runtimeProof=await proveRecoveryRuntime({env,query:ctx.query,signal});
  state.status='ACTIVATION_INTENT';await ctx.save(state);
  await prepareTarget(ctx,state,env,signal);
  state.status='ACTIVATION_PREPARED';await ctx.save(state);
  const proof=await proveRecoveryRuntime({env,query:ctx.query,signal});
  requireCondition(proof.journalVolume===state.activation.runtimeProof.journalVolume&&proof.journalSha256===state.activation.runtimeProof.journalSha256&&proof.supervisor===state.activation.runtimeProof.supervisor,'RECOVERY_RUNTIME_JOURNAL_CHANGED');
  state.activation.runtimeProof=proof;await ctx.frozen(state);await ctx.closed(state);await runtimeRole(ctx,state,name);
  await ctx.query('BEGIN');
  try{
   await ctx.query('ALTER DATABASE '+id(state.target.name)+' RENAME TO '+id(database));
   await ctx.query('COMMENT ON DATABASE '+id(database)+' IS '+lit(CLOSED_RECOVERY_DATABASE_MARKER+':'+state.operationId));
   await ctx.query('GRANT CONNECT ON DATABASE '+id(database)+' TO '+id(name));
   await ctx.query('ALTER DATABASE '+id(database)+' ALLOW_CONNECTIONS true');await ctx.query('COMMIT');
  }catch(e){await ctx.query('ROLLBACK').catch(()=>{});throw e;}
  await targetInfo(ctx,state,database,{open:true,active:true});state.status=ACTIVE;state.activation.activatedAt=new Date().toISOString();await ctx.save(state);return result(state);
 });
}

/** Drain-checked kill switch; data is retained and the old source stays frozen. */
export async function requarantineCurrentClosed({confirmation,env=process.env,signal,...options}={}){
 return withCurrentSourceOperation({...options,env,signal},async(ctx,state)=>{
  requireCondition(state.activation&&confirmation===state.activation.database&&[ACTIVE,'REQUARANTINE_INTENT','CURRENT_SOURCE_REQUARANTINED'].includes(state.status),'RECOVERY_REQUARANTINE_CONFIRMATION_REQUIRED');
  await ctx.frozen(state);await proveRecoveryRuntime({env,query:ctx.query,signal});
  const meta=await ctx.metadata(confirmation);
  if(state.status!=='CURRENT_SOURCE_REQUARANTINED'&&meta?.allowsConnections){
   await targetInfo(ctx,state,confirmation,{open:true,active:true});
   state.status='REQUARANTINE_INTENT';await ctx.save(state);
   await ctx.query('BEGIN');try{
    await ctx.query('ALTER DATABASE '+id(confirmation)+' ALLOW_CONNECTIONS false');
    await ctx.query('COMMENT ON DATABASE '+id(confirmation)+' IS '+lit(RECOVERY_DATABASE_MARKER+':'+state.operationId));
    await ctx.query('REVOKE ALL ON DATABASE '+id(confirmation)+' FROM '+id(state.activation.runtimeRole));await ctx.query('COMMIT');
   }catch(e){await ctx.query('ROLLBACK').catch(()=>{});throw e;}
  }
  await targetInfo(ctx,state,confirmation);
  // ALLOW_CONNECTIONS/CONNECT fence admission, not existing backends. Commit
  // that fence first, then observe fresh PG state outside the transaction.
  // Even a previously completed record must become incomplete while checked:
  // old versions could publish completion with a surviving ordinary session.
  if(state.status!=='REQUARANTINE_INTENT'){state.status='REQUARANTINE_INTENT';await ctx.save(state);}
  const pending=(await ctx.query(`SELECT
   (SELECT count(*)::int FROM pg_stat_activity WHERE datid=$1::oid) AS sessions,
   (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=$2) AS prepared`,[state.target.oid,confirmation])).rows[0];
  requireCondition(pending.sessions===0&&pending.prepared===0,'RECOVERY_TARGET_NOT_QUIESCENT');
  state.status='CURRENT_SOURCE_REQUARANTINED';await ctx.save(state);return result(state);
 });
}
