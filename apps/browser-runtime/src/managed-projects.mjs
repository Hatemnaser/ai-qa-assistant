import {managedProjectCatalogSchema} from '@oddpath/qa-execution-contract';
import {OddpathClient,hashCanonicalJson} from '@oddpath/runner';
import {renewProjectRegistration,withProjectRegistration} from './project-registration.mjs';

export async function managedHostRequest(config,path,body,fetcher=fetch){
  const response=await fetcher(config.discovery.serverUrl+'/api/internal/managed-browser/'+path,{
    method:'POST',redirect:'error',credentials:'omit',signal:AbortSignal.timeout(3000),
    headers:{authorization:'Bearer '+config.routingKey,'content-type':'application/json'},body:JSON.stringify(body),
  });
  if(!response.ok){let code;try{code=(await response.json()).code;}catch{}
    throw Object.assign(new Error('Managed host request failed.'),{status:response.status,code});}
  const text=await response.text();if(text.length>1_000_000)throw new Error('Managed response exceeds its limit.');
  return JSON.parse(text);
}
export function managedRuntimeClient(config,projectId,fetcher=fetch){
  return {runtime:async(executionId,action,exit)=>{
    if(!['status','stop','exit'].includes(action))throw new Error('Unsupported host control action.');
    return managedHostRequest(config,'control',{projectId,executionId,action,...(action==='exit'?{exit}:{})},fetcher);
  }};
}
export function managedProjectFetch(config,fetcher=fetch){
  return (input,init={})=>{
    const target=new URL(input),headers=new Headers(init.headers);
    if(target.origin===config.discovery.serverUrl&&target.pathname.startsWith('/api/integrations/v1/runner/v2/'))
      headers.set('x-oddpath-managed-host',config.routingKey);
    return fetcher(input,{...init,headers,redirect:'error',credentials:'omit'});
  };
}

/** One host; bounded catalog admission, stable project objects/registration queues. */
export class ManagedProjectCatalog {
  constructor(config,{fetcher=fetch,now=Date.now,createClient=options=>new OddpathClient(options)}={}){
    this.config=config;this.fetcher=fetcher;this.now=now;this.createClient=createClient;this.current=new Map();this.valid=false;
  }
  projects(){return this.valid?[...this.current.values()].filter(p=>p.catalogExpiresAt>this.now()):[];}
  async refresh(){
    if(this.closed)throw new Error('Managed discovery is closed.');
    if(this.pending)return this.pending;
    this.pending=this.load().catch(error=>{this.valid=false;throw error;}).finally(()=>{this.pending=null;});
    return this.pending;
  }
  async load(){
    const entries=[],seen=new Set();let after;
    for(let page=0;;page++){
      if(this.closed)throw new Error('Managed discovery is closed.');
      const batch=managedProjectCatalogSchema.parse(await managedHostRequest(this.config,'catalog',{
        ...(after?{after}:{}),manualLogin:this.config.allowManualLogin===true,allowProduction:this.config.allowProduction===true,
      },this.fetcher));
      for(const entry of batch.entries){
        if(seen.has(entry.registration.instanceId)||entry.registration.profiles.some(p=>p.target.targetId!==entry.targetId)
          ||entry.expiresAt<=this.now()||entry.expiresAt>this.now()+65_000)throw new Error('Invalid managed catalog binding.');
        for(const profile of entry.registration.profiles){
          const {manifestHash,...manifest}=profile;
          if(manifestHash!==hashCanonicalJson(manifest)||profile.valueReferences.length
            ||(profile.authentication.kind==='MANUAL'&&this.config.allowManualLogin!==true)
            ||(profile.authentication.kind==='SAVED_STATE'&&!this.config.transferKeys)
            ||(profile.environmentKind==='PRODUCTION'&&this.config.allowProduction!==true))throw new Error('Invalid managed catalog capabilities or profile hash.');
        }
        seen.add(entry.registration.instanceId);entries.push(entry);
      }
      if(!batch.next)break;
      if(after&&batch.next<=after)throw new Error('Managed catalog cursor did not progress.');
      after=batch.next;
      if(page===49){
        console.error('Managed host catalog capacity reached; later targets await capacity.');
        break;
      }
    }
    const next=new Map();
    for(const entry of entries){
      if(this.closed)throw new Error('Managed discovery is closed.');
      const key=entry.registration.instanceId;
      let project=this.current.get(key);
      if(project&&(project.projectId!==entry.projectId||project.connectionId!==entry.connectionId||project.token!==entry.token))
        throw new Error('Managed binding identity changed without a new connection.');
      if(!project){
        const client=this.createClient({serverUrl:this.config.discovery.serverUrl,token:entry.token,protocolVersion:2,requestTimeoutMs:3000,fetch:managedProjectFetch(this.config,this.fetcher)});
        const control=managedRuntimeClient(this.config,entry.projectId,this.fetcher),runtime=client.runtime.bind(client);
        // Login state/epochs/consent require the project's operational authority.
        // Only physical cleanup survives project credential revocation.
        client.runtime=(executionId,action,...args)=>['stop','exit'].includes(action)
          ?control.runtime(executionId,action,...args):runtime(executionId,action,...args);
        project={...entry,managedRegistration:true,serverUrl:this.config.discovery.serverUrl,client,baseRegistration:entry.registration};
        project.isManagedActive=()=>this.projects().includes(project)&&project.hasQueuedWork;
      }
      await withProjectRegistration(project,async()=>{
        project.baseRegistration=structuredClone(entry.registration);
        // renewProjectRegistration serializes acknowledgement with claim and
        // retains ambiguous old publications before replacing the manifest.
      });
      await renewProjectRegistration(project,Boolean(this.config.transferKeys));
      project.catalogExpiresAt=entry.expiresAt;project.hasQueuedWork=entry.queued;next.set(key,project);
    }
    if(this.closed)throw new Error('Managed discovery is closed.');
    this.current=next;this.valid=true;return this.projects();
  }
  start(){this.timer=setInterval(()=>{void this.refresh().catch(()=>console.error('Managed project discovery failed.'));},10_000);}
  async close(){clearInterval(this.timer);this.closed=true;this.valid=false;await this.pending?.catch(()=>{});}
}
