// Synthetic, private-network-only integration services. Never deployment code.
import {createServer as tcpServer} from 'node:net';
import {createServer as httpServer} from 'node:http';
import {TLSSocket,createSecureContext} from 'node:tls';
import {readFileSync} from 'node:fs';
const secureContext=createSecureContext({key:readFileSync('/fixture/tls.key'),cert:readFileSync('/fixture/tls.crt')});
const sockets=new Set(),state={smtp:'accept',api:'ready',messages:[],tls:0,authenticated:0};
const server=tcpServer(raw=>{
 sockets.add(raw);raw.on('close',()=>sockets.delete(raw));raw.on('error',()=>{});raw.write('220 fixture ESMTP\r\n');
 let buffer='',data=false,lines=[],authenticated=false;
 const attach=(socket,secured)=>{
  socket.setEncoding('utf8');socket.on('error',()=>{});
  const onData=chunk=>{buffer+=chunk;let index;while((index=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,index);buffer=buffer.slice(index+2);
   if(data){if(line!=='.'){lines.push(line);continue;}data=false;
    const text=lines.join('\n');lines=[];
    state.messages.push({subject:text.match(/^Subject: (.*)$/mi)?.[1],id:text.match(/^Message-ID: (.*)$/mi)?.[1],text,outcome:state.smtp,secured,authenticated});
    if(state.smtp==='reject')socket.write('451 temporary synthetic error\r\n');else if(state.smtp==='drop')socket.destroy();else if(state.smtp!=='hang')socket.write('250 queued\r\n');
   }else if(/^EHLO|^HELO/i.test(line))socket.write(secured?(['anonymous','hidden-auth'].includes(state.smtp)?'250 fixture\r\n':'250-fixture\r\n250 AUTH PLAIN\r\n'):state.smtp==='no-tls'?'250-fixture\r\n250 AUTH PLAIN\r\n':'250-fixture\r\n250 STARTTLS\r\n');
   else if(line==='STARTTLS'&&!secured&&state.smtp==='no-tls')socket.write('454 TLS unavailable\r\n');
   else if(line==='STARTTLS'&&!secured){socket.write('220 TLS ready\r\n');socket.removeListener('data',onData);const upgraded=new TLSSocket(socket,{isServer:true,secureContext});upgraded.once('secure',()=>state.tls++);attach(upgraded,true);return;}
   else if(/^AUTH /i.test(line)&&state.smtp==='anonymous')socket.write('502 authentication unsupported\r\n');
   else if(/^AUTH PLAIN /i.test(line)&&(secured||state.smtp==='no-tls')){const parts=Buffer.from(line.slice(11),'base64').toString().split('\0');authenticated=parts.at(-2)==='synthetic'&&parts.at(-1)===process.env.FIXTURE_PASSWORD;if(authenticated)state.authenticated++;socket.write(authenticated?'235 authenticated\r\n':'535 bad authentication\r\n');}
   else if(/^MAIL FROM|^RCPT TO/i.test(line))socket.write(authenticated||(secured&&state.smtp==='anonymous')?'250 OK\r\n':'530 authentication required\r\n');
   else if(line==='DATA'&&(authenticated||(secured&&state.smtp==='anonymous'))){data=true;socket.write('354 end with dot\r\n');}
   else if(line==='QUIT')socket.end('221 Bye\r\n');else socket.write('250 OK\r\n');
  }};socket.on('data',onData);
 };attach(raw,false);
});server.listen(2525,'0.0.0.0');
httpServer(async(req,res)=>{
 if(req.method==='POST'&&req.url==='/mode'){let body='';for await(const chunk of req)body+=chunk;const mode=JSON.parse(body);if(mode.smtp)state.smtp=mode.smtp;if(mode.api)state.api=mode.api;res.end('ok');return;}
 if(req.url==='/state'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(state));return;}
 if(req.url==='/api/health/ready'){
  if(state.api==='hang')return;
  res.writeHead(state.api==='down'?503:state.api==='redirect'?302:200,{'Content-Type':'application/json',Location:'/api/health/ready'});
  res.end(JSON.stringify({service:'oddpath-api',status:state.api==='ready'?'ready':'not_ready',checks:{database:state.api==='ready'?'ok':'unavailable'}}));return;
 }
 res.writeHead(404);res.end();
}).listen(8080,'0.0.0.0');
