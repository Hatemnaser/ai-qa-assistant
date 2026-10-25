import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdir,open} from 'node:fs/promises';
import {dirname,join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {requireCondition,syncDirectory} from './private-files.mjs';

const MAGIC=Buffer.from('ODDPATH_COMPONENTS_V1\n');
const MAX_CHUNK=65536,MAX_COMPONENTS=10016,MAX_BYTES=5*1024**3;
const validName=n=>typeof n==='string'&&/^(?:postgres\.dump|runtime\.sqlite|revocations\.sqlite|manifest\.json|objects\/[0-9]{8}\.bin|keys\/[a-z0-9-]{1,60}\.json)$/.test(n);
const componentLimit=name=>name==='manifest.json'?32*1024**2:name.startsWith('keys/')?32768:MAX_BYTES;

/** Fixed names and bounded length frames: never extract an untrusted tar path. */
export function encodeComponents(entries,onComplete=()=>{}){
 return Readable.from((async function*(){
  yield MAGIC;const names=new Set();let total=0;
  for await(const entry of entries){
   requireCondition(validName(entry.name)&&!names.has(entry.name)&&names.size<MAX_COMPONENTS,'BACKUP_COMPONENT_NAME_INVALID');names.add(entry.name);
   yield Buffer.from(JSON.stringify({name:entry.name})+'\n');
   const hash=createHash('sha256');let bytes=0;
   for await(const source of entry.stream){
    const chunk=Buffer.isBuffer(source)?source:Buffer.from(source);bytes+=chunk.length;total+=chunk.length;
    requireCondition(Number.isSafeInteger(bytes)&&bytes<=componentLimit(entry.name)&&total<=MAX_BYTES,'BACKUP_COMPONENT_SIZE_INVALID');hash.update(chunk);
    for(let at=0;at<chunk.length;at+=MAX_CHUNK){const part=chunk.subarray(at,at+MAX_CHUNK),length=Buffer.alloc(4);length.writeUInt32BE(part.length);yield length;yield part;}
   }
   const descriptor={bytes,sha256:hash.digest('hex')};yield Buffer.alloc(4);yield Buffer.from(JSON.stringify(descriptor)+'\n');
   await onComplete({name:entry.name,...descriptor});
  }
  yield Buffer.from('{"end":true}\n');
 })());
}

export async function decodeComponents(path,directory,{signal}={}){
 const input=createReadStream(path),iterator=input[Symbol.asyncIterator]();let pending=Buffer.alloc(0),ended=false,total=0;
 async function bytes(n){
  signal?.throwIfAborted();
  while(pending.length<n&&!ended){const next=await iterator.next();ended=next.done;if(!ended)pending=Buffer.concat([pending,next.value]);}
  requireCondition(pending.length>=n,'BACKUP_COMPONENT_TRUNCATED');const value=pending.subarray(0,n);pending=pending.subarray(n);return value;
 }
 async function line(){
  while(!pending.includes(10)&&!ended){requireCondition(pending.length<4096,'BACKUP_COMPONENT_HEADER_INVALID');const next=await iterator.next();ended=next.done;if(!ended)pending=Buffer.concat([pending,next.value]);}
  const end=pending.indexOf(10);requireCondition(end>=0&&end<4096,'BACKUP_COMPONENT_HEADER_INVALID');const value=pending.subarray(0,end);pending=pending.subarray(end+1);
  try{return JSON.parse(value.toString());}catch{throw new Error('BACKUP_COMPONENT_HEADER_INVALID');}
 }
 const entries=[];
 try{
  requireCondition((await bytes(MAGIC.length)).equals(MAGIC),'BACKUP_COMPONENT_FORMAT_INVALID');
  const names=new Set();
  while(true){
   signal?.throwIfAborted();const header=await line();
   if(header.end===true){requireCondition(Object.keys(header).length===1,'BACKUP_COMPONENT_HEADER_INVALID');break;}
   requireCondition(Object.keys(header).length===1&&validName(header.name)&&!names.has(header.name)&&names.size<MAX_COMPONENTS,'BACKUP_COMPONENT_NAME_INVALID');names.add(header.name);
   const destination=join(directory,header.name);await mkdir(dirname(destination),{recursive:true,mode:0o700});
   const hash=createHash('sha256');let size=0;
   await pipeline(Readable.from((async function*(){
    while(true){const length=(await bytes(4)).readUInt32BE();if(length===0)break;
     requireCondition(length<=MAX_CHUNK,'BACKUP_COMPONENT_SIZE_INVALID');const chunk=await bytes(length);size+=length;total+=length;
     requireCondition(size<=componentLimit(header.name)&&total<=MAX_BYTES,'BACKUP_COMPONENT_SIZE_INVALID');hash.update(chunk);yield chunk;
    }
   })()),createWriteStream(destination,{flags:'wx',mode:0o600}),{signal});
   const footer=await line(),sha256=hash.digest('hex');
   requireCondition(Object.keys(footer).length===2&&footer.bytes===size&&footer.sha256===sha256,'BACKUP_COMPONENT_HASH_MISMATCH');
   const file=await open(destination,'r+');try{await file.sync();}finally{await file.close();}
   entries.push({name:header.name,bytes:size,sha256});
  }
  const next=await iterator.next();requireCondition(pending.length===0&&next.done,'BACKUP_COMPONENT_TRAILING_DATA');
  await syncDirectory(directory);return entries;
 }finally{input.destroy();}
}
