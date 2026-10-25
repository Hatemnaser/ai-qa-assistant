import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {connect} from 'node:net';
import {test} from 'node:test';
for(const mode of ['lookup','upstream'])test(`gateway survives client TCP RST during ${mode}`,{timeout:10000},async()=>{
 const child=fork(new URL('./fixtures/viewer-reset.mjs',import.meta.url),[mode],{silent:true,execArgv:[],windowsHide:true});
 let stderr='',closed=false,code;child.stderr.on('data',b=>stderr+=b);child.stdout.resume();const events=[];
 child.on('message',m=>events.push(m));child.on('exit',c=>{closed=true;code=c;});
 const wait=async name=>{const deadline=Date.now()+5000;while(!events.some(e=>e.event===name)&&!closed&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));assert.ok(events.some(e=>e.event===name),stderr||`missing ${name}`);return events.find(e=>e.event===name);};
 let socket;
 try{const ready=await wait('READY');socket=connect(ready.port,'127.0.0.1');socket.on('error',()=>{});await new Promise(r=>socket.once('connect',r));
 socket.write(`GET /r/${ready.runtime}/viewer/websockify HTTP/1.1\r\nHost: localhost\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nOrigin: ${ready.origin}\r\nCookie: oddpath_view=${ready.cookie}\r\n\r\n`);
 await wait(mode==='lookup'?'LOOKUP':'UPSTREAM');socket.resetAndDestroy();await new Promise(r=>setTimeout(r,650));
 assert.equal(closed,false,`gateway process crashed code=${code}: ${stderr}`);
 if(mode==='lookup')assert.equal(events.some(e=>e.event==='UPSTREAM'),false,'Cancelled lookup must not open an upstream connection');
 else await wait('UPSTREAM_CLOSED');
 const response=await fetch(`http://127.0.0.1:${ready.port}/open`);assert.equal(response.status,200);
 }finally{socket?.destroy();if(!closed){child.send('STOP');await new Promise(r=>child.once('exit',r));}}
});
