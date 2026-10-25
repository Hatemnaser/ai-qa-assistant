import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {before,after,test} from 'node:test';
import {createServer} from 'vite';
import {chromium} from 'playwright';

const root=fileURLToPath(new URL('../',import.meta.url));
const entry=`import {createApp,h,reactive} from 'vue';
import Approval from '/src/features/qa/components/QaRunApprovalPanel.vue';
import {setLocale} from '/src/i18n/useI18n.ts';
import 'bootstrap/dist/css/bootstrap.min.css';import '/src/styles/main.scss';
const props=reactive({artifact:{id:'artifact',requestId:'request',revision:1,origin:'AGENT_PROVIDED',title:'Checklist',lockedAt:null,createdAt:'2026-10-14T12:00:00Z',assessments:[],items:[]},identityKey:'owner/project/session/request',requestVersion:1,isGenerating:false,isLoadingProfiles:false,isRetryingReview:false,isSaving:false,operations:[],recipes:[],profiles:[{protocolVersion:2,id:'profile',key:'staging',label:'Staging',runnerRegistrationId:'runner',runnerName:'Runner',runnerInstanceId:'instance',runnerVersion:'0.2-test',environmentKind:'STAGING',status:'ONLINE',supportedRecipeVersions:[1],valueRefs:[],evidenceKinds:['TEXT'],manifestHash:'a'.repeat(64),lastSeenAt:null}]});
props.isOpen=true;
window.fixture={props,setLocale};
createApp({render:()=>h(Approval,props)}).mount('#app');`;
let server,browser,origin;
before(async()=>{
 server=await createServer({root,configFile:root+'vite.config.js',server:{host:'127.0.0.1',port:0,strictPort:true},plugins:[{name:'browser-quota-fixture',
 resolveId(id){if(id==='/quota-entry.js')return '\0quota-entry';},load(id){if(id==='\0quota-entry')return entry;},
 configureServer(instance){instance.middlewares.use('/quota-fixture',(_request,response)=>{
  response.setHeader('Content-Type','text/html');response.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/quota-entry.js"></script>');
 });}}]});await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await server?.close();});
for(const locale of ['en','de','ar'])for(const width of [1280,390])test(`${locale}/${width}: managed approval exposes capacity and deadline limits`,{timeout:30000},async()=>{
 const copy=JSON.parse(await readFile(root+'src/i18n/messages/'+locale+'/projects.json','utf8'));
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(origin+'/quota-fixture');await page.waitForFunction(()=>window.fixture,null,{timeout:10000});
  await page.evaluate(locale=>window.fixture.setLocale(locale),locale);
  await page.locator('.qa-run-approval__details > summary').click({timeout:10000});
  const note=page.getByTestId('browser-quota-limits');await note.waitFor();
  assert.equal(await note.textContent(),copy['projects.qa.approval.browserLimits']);
  assert.match(await note.textContent(),/UTC/);assert.ok(await note.isVisible());
  await page.evaluate(()=>window.fixture.props.profiles[0].protocolVersion=1);
  await note.waitFor({state:'detached'});assert.deepEqual(errors,[]);
 }catch(error){
  // A rerun must never overwrite historical phase evidence.
  const directory=new URL('../../../work/browser-ui-failures/',import.meta.url);await mkdir(directory,{recursive:true});
  await writeFile(new URL('quota-'+locale+'-'+width+'-'+randomUUID()+'.json',directory),JSON.stringify({errors,url:page.url(),html:await page.locator('#app').innerHTML(),message:error.message},null,2),{flag:'wx'});
  throw error;
 }finally{await context.close();}
});
