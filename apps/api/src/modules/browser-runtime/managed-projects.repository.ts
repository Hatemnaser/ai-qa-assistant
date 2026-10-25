import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {runnerRegistrationV2Schema} from '@oddpath/qa-execution-contract';
import {prisma} from '../../db/prisma.js';
import {env} from '../../config/env.js';
import {AppError} from '../../lib/errors.js';
import {hashCanonicalJson} from '../../lib/canonical-json.js';
import {lockQaTarget} from '../qa-targets/qa-targets.repository.js';
import {targetSnapshot} from '../qa-targets/qa-targets.binding.js';
import {lockTestProject} from '../test-sessions/test-sessions.guard.js';
import {managedProjectToken,currentManagedBinding} from './managed-project-identity.js';
import {createBrowserRuntimeRepository} from './browser-runtime.repository.js';

const scopes=['evidence:write','execution:claim','execution:write','qa:read'];
const missing=()=>new AppError('Browser runtime was not found.',404,'BROWSER_RUNTIME_NOT_FOUND');
export function createManagedProjectsRepository(database=prisma,now=()=>new Date()) {
  const runtime=createBrowserRuntimeRepository(database,now);
  return {
    async catalog(after:string|undefined,manualLogin:boolean,allowProduction=false) {
      const targets=await database.qaTarget.findMany({
        where:{...(after?{id:{gt:after}}:{}),project:{owner:{emailVerifiedAt:{not:null}}},
          revisions:{some:{verifications:{some:{verifiedAt:{not:null},validUntil:{gt:now()}}}}}},
        orderBy:{id:'asc'},take:21,select:{id:true,projectId:true},
      });
      const entries=[];
      for(const candidate of targets.slice(0,20)){
        const entry=await database.$transaction(async tx=>{
          await lockTestProject(tx,candidate.projectId);
          await lockQaTarget(tx,candidate.id);
          const target=await tx.qaTarget.findUnique({where:{id:candidate.id},include:{project:{include:{owner:{select:{emailVerifiedAt:true}}}}}});
          if(!target?.project.owner.emailVerifiedAt)return null;
          const revision=await tx.qaTargetRevision.findUnique({where:{targetId_revision:{targetId:target.id,revision:target.currentRevision}}});
          if(!revision||revision.authorityUserId!==target.project.ownerId)return null;
          const proof=await tx.qaTargetVerification.findFirst({where:{revisionId:revision.id,verifiedAt:{not:null},validUntil:{gt:now()}},orderBy:{validUntil:'desc'}});
          if(!proof?.validUntil)return null;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('oddpath:managed-project-provision',0))`;
          let binding=await tx.projectConnectionToken.findUnique({where:{projectId_managedHostId:{projectId:target.projectId,managedHostId:env.qaManagedHostId}}});
          if(!binding){
            if(await tx.projectConnectionToken.count({where:{managedHostId:env.qaManagedHostId}})>=1000)return null;
            const identity={id:'mb-'+randomUUID(),projectId:target.projectId,ownerId:target.project.ownerId,managedHostId:env.qaManagedHostId};
            const token=managedProjectToken(identity);
            binding=await tx.projectConnectionToken.create({data:{...identity,name:'Oddpath managed browser',scopes,
              tokenHash:createHash('sha256').update(token).digest('hex'),tokenPrefix:token.slice(0,20)}});
          }
          // Revocation/key rotation never silently creates or resurrects a binding.
          if(binding.revokedAt||binding.ownerId!==target.project.ownerId||(binding.expiresAt&&binding.expiresAt<=now())||!currentManagedBinding(binding))return null;
          const snapshot=targetSnapshot(revision);
          if(snapshot.environmentKind==='PRODUCTION'&&!allowProduction)return null;
          const kinds: Array<'NONE'|'MANUAL'>=manualLogin&&env.qaManualLoginEnabled?['NONE','MANUAL']:['NONE'];
          const registration=runnerRegistrationV2Schema.parse({schemaVersion:2,instanceId:`managed-${env.qaManagedHostId}-${hashCanonicalJson({targetId:target.id}).slice(0,32)}`,
            displayName:'Oddpath managed browser',runnerVersion:'managed-routing-v1',executorKeys:['playwright'],protocolVersions:[2],
            profiles:kinds.map(kind=>{
              const manifest={schemaVersion:2,profileKey:`managed-${kind.toLowerCase()}`,label:kind==='NONE'?'Managed browser':'Managed browser · manual login',
                target:snapshot,environmentKind:snapshot.environmentKind,authentication:{kind},
                executionLimits:{preparationTimeoutMs:300_000,executionTimeoutMs:600_000},executorKey:'playwright',
                evidenceKinds:env.privateAssetsEnabled?['TEXT','SCREENSHOT']:['TEXT'],recipeSchemaVersions:[1],valueReferences:[]};
              return {...manifest,manifestHash:hashCanonicalJson(manifest)};
            })});
          const expiresAt=Math.min(proof.validUntil.getTime(),now().getTime()+60_000);
          if(expiresAt<=now().getTime())return null;
          const queued=await tx.qaExecutionJob.count({where:{projectId:target.projectId,status:'QUEUED',deadlineAt:{gt:now()},
            runnerRegistration:{connectionTokenId:binding.id,instanceId:registration.instanceId}}})>0;
          return {projectId:target.projectId,targetId:target.id,connectionId:binding.id,token:managedProjectToken(binding),registration,expiresAt,queued};
        });
        if(entry)entries.push(entry);
      }
      return {schemaVersion:1,entries,next:targets.length>20?targets[19]!.id:null};
    },
    async control(projectId:string,executionId:string,action:'status'|'stop'|'exit',input?:{runtimeId:string;processExited:true;observedAt:string}) {
      const job=await database.qaExecutionJob.findFirst({where:{id:executionId,projectId,protocolVersion:2,
        runnerRegistration:{connectionToken:{managedHostId:env.qaManagedHostId}}},include:{runnerRegistration:{include:{connectionToken:true}}}});
      const connection=job?.runnerRegistration?.connectionToken;
      if(!job||!connection)throw missing();
      // This trusted-host adapter permits only observation/Stop/physical exit,
      // never generation, claim, acceptance, human input or result writes.
      const mustStop=action!=='status'||!!connection.revokedAt||!!(connection.expiresAt&&connection.expiresAt<=now())||!currentManagedBinding(connection);
      const row=mustStop?await runtime.requestStop(connection.id,job.id):await runtime.status(connection.id,job.id);
      const result=action==='exit'?await runtime.exit(connection.id,job.id,input!):row;
      return z.object({state:z.enum(['LIVE','STOP_REQUESTED','STOP_UNCONFIRMED','STOP_CONFIRMED']),runtimeId:z.string()}).parse(result);
    },
  };
}
export const managedProjectsRepository=createManagedProjectsRepository();
