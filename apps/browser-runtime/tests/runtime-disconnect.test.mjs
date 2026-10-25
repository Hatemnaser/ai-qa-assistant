import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {connect} from 'node:net';
import {test} from 'node:test';
for(const mode of ['client-reset','upstream-reset','stop'])test(`runtime upgrade survives and cleans pending handshake: ${mode}`,{timeout:10000},async()=>{
 const child=fork(new URL('./fixtures/runtime-disconnect.mjs',import.meta.url),[mode],{silent:true,execArgv:['--experimental-vm-modules'],windowsHide:true});
 const events=[];let closed=false,stderr='';child.stdout.resume();child.stderr.on('data',b=>stderr+=b);child.on('message',e=>events.push(e));child.on('exit',()=>closed=true);
 const wait=async name=>{const deadline=Date.now()+5000;while(!events.some(e=>e.event===name)&&!closed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(events.some(e=>e.event===name),stderr||`missing ${name}`);return events.find(e=>e.event===name);};
 let socket,clientClosed=false;
 try{const ready=await wait('READY');socket=connect(ready.port,'127.0.0.1');socket.on('error',()=>{});socket.on('close',()=>clientClosed=true);socket.resume();await new Promise(r=>socket.once('connect',r));
 socket.write(`GET /viewer/websockify HTTP/1.1\r\nHost: localhost\r\nAuthorization: Bearer ${ready.token}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
 await wait('UPSTREAM');if(mode==='client-reset')socket.resetAndDestroy();else child.send(mode==='stop'?'STOP_RUNTIME':'RESET_UPSTREAM');
 await new Promise(r=>setTimeout(r,350));assert.equal(closed,false,stderr);
 await wait('UPSTREAM_CLOSED');assert.equal(clientClosed,true,'Pending handshake leaked after disconnect/Stop');
 const health=await (await fetch(`http://127.0.0.1:${ready.port}/health`,{headers:{authorization:`Bearer ${ready.token}`}})).json();
 assert.equal(health.status,mode==='stop'?'STOPPING':'LIVE');
 }finally{socket?.destroy();if(!closed){child.send('STOP');await new Promise(r=>child.once('exit',r));}}
});
