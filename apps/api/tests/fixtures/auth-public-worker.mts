import {assertPostgresIntegrationTarget} from '../helpers/postgresIntegrationTarget.ts';
assertPostgresIntegrationTarget(process.env);
const {prisma}=await import('../../src/db/prisma.ts');
const {createApp}=await import('../../src/app.ts');
const server=createApp({trustProxyHops:1}).listen(0,'127.0.0.1');
await new Promise<void>(r=>server.once('listening',r));
process.send?.({port:(server.address() as {port:number}).port});
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});await prisma.$disconnect();if(process.connected)process.disconnect();}
process.on('message',message=>{if(message==='stop')void stop();});
process.on('SIGTERM',()=>void stop());
process.on('disconnect',()=>void stop());
