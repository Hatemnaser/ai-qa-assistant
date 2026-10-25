// Real HTTP/TCP sockets around the actual egress entry point. Only listen/DNS
// and the final upstream destination are adapted to isolated loopback fixtures.
import http from 'node:http';
import dns from 'node:dns';
import net from 'node:net';
import {syncBuiltinESMExports} from 'node:module';
const mode=process.argv[2],send=value=>process.send?.(value);
let release,server,upstreamConnections=0,upstreamClosed=0;
const upstream=net.createServer(socket=>{upstreamConnections++;socket.pipe(socket);socket.once('close',()=>{upstreamClosed++;});});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const originalCreate=http.createServer.bind(http),originalConnect=net.connect.bind(net);
http.createServer=(...args)=>{
 server=originalCreate(...args);
 // Observe close without installing an error handler that could hide the bug.
 server.on('connect',(_req,client)=>client.once('close',()=>send({event:'CLIENT_CLOSED'})));
 const listen=server.listen.bind(server);
 server.listen=()=>listen(0,'127.0.0.1',()=>send({event:'READY',port:server.address().port}));
 return server;
};
dns.promises.lookup=async()=>{
 if(mode.startsWith('pending')){
  send({event:'DNS_PENDING'});await new Promise((resolve,reject)=>{release=()=>mode==='pending-reject'?reject(Object.assign(Error('fixture DNS rejected'),{code:'EAI_AGAIN'})):resolve();});
 }
 return [{address:'93.184.216.34',family:4}];
};
net.connect=(options,...rest)=>{
 send({event:'UPSTREAM_ATTEMPT',validatedAddress:options.host});
 return originalConnect({...options,host:'127.0.0.1',port:upstream.address().port},...rest);
};
syncBuiltinESMExports();
process.on('message',message=>{
 if(message==='RELEASE_DNS')release?.();
 if(message==='PING')setTimeout(()=>send({event:'PONG',upstreamConnections,upstreamClosed}),30);
});
process.env.ODDPATH_ALLOWED_ORIGINS=JSON.stringify(['https://example.test']);
process.env.ODDPATH_DEADLINE_MS=String(Date.now()+60000);
await import('../../src/egress-main.mjs');
