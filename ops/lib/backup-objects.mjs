import {S3Client,GetObjectCommand} from '@aws-sdk/client-s3';
import {requireCondition} from './private-files.mjs';

export function backupObjectSource(env){
 const keys=['R2_ENDPOINT','R2_BUCKET_NAME','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY'];
 requireCondition(keys.every(k=>typeof env[k]==='string'&&env[k].length>0),'BACKUP_OBJECT_CONFIGURATION_REQUIRED');
 const url=new URL(env.R2_ENDPOINT);
 const local=env.NODE_ENV==='test'&&env.ODDPATH_FULL_LOCAL_TESTS==='1'&&url.protocol==='http:'&&['127.0.0.1','localhost','object-store'].includes(url.hostname);
 requireCondition(local||/^https:\/\/[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com$/.test(env.R2_ENDPOINT),'BACKUP_OBJECT_ENDPOINT_INVALID');
 const client=new S3Client({endpoint:env.R2_ENDPOINT,region:env.R2_REGION||'auto',forcePathStyle:true,maxAttempts:1,
  credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY},requestChecksumCalculation:'WHEN_REQUIRED',responseChecksumValidation:'WHEN_REQUIRED'});
 return {async read(key,signal){
  const response=await client.send(new GetObjectCommand({Bucket:env.R2_BUCKET_NAME,Key:key}),{abortSignal:AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])])});
  requireCondition(response.Body&&Number.isSafeInteger(response.ContentLength)&&response.ContentLength>=0&&response.ContentLength<=5*1024**3,'BACKUP_OBJECT_SIZE_INVALID');
  return {stream:response.Body,size:response.ContentLength};
 },close(){client.destroy();}};
}
