import {assertPostgresIntegrationTarget} from '../helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../../src/db/prisma.ts');
const {createPrismaRetentionRepository}=await import('../../src/modules/retention/retention.repository.ts');
const {createRetentionService,getConfiguredRetentionPolicy}=await import('../../src/modules/retention/retention.service.ts');
const {createPrismaUsageRepository}=await import('../../src/modules/usage/usage.repository.ts');
const {createUsageService}=await import('../../src/modules/usage/usage.service.ts');
let providerCalls=0;globalThis.fetch=async()=>{providerCalls++;throw new Error('Retention/recovery must never invoke a provider');};
try{
 const input=JSON.parse(process.argv[2]),time=new Date(input.time);
 await createRetentionService(createPrismaRetentionRepository(prisma)).purge(time,getConfiguredRetentionPolicy());
 const usage=createUsageService({repository:createPrismaUsageRepository(prisma,()=>time),now:()=>time});
 let rejection:string|null=null,newReservation:string|undefined;
 try{newReservation=(await usage.reserveAiOperation({action:'conversation_summary',userId:input.owner,credits:1})).eventId;}
 catch(error){rejection=(error as {code?:string}).code??'UNEXPECTED';}
 process.send?.({eventExists:Boolean(await prisma.usageEvent.findUnique({where:{id:input.eventId}})),rejection,newReservation,providerCalls});
}finally{await prisma.$disconnect();process.disconnect?.();}
