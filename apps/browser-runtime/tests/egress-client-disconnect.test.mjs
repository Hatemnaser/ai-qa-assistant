import assert from 'node:assert/strict';
import {it} from 'node:test';
import {fork} from 'node:child_process';
import {connect} from 'node:net';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
async function fixture(mode,body){
 const child=fork(new URL('./fixtures/egress-reset.mjs',import.meta.url),[mode],{stdio:['ignore','ignore','pipe','ipc'],windowsHide:true});
 const messages=[];let stderr='',closed=false;
 child.on('message',m=>messages.push(m));child.stderr.on('data',b=>stderr+=b);child.once('close',()=>closed=true);
 const wait=async(event)=>{for(let n=0;n<200;n++){const index=messages.findIndex(m=>m.event===event);if(index>=0)return messages.splice(index,1)[0];assert.equal(closed,false,'Egress process crashed:\n'+stderr);await delay(10);}throw Error('Timed out waiting for '+event);};
 let client;
 try{
  const ready=await wait('READY');client=connect({host:'127.0.0.1',port:ready.port});client.on('error',()=>{});await once(client,'connect');
  await body({child,client,wait,messages,stderr:()=>stderr});
 }finally{
  client?.destroy();if(!closed){child.kill();await once(child,'close');}
 }
}
for(const mode of ['pending-resolve','pending-reject'])it('survives client TCP reset during '+mode+' without starting an upstream tunnel',{timeout:7000},async()=>{
 await fixture(mode,async({child,client,wait,messages,stderr})=>{
  client.write('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n');
  await wait('DNS_PENDING');client.resetAndDestroy();
  await wait('CLIENT_CLOSED');child.send('RELEASE_DNS');child.send('PING');
  const alive=await wait('PONG');assert.equal(alive.upstreamConnections,0);assert.ok(!messages.some(m=>m.event==='UPSTREAM_ATTEMPT'));
  assert.ok(!stderr().includes("Unhandled 'error'"));
 });
});
it('denies an unapproved CONNECT without upstream work and survives its closed socket',{timeout:7000},async()=>{
 await fixture('ordinary',async({child,client,wait,messages})=>{
  const data=[];client.on('data',b=>data.push(b));client.write('CONNECT forbidden.test:443 HTTP/1.1\r\nHost: forbidden.test:443\r\n\r\n');
  await wait('CLIENT_CLOSED');assert.match(Buffer.concat(data).toString(),/^HTTP\/1\.1 403 /);
  child.send('PING');assert.equal((await wait('PONG')).upstreamConnections,0);assert.ok(!messages.some(m=>m.event==='UPSTREAM_ATTEMPT'));
 });
});
it('keeps successful tunnelling and closes its upstream when the client resets',{timeout:7000},async()=>{
 await fixture('ordinary',async({child,client,wait})=>{
  let received='';client.on('data',b=>received+=b.toString());client.write('CONNECT example.test:443 HTTP/1.1\r\nHost: example.test:443\r\n\r\n');
  assert.equal((await wait('UPSTREAM_ATTEMPT')).validatedAddress,'93.184.216.34');
  for(let n=0;!received.includes('\r\n\r\n');n++){assert.ok(n<200);await delay(10);}
  assert.match(received,/^HTTP\/1\.1 200 Connection Established/);client.write('fixture tunnel data');
  for(let n=0;!received.includes('fixture tunnel data');n++){assert.ok(n<200);await delay(10);}
  client.resetAndDestroy();await wait('CLIENT_CLOSED');child.send('PING');const alive=await wait('PONG');assert.equal(alive.upstreamConnections,1);assert.equal(alive.upstreamClosed,1);
 });
});
