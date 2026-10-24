import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {request} from 'node:http';
import {createRequire} from 'node:module';
import {Worker} from 'node:worker_threads';
import {deflateSync} from 'node:zlib';
import {test} from 'node:test';
import {setTimeout as delay} from 'node:timers/promises';
import {targetDefinitionSchema} from '@oddpath/qa-execution-contract';

const require=createRequire(import.meta.url);

test('bounded target origins are rejected before traversing oversized hostile input',()=>{
  let visited=0;
  const origins=new Array(1000);
  for(let i=0;i<origins.length;i++)Object.defineProperty(origins,i,{get(){visited++;return 'http://127.0.0.1/';}});
  const result=targetDefinitionSchema.safeParse({baseUrl:'https://example.com/',environmentKind:'STAGING',resourceOrigins:origins});
  assert.equal(result.success,false);
  assert.equal(visited,0,'Over-limit arrays must not allocate a validation issue for every element');
  assert.equal(result.error?.issues.length,1);
  assert.deepEqual(result.error?.issues[0]?.path,['resourceOrigins']);
});

test('compressed JSON releases its decoder and preserves later raw-body consumers',{timeout:10000},async()=>{
  const child=fork(new URL('./fixtures/dependency-parser-worker.mts',import.meta.url),[],{execArgv:['--import','tsx'],stdio:['ignore','pipe','pipe','ipc']});
  let diagnostic='',closed=false,port=0,lingeringDecoders=-1;
  child.stdout?.on('data',b=>diagnostic+=b);child.stderr?.on('data',b=>diagnostic+=b);
  const exited=new Promise<void>(resolve=>child.once('exit',()=>{closed=true;resolve();}));
  let req:ReturnType<typeof request>|undefined;
  try{
    await Promise.race([new Promise<void>(resolve=>child.on('message',(m:{port?:number})=>{if(m.port){port=m.port;resolve();}})),exited.then(()=>{throw Error('Parser fixture exited: '+diagnostic);})]);
    const frame=Buffer.concat([deflateSync(JSON.stringify({probe:'bounded dependency regression'})),Buffer.from([0])]);
    const tail=Buffer.alloc(1024,88);
    const response=new Promise<{status:number|undefined;body:string}>((resolve,reject)=>{
      req=request({hostname:'127.0.0.1',port,method:'POST',path:'/parser',agent:false,headers:{'content-type':'application/json','content-encoding':'deflate','content-length':frame.length+tail.length}},res=>{let body='';res.on('data',b=>body+=b);res.once('end',()=>resolve({status:res.statusCode,body}));});
      req.once('error',reject);req.setTimeout(4000,()=>req?.destroy(Error('Parser completion timed out')));
      child.on('message',(m:{parsed?:boolean;lingeringDecoders?:number})=>{if(m.parsed){lingeringDecoders=m.lingeringDecoders??-1;req?.end(tail);}});
      req.write(frame);
    });
    const observed=await Promise.race([response,exited.then(()=>{throw Error('Compressed request killed parser process: '+diagnostic);})]);
    assert.equal(observed.status,200);assert.deepEqual(JSON.parse(observed.body),{probe:'bounded dependency regression'});
    assert.equal(lingeringDecoders,0,'A completed decompressor must not keep receiving the remaining raw request bytes');
    await delay(100);assert.equal(closed,false,diagnostic);
    const health=await fetch(`http://127.0.0.1:${port}/health`);assert.equal(health.status,200);
  }finally{req?.destroy();if(!closed){child.send('stop');await Promise.race([exited,delay(1000)]);if(!closed)child.kill('SIGKILL');}await exited;}
});

test('Nodemailer preserves the intended recipient outside nested RFC comments',()=>{
  const parse=require('nodemailer/lib/addressparser') as (s:string)=>Array<{address:string}>;
  assert.deepEqual(parse('Victim (x(y) <evil@evil.example>) <v@victim.example>').map(a=>a.address),['v@victim.example']);
});

test('URI parsing does not turn percent-encoded schemes into trusted schemes',()=>{
  const uri=require('fast-uri') as {parse:(s:string)=>{scheme?:string};equal:(a:string,b:string)=>boolean};
  assert.notEqual(uri.parse('%6Aavascript:alert(1)').scheme,'javascript');
  assert.notEqual(uri.parse('%u006Aavascript:alert(1)').scheme,'javascript');
  assert.equal(uri.equal('%68ttp://a.example/','http://a.example/'),false);
});

test('oversized IPv6 zone input rejects within a bounded isolated worker',{timeout:10000},async()=>{
  const worker=new Worker(`const {parentPort,workerData}=require('node:worker_threads');const {Address6}=require(workerData.module);parentPort.postMessage({ready:true});let rejected=false;try{new Address6('%'.repeat(300000)+'\\n');}catch{rejected=true;}parentPort.postMessage({rejected});`,{eval:true,execArgv:[],workerData:{module:require.resolve('ip-address')},resourceLimits:{maxOldGenerationSizeMb:32}});
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const result=await new Promise<boolean>((resolve,reject)=>{worker.on('error',reject);worker.on('message',(m:{ready?:boolean;rejected?:boolean})=>{if(m.ready)timer=setTimeout(()=>reject(Error('IPv6 parser exceeded bounded work after worker startup')),1000);if(m.rejected!==undefined)resolve(m.rejected);});});assert.equal(result,true);}finally{clearTimeout(timer);await worker.terminate();}
});
