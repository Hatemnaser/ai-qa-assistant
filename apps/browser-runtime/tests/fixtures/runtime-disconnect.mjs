import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { EventEmitter } from 'node:events';
import { timingSafeEqual } from 'node:crypto';
import { createServer, request } from 'node:http';
import vm from 'node:vm';

// Evaluate the complete production module. Only OS/browser startup is inert;
// HTTP, TCP, upgrade sockets and reset events use the real Node transports.
const token='e'.repeat(64), signals={}, mode=process.argv[2];
const upstream=createServer();let remote;
upstream.on('upgrade',(_req,socket)=>{
  remote=socket;socket.on('error',()=>{});socket.on('close',()=>process.send({event:'UPSTREAM_CLOSED'}));
  socket.resume();socket.on('end',()=>socket.destroy());
  process.send({event:'UPSTREAM'});
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
let server;
const context=vm.createContext({Buffer,Date,setTimeout:()=>({unref(){}}),setInterval:()=>0,
 process:{env:{ODDPATH_RUNTIME_TOKEN:token,ODDPATH_DEADLINE_MS:String(Date.now()+60000),ODDPATH_LEASE_MS:String(Date.now()+45000)},getuid:()=>10001,on:(name,fn)=>signals[name]=fn,kill(){},exit(){}}});
const adapters={
 'node:child_process':{spawn:()=>Object.assign(new EventEmitter(),{pid:999})},
 'node:http':{createServer:handler=>{server=createServer(handler);server.listen=(_port,_host)=>{};return server;},request:options=>request({...options,port:upstream.address().port})},
 'node:crypto':{timingSafeEqual},
 'node:fs/promises':{async mkdir(){},async stat(){return {isSocket:()=>true};}}
};
const source=await readFile(process.env.ODDPATH_TEST_RUNTIME_SOURCE||new URL('../../src/runtime-main.mjs',import.meta.url),'utf8');
const runtime=new vm.SourceTextModule(source,{context});
await runtime.link(async name=>{
 if(['./login-boundary.mjs','./preparation-failure.mjs'].includes(name))return new vm.SourceTextModule(await readFile(new URL('../../src/'+name.slice(2),import.meta.url),'utf8'),{context});
 if(name==='./login-policy.mjs')return new vm.SyntheticModule(['LoginPolicy'],function(){this.setExport('LoginPolicy',class{constructor(){throw Error('Unexpected manual login');}});},{context});
 const values=adapters[name];assert.ok(values,name);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});
});
await runtime.evaluate();
await new Promise(r=>Object.getPrototypeOf(server).listen.call(server,0,'127.0.0.1',r));
process.send({event:'READY',port:server.address().port,token});
process.on('message',message=>{
 if(message==='STOP_RUNTIME')signals.SIGTERM();
 if(message==='RESET_UPSTREAM')remote.resetAndDestroy();
 if(message==='STOP'){remote?.destroy();server.closeAllConnections();server.close();upstream.closeAllConnections();upstream.close();setTimeout(()=>process.exit(0),100);}
});
