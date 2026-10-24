import assert from 'node:assert/strict';
import {it} from 'node:test';
import express from 'express';
// Separate test process: preserve the immutable production env object.
Object.assign(process.env,{NODE_ENV:'test',REGISTRATION_MODE:'disabled',QA_MANAGED_ROUTING_ENABLED:'true',QA_MANAGED_HOST_ID:'unit-host',
 QA_MANAGED_ROUTING_KEY:'e'.repeat(64),QA_MANAGED_PROJECT_KEY:'d'.repeat(64),QA_BROWSER_VIEWER_SIGNING_KEY:'c'.repeat(64),
 QA_BROWSER_VIEWER_ORIGIN:'https://viewer.example.test',QA_EXECUTION_V2_ENABLED:'true',QA_LEGACY_RUNNER_DISPATCH_ENABLED:'false',QA_BROWSER_RUNTIME_ENABLED:'true'});
const {createProjectConnectionPreBodyRateLimit}=await import('../src/modules/project-connections/project-connections.rateLimit.ts');
it('uses a bounded authenticated host rate budget without raising unauthenticated caller limits',async()=>{
 const app=express();app.use(createProjectConnectionPreBodyRateLimit({ipLimit:1,tokenLimit:1}));app.post('/',(_req,res)=>res.json({ok:true}));
 const server=app.listen(0,'127.0.0.1');await new Promise<void>(r=>server.once('listening',r));
 const url='http://127.0.0.1:'+(server.address() as {port:number}).port;
 try{
  for(let i=0;i<2;i++)assert.equal((await fetch(url,{method:'POST',headers:{'x-oddpath-managed-host':'e'.repeat(64)}})).status,200);
  assert.equal((await fetch(url,{method:'POST',headers:{'x-oddpath-managed-host':'f'.repeat(64)}})).status,200);
  assert.equal((await fetch(url,{method:'POST',headers:{'x-oddpath-managed-host':'f'.repeat(64)}})).status,429);
 }finally{await new Promise<void>(r=>{server.close(()=>r());server.closeAllConnections();});}
});
