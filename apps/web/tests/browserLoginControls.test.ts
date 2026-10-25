import assert from 'node:assert/strict';
import { it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ModuleKind, transpileModule } from 'typescript';
import { compileScript, parse } from 'vue/compiler-sfc';
import * as vue from 'vue';

const file=new URL('../src/features/sessions/BrowserLoginControls.vue',import.meta.url);
const source=await readFile(file,'utf8');
const js=transpileModule(compileScript(parse(source,{filename:fileURLToPath(file)}).descriptor,{id:'login-controls-test'}).content,{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(r=>resolve=r);return {promise,resolve};}
async function settle(){await vue.nextTick();await new Promise(r=>setImmediate(r));}
function mount(request:(...args:unknown[])=>Promise<unknown>){
  let dispose=()=>{};const module={exports:{} as {default:{setup:(props:unknown,context:unknown)=>Record<string,unknown>}}};
  new Function('require','module','exports',js)((id:string)=>{
    if(id==='vue')return {...vue,onBeforeUnmount:(fn:()=>void)=>{dispose=fn;}};
    if(id.includes('useI18n'))return {useI18n:()=>({t:(key:string)=>key})};
    if(id.includes('browserLoginApi'))return {browserLoginRequest:request};
    throw new Error('Unexpected test dependency: '+id);
  },module,module.exports);
  const props=vue.reactive({projectId:'p1',executionId:'e1',scopeKey:'owner1:p1:e1',active:true}),scope=vue.effectScope();
  const api=scope.run(()=>module.exports.default.setup(props,{expose(){},emit(){}})) as {status:vue.Ref<{executionId:string;savedLogin?:{consent:boolean}}|null>;link:vue.Ref<string|null>;pendingConsent:vue.Ref<boolean|null>;privacyKey:vue.ComputedRef<string>;act:(action:string)=>Promise<void>;consent:(event:Event)=>Promise<void>;retryConsent:()=>Promise<void>;refresh:()=>Promise<void>};
  return {props,api,close(){dispose();scope.stop();}};
}
const login=(id:string)=>({runtimeId:'runtime',executionId:id,state:'LIVE',login:{phase:'LOGIN',controlEpoch:'epoch',expiresAt:'2030-01-01'}});
it('does not restore an old execution status after navigating to another execution',async()=>{
  const old=deferred(),next=deferred();let calls=0;
  const view=mount(async()=>++calls===1?old.promise:next.promise);
  try{view.props.executionId='e2';await settle();old.resolve(login('e1'));await settle();assert.equal(view.api.status.value,null);
    next.resolve(login('e2'));await settle();assert.equal((view.api.status.value as {executionId:string}|null)?.executionId,'e2');
  }finally{view.close();}
});
for(const applied of [false,true])it(`blocks completion after a failed withdrawal (server applied: ${applied}) until acknowledged retry`,async()=>{
  let confirmed=true,fail=true,completions=0;
  const value=()=>({...login('e1'),savedLogin:{enabled:true,consent:confirmed,savedLoginId:null}});
  const view=mount(async(...args)=>{
    if(args[2]==='/login/save-consent'){
      if(!fail||applied)confirmed=(args[3] as {saveLogin:boolean}).saveLogin;
      if(fail)throw new Error('Response lost');
    }
    if(args[2]==='/login/complete')completions++;
    return value();
  });
  try{
    await settle();const checkbox={checked:false};await view.api.consent({target:checkbox} as unknown as Event);
    assert.equal(checkbox.checked,true);assert.equal(view.api.pendingConsent.value,false);
    await view.api.refresh();await view.api.refresh();await view.api.act('complete');assert.equal(completions,0);
    assert.equal(view.api.status.value?.savedLogin?.consent,applied?false:true);
    assert.equal(view.api.privacyKey.value,'projects.savedLogin.consentUnresolved');
    fail=false;await view.api.retryConsent();assert.equal(view.api.pendingConsent.value,null);
    assert.equal(view.api.status.value?.savedLogin?.consent,false);
    assert.equal(view.api.privacyKey.value,'projects.browserLogin.private');
    await view.api.act('complete');assert.equal(completions,1);
  }finally{view.close();}
});
it('discards a delayed consent acknowledgement and pending choice after a scope change',async()=>{
  const response=deferred();let execution='e1';
  const view=mount(async(...args)=>args[2]==='/login/save-consent'?response.promise:{...login(execution),savedLogin:{enabled:true,consent:false,savedLoginId:null}});
  try{
    await settle();const writing=view.api.consent({target:{checked:true}} as unknown as Event);
    execution='e2';view.props.executionId=execution;view.props.scopeKey='new-owner';await settle();
    response.resolve({...login('e1'),savedLogin:{enabled:true,consent:true,savedLoginId:null}});await writing;
    assert.equal(view.api.status.value?.executionId,'e2');assert.equal(view.api.status.value?.savedLogin?.consent,false);
    assert.equal(view.api.pendingConsent.value,null);
  }finally{view.close();}
});
it('does not accept a consent response for a different control epoch',async()=>{
  const initial={...login('e1'),savedLogin:{enabled:true,consent:true,savedLoginId:null}};
  const view=mount(async(...args)=>args[2]==='/login/save-consent'?{...initial,login:{...initial.login,controlEpoch:'other'},savedLogin:{...initial.savedLogin,consent:false}}:initial);
  try{await settle();await view.api.consent({target:{checked:false}} as unknown as Event);assert.equal(view.api.pendingConsent.value,false);assert.equal(view.api.status.value?.savedLogin?.consent,true);}
  finally{view.close();}
});
it('discards a delayed signed browser URL on logout or owner/project change',async()=>{
  const ticket=deferred();const view=mount(async(...args)=>args[2]==='/login/viewer'?ticket.promise:login('e1'));
  try{await settle();const opening=view.api.act('viewer');view.props.scopeKey='owner2:p2:e2';view.props.projectId='p2';await settle();
    ticket.resolve({url:'https://browser.example.com/open#old-authority'});await opening;assert.equal(view.api.link.value,null);
    view.props.active=false;await settle();assert.equal(view.api.status.value,null);
  }finally{view.close();}
});
it('keeps explicit saved-login consent when an earlier status poll arrives late',async()=>{
  const stale=deferred();let calls=0;let body:unknown;
  const view=mount(async(...args)=>{if(args[2]==='/login/save-consent'){body=args[3];return {...login('e1'),savedLogin:{enabled:true,consent:true,savedLoginId:null}};}return ++calls===1?{...login('e1'),savedLogin:{enabled:true,consent:false,savedLoginId:null}}:stale.promise;});
  try{await settle();const poll=view.api.refresh();await view.api.consent({target:{checked:true}} as unknown as Event);stale.resolve({...login('e1'),savedLogin:{enabled:true,consent:false,savedLoginId:null}});await poll;
    assert.deepEqual(body,{controlEpoch:'epoch',saveLogin:true});assert.equal(view.api.status.value?.savedLogin?.consent,true);
  }finally{view.close();}
});
