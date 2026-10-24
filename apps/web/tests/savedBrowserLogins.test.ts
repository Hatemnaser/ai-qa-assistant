import assert from 'node:assert/strict';import {it} from 'node:test';import {readFile} from 'node:fs/promises';import {fileURLToPath} from 'node:url';
import {ModuleKind,transpileModule} from 'typescript';import {parse,compileScript} from 'vue/compiler-sfc';import * as vue from 'vue';
const file=new URL('../src/features/sessions/SavedBrowserLogins.vue',import.meta.url),source=await readFile(file,'utf8');
const js=transpileModule(compileScript(parse(source,{filename:fileURLToPath(file)}).descriptor,{id:'saved-login-test'}).content,{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
async function settle(){await vue.nextTick();await new Promise(resolve=>setImmediate(resolve));}
function deferred(){let resolve!:(value:unknown)=>void;const promise=new Promise<unknown>(r=>resolve=r);return {promise,resolve};}
function mount(fetch:(...args:unknown[])=>Promise<unknown>){let dispose=()=>{};const module={exports:{} as {default:{setup:(props:unknown,context:unknown)=>unknown}}};
 new Function('require','module','exports',js)((id:string)=>{if(id==='vue')return {...vue,onBeforeUnmount:(fn:()=>void)=>dispose=fn};if(id.includes('csrf'))return {csrfFetch:fetch};if(id.includes('config/api'))return {API_BASE_URL:''};if(id.includes('useI18n'))return {useI18n:()=>({t:(key:string)=>key})};throw Error(id);},module,module.exports);
 const props=vue.reactive({projectId:'p1',scopeKey:'owner:p1'}),scope=vue.effectScope();
 const api=scope.run(()=>module.exports.default.setup(props,{expose(){}})) as {states:vue.Ref<Array<{id:string}>>;busy:vue.Ref<boolean>;revoke:(id:string)=>Promise<void>};
 return {props,api,close(){dispose();scope.stop();}};
}
const response=(id:string)=>({ok:true,json:async()=>({states:[{id,expiresAt:'2030-01-01',revoked:false}]})});
it('discards saved-login metadata from a previous owner/project',async()=>{const old=deferred();let calls=0;const f=mount(async()=>++calls===1?old.promise:response('new'));try{f.props.projectId='p2';f.props.scopeKey='other:p2';await settle();old.resolve(response('old'));await settle();assert.deepEqual(f.api.states.value.map(row=>row.id),['new']);}finally{f.close();}});
it('refreshes after revocation without leaving the controls permanently busy',async()=>{let post:unknown;const f=mount(async(_url,options)=>{if((options as {method?:string}).method==='POST')post=options;return response('state');});try{await settle();await f.api.revoke('state');await settle();assert.equal(f.api.busy.value,false);assert.match((post as {body:string}).body,/acknowledgeRevocation/u);}finally{f.close();}});
