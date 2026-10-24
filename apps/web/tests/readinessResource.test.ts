import assert from 'node:assert/strict';
import { afterEach, it } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ModuleKind, transpileModule } from 'typescript';
import { compileScript, parse } from 'vue/compiler-sfc';
import * as vue from 'vue';
const file = new URL('../src/features/sessions/ReadinessResourceView.vue', import.meta.url);
const js = transpileModule(compileScript(parse(await readFile(file,'utf8'),{filename:fileURLToPath(file)}).descriptor,{id:'readiness-test'}).content,{compilerOptions:{module:ModuleKind.CommonJS}}).outputText;
const scopes: vue.EffectScope[]=[];
afterEach(()=>scopes.splice(0).forEach(s=>s.stop()));
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
const tick=async()=>{for(let i=0;i<8;i++)await vue.nextTick();};
const historical={id:'evaluation',snapshot:{candidateId:'candidate',decision:'GO',reasons:[],validUntil:new Date(Date.now()+300000).toISOString()},snapshotHash:'hash'};
const candidate={id:'candidate',invalidatedAt:null,definition:{criteria:[{itemId:'mandatory',mandatory:true},{itemId:'optional',mandatory:false}]}};
function mount(overrides:Record<string,unknown>={}){
 const calls:unknown[][]=[],module={exports:{} as {default:{setup:(props:unknown,context:unknown)=>unknown}}};
 const state={candidates:[candidate],evaluations:[historical]};
 new Function('require','module','exports',js)((id:string)=>{
  if(id==='vue')return vue;if(id.includes('useI18n'))return {useI18n:()=>({t:(key:string)=>key})};
  if(id.includes('useSessionResourceReader'))return {useSessionResourceReader:()=>({detail:vue.ref({selectedArtifactId:'artifact',artifacts:[{id:'artifact',items:[{id:'mandatory',title:'Required'},{id:'optional',title:'Optional'}]}],runs:[]}),loading:vue.ref(false),failed:vue.ref(false),refresh:async()=>{}})};
  if(id.includes('readinessApi'))return {fetchReadiness:async(...args:unknown[])=>{calls.push(['read',...args]);return state;},fetchReadinessTargets:async()=>[{targetId:'target',label:'Target'}],freezeReadiness:async(...args:unknown[])=>{calls.push(['freeze',...args]);return {id:'candidate'};},evaluateReadiness:async(...args:unknown[])=>{calls.push(['evaluate',...args]);return historical;},...overrides};
  throw Error('Unexpected dependency: '+id);
 },module,module.exports);
 const props=vue.reactive({resource:{id:'readiness:request',kind:'readiness',scopeKey:'owner:project',requestId:'request'},projectId:'project',scopeKey:'owner:project',active:true});
 const scope=vue.effectScope();scopes.push(scope);const view=scope.run(()=>module.exports.default.setup(props,{expose(){},emit(){}})) as {
  state:vue.Ref<unknown>;loaded:vue.Ref<boolean>;current:vue.Ref<unknown>;currentAssessment:vue.ComputedRef<unknown>;busy:vue.Ref<boolean>;error:vue.Ref<boolean>;
  reference:vue.Ref<string>;optionalIds:vue.Ref<string[]>;candidateId:vue.Ref<string>;runId:vue.Ref<string>;risks:vue.Ref<Record<string,string>>;time:vue.Ref<number>;
  load:()=>Promise<void>;freeze:()=>Promise<void>;assess:()=>Promise<void>;
 };
 return {props,view,calls,scope};
}
it('historical GO never becomes a current assessment merely by opening the resource',async()=>{
 const {view,calls}=mount();await tick();assert.equal(view.current.value,null);assert.equal(Boolean(view.currentAssessment.value),false);assert.equal(calls.filter(c=>c[0]==='evaluate').length,0);
});
it('freeze marks every item mandatory by default and records optional changes only through readiness API',async()=>{
 const {view,calls}=mount();await tick();view.reference.value='build-1';await view.freeze();const command=calls.find(c=>c[0]==='freeze')![3] as {criteria:unknown[]};assert.deepEqual(command.criteria,[{itemId:'mandatory',mandatory:true},{itemId:'optional',mandatory:true}]);
 view.optionalIds.value=['optional'];await view.freeze();const last=calls.filter(c=>c[0]==='freeze').at(-1)![3] as {criteria:unknown[]};assert.deepEqual(last.criteria,[{itemId:'mandatory',mandatory:true},{itemId:'optional',mandatory:false}]);assert.ok(calls.every(c=>['read','freeze'].includes(c[0] as string)));
});
it('late reads cannot repopulate another owner/project scope',async()=>{
 const pending=deferred<unknown>();const {props,view}=mount({fetchReadiness:()=>pending.promise});await tick();props.active=false;props.scopeKey='other:project';props.resource={...props.resource,scopeKey:'other:project'};await tick();pending.resolve({candidates:[candidate],evaluations:[historical]});await tick();assert.deepEqual(view.state.value,{candidates:[],evaluations:[]});assert.equal(view.current.value,null);
});
it('a failed evaluation clears earlier GO and does not make an automatic retry',async()=>{
 let count=0;const {view}=mount({evaluateReadiness:async()=>{count++;throw Error('database unavailable');}});await tick();view.current.value=historical;await view.assess();assert.equal(count,1);assert.equal(view.current.value,null);assert.equal(view.error.value,true);assert.equal(Boolean(view.currentAssessment.value),false);
});
it('only optional risk reasons are sent and an assessment expires at its exact deadline',async()=>{
 const {view,calls}=mount();await tick();view.risks.value={mandatory:'Cannot waive this requirement',optional:'Documented optional issue'};await view.assess();
 const command=calls.find(c=>c[0]==='evaluate')![4] as {acceptedRisks:unknown[]};assert.deepEqual(command.acceptedRisks,[{itemId:'optional',reason:'Documented optional issue'}]);assert.equal(Boolean(view.currentAssessment.value),true);
 view.time.value=Date.parse(historical.snapshot.validUntil);assert.equal(Boolean(view.currentAssessment.value),false);
});
it('late evaluation cannot display GO after the reader is hidden or changes scope',async()=>{
 const pending=deferred<unknown>();const {view,props}=mount({evaluateReadiness:()=>pending.promise});await tick();const operation=view.assess();props.active=false;await tick();pending.resolve(historical);await operation;assert.equal(view.current.value,null);assert.equal(Boolean(view.currentAssessment.value),false);
});
it('hiding preserves this owner’s draft, while changing scope erases it',async()=>{
 const {view,props}=mount();await tick();view.reference.value='unfinished-build';view.optionalIds.value=['optional'];props.active=false;await tick();assert.equal(view.reference.value,'unfinished-build');assert.deepEqual(view.optionalIds.value,['optional']);props.active=true;await tick();assert.equal(view.reference.value,'unfinished-build');props.scopeKey='new-owner:project';props.resource={...props.resource,scopeKey:props.scopeKey};await tick();assert.equal(view.reference.value,'');assert.deepEqual(view.optionalIds.value,[]);
});
