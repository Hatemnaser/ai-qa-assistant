import {createServer} from 'node:http';
import {createViewerGateway} from '../../src/viewer-gateway.mjs';
import {signGrant} from '../../src/viewer-grants.mjs';
const runtime='11111111-1111-4111-8111-111111111111',key='a'.repeat(64),origin='https://viewer.example.test';
const row={state:'LIVE',runtime,project:'project',binding:'b'.repeat(64),lease:Date.now()+30000,deadline:Date.now()+30000,token:'c'.repeat(64),loginPhase:'NONE'};
const grant={schemaVersion:1,ownerId:'owner',executionId:'execution',runtimeId:runtime,projectId:'project',bindingHash:row.binding,mode:'VIEW',nonce:'22222222-2222-4222-8222-222222222222',expiresAt:Date.now()+20000};
const peers=new Set();
const upstream=createServer();upstream.on('upgrade',(_req,socket)=>{
 peers.add(socket);socket.on('error',()=>{});socket.resume();socket.on('end',()=>socket.destroy());
 socket.on('close',()=>{peers.delete(socket);process.send({event:'UPSTREAM_CLOSED'});});
 process.send({event:'UPSTREAM'});
});
await new Promise(r=>upstream.listen(0,'127.0.0.1',r));
const gateway=createViewerGateway({journal:{get:()=>row},driver:{async endpoint(){if(process.argv[2]==='lookup'){process.send({event:'LOOKUP'});await new Promise(r=>setTimeout(r,400));}return `http://127.0.0.1:${upstream.address().port}`;}},signingKey:key,publicOrigin:origin});
await new Promise(r=>gateway.listen(0,'127.0.0.1',r));
process.send({event:'READY',port:gateway.address().port,runtime,origin,cookie:signGrant(grant,key)});
process.on('message',m=>{if(m==='STOP'){gateway.closeViewerStreams();gateway.closeAllConnections();gateway.close();for(const peer of peers)peer.destroy();upstream.closeAllConnections();upstream.close();setTimeout(()=>process.exit(0),100);}});
