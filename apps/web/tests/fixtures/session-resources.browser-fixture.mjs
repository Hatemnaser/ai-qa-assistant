import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

export async function createSessionResourceFixture({ viewerUrl = null, viewer, executionId = 'execution', runtimeId = 'runtime', loginPhase = 'NONE', onStop, securityPolicy = null } = {}) {
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const entry=`import {createApp,h,reactive} from 'vue';
import SessionPage from '/src/features/sessions/SessionPage.vue';
import {setLocale} from '/src/i18n/useI18n.ts';
import 'bootstrap/dist/css/bootstrap.min.css';import '/src/styles/main.scss';
const now='2026-10-13T12:00:00Z';
const make=(id,phase)=>({id,projectId:'project',title:id.toUpperCase(),objective:'Check '+id,phase,version:1,createdAt:now,updatedAt:now,target:'https://example.com',environment:'STAGING',acceptanceNotes:null,selectedArtifactId:null,contextSnapshots:[],artifacts:[],runs:[],reviews:[],events:[],operations:[]});
const current=make('current','RUNNING'),past=make('past','APPROVED');
const executionId=${JSON.stringify(executionId)};
const run=(id,requestId)=>({id,requestId,artifactId:'artifact',status:'ACTIVE',outcome:'NOT_RUN',version:1,sourceLabel:null,externalRunRef:null,commitSha:null,startedAt:now,submittedAt:null,createdAt:now,updatedAt:now,executionMode:'PLAYWRIGHT',results:[],evidence:[]});
current.runs=[{...run('run-current','current'),executionJob:{id:executionId,runId:'run-current',recipeId:'recipe',runnerRegistrationId:'registration',profileKey:'portal',status:'RUNNING',completedItems:1,totalItems:3,failureCode:null,failureMessage:null,createdAt:now,updatedAt:now}}];
past.runs=[{...run('run-past','past'),status:'RESULTS_SUBMITTED',outcome:'PASS',evidence:Array.from({length:30},(_,i)=>({id:'proof-'+i,runId:'run-past',checklistItemId:null,requirementId:null,actorKind:'INTEGRATION',transport:'REST',kind:'TEXT',textContent:'PAST OBSERVATION '+i,externalReference:null,metadata:null,createdAt:now,assets:[]}))}];
const session={id:'session',projectId:'project',title:'Resource fixture',version:1,managed:true,archivedAt:null,createdAt:now,updatedAt:now,currentRequestId:'current',messages:Array.from({length:24},(_,i)=>({id:'message-'+i,role:i%2?'assistant':'user',content:'Conversation '+i+' — '.repeat(30),model:null,createdAt:now})),requests:[current,past],pendingProposal:null,preparation:null,turnStatus:null,events:[]};
const props=reactive({currentUser:{id:'owner',email:'owner@example.test'},projects:[{id:'project',name:'Project'}],preferredProjectId:'project',sessionId:'session',requestId:'current',active:true});
const state={phase:new URL(location.href).searchParams.get('login')||${JSON.stringify(loginPhase)},runtimeId:${JSON.stringify(runtimeId)},status:'LIVE',viewerUrl:${JSON.stringify(viewerUrl)},consent:false,loseConsentResponse:false,savedLoginUnavailable:false,exportFailed:false};
const calls=[],scopes=[],pending={};
const nativeFetch=window.fetch.bind(window);
window.fetch=async(url,init={})=>{
 const path=new URL(url,location.href).pathname,method=init.method||'GET';calls.push({path,method});
 if(path==='/fixture-stop')return nativeFetch(url,init);
 if(path==='/fixture-viewer')return nativeFetch(url,init);
 if(path==='/api/auth/csrf')return Response.json({csrfToken:'fixture'});
 if(path==='/api/sessions/session')return Response.json({session});
 if(path.endsWith('/runner-profiles'))return Response.json({profiles:[]});
 if(path.endsWith('/saved-browser-logins'))return state.savedLoginUnavailable?Response.json({code:'BROWSER_SAVED_LOGIN_NOT_ACTIVE'},{status:409}):Response.json({states:[]});
 if(path.includes('/browser-runtimes/')){
  if(path.endsWith('/viewer'))return ${!!viewer} ? nativeFetch('/fixture-viewer',{method:'POST'}) : Response.json({url:state.viewerUrl});
  if(path.endsWith('/login/save-consent')){const desired=JSON.parse(init.body).saveLogin;if(state.loseConsentResponse&&!desired)return Response.json({code:'TEST_RESPONSE_LOST'},{status:503});state.consent=desired;}
  if(path.endsWith('/login/begin'))state.phase='LOGIN';
  if(path.endsWith('/login/complete'))state.phase='FINISH_REQUESTED';
  return Response.json({runtimeId:state.runtimeId,executionId,state:state.status,authenticationKind:state.phase==='NONE'?'NONE':'MANUAL',savedLogin:{enabled:true,consent:state.consent,savedLoginId:null},login:{phase:state.phase,controlEpoch:'fixture-epoch',expiresAt:'2030-01-01'}});
 }
 if(path.endsWith('/cancel')){await fetch('/fixture-stop',{method:'POST'});current.runs[0].executionJob.status='CANCELLED';state.status='STOP_CONFIRMED';return Response.json({request:current});}
 if(path.endsWith('/requests/current'))return Response.json({request:current});
 if(path.endsWith('/requests/past/export')){if(pending.export)await pending.export;if(state.exportFailed)return Response.json({code:'QA_EXPORT_TOO_LARGE'},{status:413});const {format}=JSON.parse(init.body);return format==='JSON'?Response.json({schemaVersion:1,exportType:'QA_HISTORY',historicalOnly:true}):new Response(format==='MARKDOWN'?'# Fixture QA history':'fixture archive bytes');}
 if(path.endsWith('/requests/past')){if(pending.read)await pending.read;return Response.json({request:past});}
 throw Error('Unexpected fixture request: '+path);
};
window.fixture={props,state,calls,scopes,current,past,session,setLocale,pending};
createApp({render:()=>h(SessionPage,{...props,onScopeChange:value=>scopes.push(value)})}).mount('#app');`;
  const server=await createServer({root,configFile:root+'vite.config.js',server:{host:'127.0.0.1',port:0,strictPort:true},plugins:[{
    name:'session-resource-fixture',resolveId(id){if(id==='/resource-entry.js')return '\0resource-entry';},load(id){if(id==='\0resource-entry')return entry;},
    configureServer(vite){vite.middlewares.use('/resource-fixture',(req,res)=>{res.setHeader('Content-Type','text/html');if(securityPolicy&&new URL(req.url,'http://fixture').searchParams.get('productionPolicy')==='1')res.setHeader('Content-Security-Policy',securityPolicy);res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body,#app{height:100%;margin:0}</style><div id="app"></div><script type="module" src="/resource-entry.js"></script>');});
      vite.middlewares.use('/fixture-stop',async(_req,res)=>{await onStop?.();res.end('{}');});
      vite.middlewares.use('/fixture-viewer',async(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(await viewer?.()));});
      vite.middlewares.use('/open',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Unconnected viewer fixture</title><p>Loaded without a browser connection</p>');});},
  }]});
  await server.listen();return {server,origin:'http://127.0.0.1:'+server.httpServer.address().port};
}
