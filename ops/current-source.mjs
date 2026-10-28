import {randomUUID} from 'node:crypto';
import {readdir} from 'node:fs/promises';
import {resolve,relative,isAbsolute,join} from 'node:path';
import {RECOVERY_DATABASE_MARKER,isRecoveryDatabase} from '@oddpath/qa-execution-contract';
import {pgClient,pgEnvironment,restoreTargetAllowed} from './backup.mjs';
import {atomicJson,privateDirectory,readPrivate,requireCondition} from './lib/private-files.mjs';
import {LocalOperationsLock} from './lib/local-lock.mjs';

const root=resolve(import.meta.dirname,'..');
const SOURCE_MARKER='ODDPATH_RECOVERY_SOURCE_FROZEN_V1:';
const ACK='FREEZE_SOURCE_KEEP_TARGET_QUARANTINED';
const identifier=value=>{requireCondition(typeof value==='string'&&/^[a-z][a-z0-9_]{0,62}$/.test(value),'RECOVERY_IDENTIFIER_INVALID');return '"'+value+'"';};
const literal=value=>value===null?'NULL':"'"+String(value).replaceAll("'","''")+"'";
const safeCode=e=>/^RECOVERY_[A-Z_]+$/.test(e?.code??'')?e.code:'RECOVERY_CURRENT_SOURCE_FAILED';

function names(source,target,owner){
 for(const value of [source,target,owner])identifier(value);
 requireCondition(!['postgres','template0','template1'].includes(source)&&source!==target,'RECOVERY_SOURCE_INVALID');
 requireCondition(restoreTargetAllowed(target,target,'ISOLATED_EMPTY_TARGET'),'RECOVERY_TARGET_NAME_INVALID');
}
async function stateFolder(path){
 const directory=await privateDirectory(path),inside=relative(root,directory);
 requireCondition(inside.startsWith('..')||isAbsolute(inside),'RECOVERY_STATE_OUTSIDE_CHECKOUT_REQUIRED');return directory;
}
function summary(state){
 return {schemaVersion:1,status:state.status,operationId:state.operationId,source:state.source.name,target:state.target.name,
  sourceMustRemainFrozen:!state.status.startsWith('CANCELLED'),targetActivation:'BLOCKED',
  postgresContinuity:state.status==='CURRENT_SOURCE_STAGED_QUARANTINED'?'CURRENT_QUIESCED_SAME_CLUSTER_COPY':'UNVERIFIED',
  revocationContinuity:'UNVERIFIED',physicalStop:'UNVERIFIED',activationAuthorized:false,releaseAuthorized:false,
  requirements:['Keep the source frozen and the target closed; a saved receipt cannot authorize activation',
   'Current independent revocations or fresh saved-login generations, physical Stop and unresolved-usage review',
   'Separate reviewed activation/migration/grant and release gates; this command never starts an API or provider']};
}

/** One local journal owner plus live PG locks. No durable token grants authority. */
async function control(directory,env,connect,signal,fn){
 let client,local,owned=false,lost=false;
 const alive=()=>requireCondition(!lost&&!signal?.aborted,'RECOVERY_CONTROL_LOST');
 const disconnect=()=>{lost=true;};
 const abort=()=>{lost=true;client?.end().catch(()=>{});};
 try{
  requireCondition(connect!==pgClient||env===process.env,'RECOVERY_PROCESS_ENV_REQUIRED');
  pgEnvironment(env);requireCondition(env.PGDATABASE==='postgres','RECOVERY_CONTROL_DATABASE_REQUIRED');
  await readPrivate(env.PGPASSFILE);
  local=new LocalOperationsLock(join(directory,'operation.lock.sqlite'));await local.connect();owned=await local.acquire();
  requireCondition(owned,'RECOVERY_OPERATION_BUSY');alive();
  client=await connect();client.on('error',disconnect);client.on('end',disconnect);
  signal?.addEventListener('abort',abort,{once:true});alive();
  const query=async(sql,args)=>{alive();const value=await client.query(sql,args);alive();return value;};
  const identity=(await query(`SELECT current_database() AS database, r.rolsuper AS admin,
   current_setting('server_version_num')::int AS version, c.system_identifier::text AS "systemId"
   FROM pg_roles r CROSS JOIN pg_control_system() c WHERE r.rolname=current_user`)).rows[0];
  requireCondition(identity?.database==='postgres'&&identity.admin===true&&identity.version>=160000&&identity.version<170000,'RECOVERY_TRUSTED_PG16_ADMIN_REQUIRED');
  await query("SET statement_timeout='60s'");await query("SET lock_timeout='5s'");
  const save=async state=>{alive();await local.check();await atomicJson(join(directory,'state.json'),state,{beforeCommit:alive});alive();};
  const metadata=async name=>(await query(`SELECT d.oid::text AS oid,d.datname AS name,d.datallowconn AS "allowsConnections",
    d.datistemplate AS template,d.datdba::text AS "ownerOid",shobj_description(d.oid,'pg_database') AS comment
    FROM pg_database d WHERE d.datname=$1`,[name])).rows[0];
  const locks=async state=>{
   for(const name of new Set([state.source.name,state.target.name,...(state.activation?[state.activation.database]:[])]))
    requireCondition((await query("SELECT pg_try_advisory_lock(hashtext('oddpath_current_recovery'),hashtext($1)) AS held",[name])).rows[0]?.held===true,'RECOVERY_DATABASE_BUSY');
  };
  const noWriters=async source=>{
   const found=(await query(`SELECT
    (SELECT count(*)::int FROM pg_stat_activity WHERE datid=$1::oid) AS sessions,
    (SELECT count(*)::int FROM pg_prepared_xacts WHERE database=$2) AS prepared`,[source.oid,source.name])).rows[0];
   requireCondition(found.sessions===0&&found.prepared===0,'RECOVERY_SOURCE_NOT_QUIESCENT');
  };
  const role=async owner=>{
   const found=(await query(`SELECT r.oid::text AS oid,NOT(r.rolsuper OR r.rolcanlogin OR r.rolcreatedb OR r.rolcreaterole OR r.rolreplication OR r.rolbypassrls) AS safe,
    NOT EXISTS(SELECT 1 FROM pg_roles other WHERE other.oid<>r.oid AND NOT other.rolsuper AND pg_has_role(other.oid,r.oid,'MEMBER')) AS exclusive
    FROM pg_roles r WHERE r.rolname=$1`,[owner])).rows[0];
   requireCondition(found?.safe===true&&found.exclusive===true,'RECOVERY_EXCLUSIVE_NOLOGIN_OWNER_REQUIRED');return found;
  };
  const frozen=async state=>{
   requireCondition(identity.systemId===state.systemId,'RECOVERY_CLUSTER_CHANGED');
   const source=await metadata(state.source.name);
   requireCondition(source?.oid===state.source.oid&&!source.allowsConnections&&source.comment===SOURCE_MARKER+state.operationId,'RECOVERY_SOURCE_FENCE_CHANGED');
   await noWriters(source);return source;
  };
  const closed=async(state,{required=true}={})=>{
   const target=await metadata(state.target.name);
   if(!target){requireCondition(!required,'RECOVERY_TARGET_MISSING');return;}
   requireCondition(!target.allowsConnections&&!target.template&&target.ownerOid===state.target.ownerOid&&
    (!state.target.oid||state.target.oid===target.oid),'RECOVERY_TARGET_FENCE_CHANGED');
   if(required)requireCondition(target.comment===RECOVERY_DATABASE_MARKER+':'+state.operationId,'RECOVERY_TARGET_FENCE_CHANGED');
   const acl=(await query(`SELECT NOT EXISTS(SELECT 1 FROM pg_database d,
    LATERAL aclexplode(coalesce(d.datacl,acldefault('d',d.datdba))) a
    WHERE d.datname=$1 AND a.privilege_type='CONNECT' AND a.grantee<>d.datdba) AS private`,[target.name])).rows[0];
   // Before CREATE's next statement PUBLIC may retain its default grant, but
   // ALLOW_CONNECTIONS=false still blocks everyone, including administrators.
   if(required)requireCondition(acl.private===true,'RECOVERY_TARGET_ACCESS_CHANGED');
   await role(state.target.owner);return target;
  };
  return await fn({query,save,metadata,locks,noWriters,role,frozen,closed,identity,alive});
 }finally{
  signal?.removeEventListener('abort',abort);
  if(client){client.removeListener('end',disconnect);await client.end().catch(()=>{});}
  if(local)await local.end().catch(()=>{});
 }
}

export async function stageCurrentSource({source,target,owner,stateDirectory,env=process.env,connect=pgClient,signal}={}){
 names(source,target,owner);requireCondition(env.ODDPATH_RECOVERY_SOURCE_ACK===ACK,'RECOVERY_SOURCE_ACK_REQUIRED');
 const directory=await stateFolder(stateDirectory);
 return control(directory,env,connect,signal,async ctx=>{
  requireCondition((await readdir(directory)).every(n=>['operation.lock.sqlite','operation.lock.sqlite-journal','operation.lock.sqlite-wal','operation.lock.sqlite-shm'].includes(n)),'RECOVERY_NEW_STATE_DIRECTORY_REQUIRED');
  const state={schemaVersion:1,operationId:randomUUID(),status:'PREPARING',createdAt:new Date().toISOString(),systemId:ctx.identity.systemId,
   source:{name:source},target:{name:target,owner},activationAuthorized:false,releaseAuthorized:false};
  await ctx.locks(state);
  const initial=await ctx.metadata(source),ownerRole=await ctx.role(owner);
  requireCondition(initial&&!initial.template&&initial.allowsConnections&&!isRecoveryDatabase({databaseName:source,recoveryComment:initial.comment}),'RECOVERY_OPERATIONAL_SOURCE_REQUIRED');
  requireCondition(initial.ownerOid!==ownerRole.oid,'RECOVERY_SOURCE_AND_TARGET_OWNER_MUST_DIFFER');
  requireCondition(!await ctx.metadata(target),'RECOVERY_TARGET_ALREADY_EXISTS');
  await ctx.noWriters(initial);
  state.source={...initial,originalComment:initial.comment};state.target.ownerOid=ownerRole.oid;
  await ctx.save(state);
  try{
   // Durable source closure and startup marker are one commit. No sessions are
   // killed, guessed as drained, or silently resumed after any failure.
   await ctx.query('BEGIN');
   await ctx.query('ALTER DATABASE '+identifier(source)+' ALLOW_CONNECTIONS false');
   await ctx.query('COMMENT ON DATABASE '+identifier(source)+' IS '+literal(SOURCE_MARKER+state.operationId));
   await ctx.query('COMMIT');state.status='SOURCE_FROZEN';await ctx.save(state);
   await ctx.frozen(state);
   // PostgreSQL owns the exclusive template lock and physical consistent copy.
   // Closed at creation: failure between CREATE/REVOKE/COMMENT exposes no data.
   await ctx.query('CREATE DATABASE '+identifier(target)+' WITH TEMPLATE '+identifier(source)+' OWNER '+identifier(owner)+' ALLOW_CONNECTIONS false STRATEGY WAL_LOG');
   state.target.oid=(await ctx.metadata(target)).oid;state.status='TARGET_CLOSED';await ctx.save(state);
   await ctx.query('REVOKE ALL ON DATABASE '+identifier(target)+' FROM PUBLIC');
   await ctx.query('COMMENT ON DATABASE '+identifier(target)+' IS '+literal(RECOVERY_DATABASE_MARKER+':'+state.operationId));
   await ctx.frozen(state);await ctx.closed(state);
   state.status='CURRENT_SOURCE_STAGED_QUARANTINED';state.completedAt=new Date().toISOString();await ctx.save(state);return summary(state);
  }catch(error){
   await ctx.query('ROLLBACK').catch(()=>{});
   state.status='FAILED_SOURCE_REQUIRES_INSPECTION';state.code=safeCode(error);
   await ctx.save(state).catch(()=>{});throw error;
  }
 });
}

async function loadState(directory){
 let state;try{state=JSON.parse((await readPrivate(join(directory,'state.json'),65536)).toString());}catch{throw Object.assign(new Error('RECOVERY_STATE_INVALID'),{code:'RECOVERY_STATE_INVALID'});}
 requireCondition(state?.schemaVersion===1&&typeof state.operationId==='string'&&/^[a-f0-9-]{36}$/.test(state.operationId)&&
  typeof state.systemId==='string'&&typeof state.source?.oid==='string'&&typeof state.target?.ownerOid==='string'&&
  (state.source.originalComment===null||typeof state.source.originalComment==='string')&&typeof state.status==='string','RECOVERY_STATE_INVALID');
 names(state.source.name,state.target.name,state.target.owner);return state;
}

/** Revalidate live fences. A cached success is never accepted as current proof. */
export async function inspectCurrentSource({stateDirectory,env=process.env,connect=pgClient,signal}={}){
 const directory=await stateFolder(stateDirectory);
 return control(directory,env,connect,signal,async ctx=>{
  const state=await loadState(directory);await ctx.locks(state);
  requireCondition(state.status==='CURRENT_SOURCE_STAGED_QUARANTINED','RECOVERY_STAGE_NOT_COMPLETE');
  try{await ctx.frozen(state);await ctx.closed(state);return {...summary(state),status:'CURRENT_SOURCE_FENCES_VALIDATED',validatedAt:new Date().toISOString()};}
  catch(error){state.status='INVALIDATED_REQUIRES_INSPECTION';state.code=safeCode(error);await ctx.save(state).catch(()=>{});throw error;}
 });
}

/** Explicitly cancel this operation only. Never opens/promotes its target. */
export async function cancelCurrentSource({stateDirectory,confirmation,env=process.env,connect=pgClient,signal}={}){
 const directory=await stateFolder(stateDirectory);
 return control(directory,env,connect,signal,async ctx=>{
  const state=await loadState(directory);requireCondition(confirmation===state.source.name,'RECOVERY_CANCEL_SOURCE_CONFIRMATION_REQUIRED');
  await ctx.locks(state);requireCondition(ctx.identity.systemId===state.systemId,'RECOVERY_CLUSTER_CHANGED');
  if(state.activation){
   const beforeActivation=['ACTIVATION_INTENT','ACTIVATION_PREPARED'].includes(state.status);
   const retryCancel=state.activation.cancelRequested===true&&['CANCEL_REQUESTED','CANCELLED_SOURCE_RESUMABLE'].includes(state.status);
   requireCondition((beforeActivation||retryCancel)&&!await ctx.metadata(state.activation.database),'RECOVERY_ACTIVATION_SOURCE_RESUME_FORBIDDEN');
   // A lost rename reply cannot be cancelled: the exact original closed target
   // must still exist. No source reopens alongside an activated/replaced copy.
   await ctx.closed(state);state.activation.cancelRequested=true;await ctx.save(state);
  }
  const found=await ctx.metadata(state.source.name);requireCondition(found?.oid===state.source.oid,'RECOVERY_SOURCE_FENCE_CHANGED');
  await ctx.closed(state,{required:state.status==='CURRENT_SOURCE_STAGED_QUARANTINED'});
  if(found.allowsConnections&&found.comment===state.source.originalComment){
   state.status='CANCELLED_SOURCE_RESUMABLE';await ctx.save(state);return summary(state);
  }
  await ctx.frozen(state);state.status='CANCEL_REQUESTED';await ctx.save(state);
  await ctx.query('BEGIN');
  try{
   await ctx.query('COMMENT ON DATABASE '+identifier(state.source.name)+' IS '+literal(state.source.originalComment));
   await ctx.query('ALTER DATABASE '+identifier(state.source.name)+' ALLOW_CONNECTIONS true');
   await ctx.query('COMMIT');
  }catch(error){await ctx.query('ROLLBACK').catch(()=>{});throw error;}
  state.status='CANCELLED_SOURCE_RESUMABLE';state.cancelledAt=new Date().toISOString();await ctx.save(state);return summary(state);
 });
}

/** Shared privileged operator context; preserves local and PG ownership. */
export async function withCurrentSourceOperation({stateDirectory,env=process.env,connect=pgClient,signal}={},fn){
 const directory=await stateFolder(stateDirectory);
 return control(directory,env,connect,signal,async ctx=>{
  const state=await loadState(directory);await ctx.locks(state);return fn(ctx,state);
 });
}
