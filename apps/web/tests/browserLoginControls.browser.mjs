import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { chromium } from 'playwright';

// Real SFC, native checkbox, translations and production styles; synthetic API
// deterministically loses a consent response with/without applying the write.
const root=fileURLToPath(new URL('../',import.meta.url));
const entry=`import {createApp,h,reactive} from 'vue';
import Login from '/src/features/sessions/BrowserLoginControls.vue';
import {setLocale} from '/src/i18n/useI18n.ts';
import 'bootstrap/dist/css/bootstrap.min.css';import '/src/styles/main.scss';
const props=reactive({projectId:'fixture',executionId:'execution',scopeKey:'owner',active:true});
const state={phase:'LOGIN',consent:false,saved:false,enabled:true,authenticationKind:'MANUAL',polls:0,completions:0,failure:null};
window.fetch=async(url,init={})=>{
 const path=new URL(url,location.href).pathname;
 if(path==='/api/auth/csrf')return Response.json({csrfToken:'fixture-csrf'});
 if(!path.startsWith('/api/projects/'))throw Error('Unexpected fixture network');
 if(init.method==='POST'){
  if(new Headers(init.headers).get('X-CSRF-Token')!=='fixture-csrf')throw Error('Missing CSRF');
  const body=JSON.parse(init.body);
  if(path.endsWith('/login/save-consent')){
   if(state.failure!=='not-applied')state.consent=body.saveLogin;
   if(state.failure)return Response.json({code:'TEST_RESPONSE_LOST',error:'Fixture failure'},{status:503});
  }
  if(path.endsWith('/login/complete')){state.completions++;state.phase='FINISH_REQUESTED';state.saved=state.consent;}
 }else state.polls++;
 return Response.json({runtimeId:'runtime',executionId:props.executionId,state:'LIVE',authenticationKind:state.authenticationKind,
  savedLogin:{enabled:state.enabled,consent:state.consent,savedLoginId:state.saved?'saved-id':null},
  login:{phase:state.phase,controlEpoch:'epoch',expiresAt:'2030-01-01'}});
};
window.fixture={state,props,setLocale};
createApp({render:()=>h('main',{class:'p-3'},h(Login,{...props}))}).mount('#app');`;
let server,browser,origin;
before(async()=>{
 server=await createServer({root,configFile:root+'vite.config.js',server:{host:'127.0.0.1',port:0,strictPort:true},plugins:[{
  name:'consent-regression-fixture',resolveId(id){if(id==='/consent-entry.js')return '\0consent-entry';},
  load(id){if(id==='\0consent-entry')return entry;},
  configureServer(vite){vite.middlewares.use('/consent-fixture',(_req,res)=>{
   res.setHeader('Content-Type','text/html');res.end('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="app"></div><script type="module" src="/consent-entry.js"></script>');
  });},
 }]});
 await server.listen();origin='http://127.0.0.1:'+server.httpServer.address().port;
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await server?.close();});

for(const locale of ['en','de','ar'])for(const width of [1280,390])for(const failure of ['not-applied','applied-response-lost']){
 test(`${locale}/${width}: failed withdrawal ${failure} stays blocked across polls, retry completes without saving`,{timeout:20000},async()=>{
  const copy=JSON.parse(await readFile(root+'src/i18n/messages/'+locale+'/projects.json','utf8'));
  const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  try{
   await page.goto(origin+'/consent-fixture');await page.waitForFunction(()=>window.fixture);
   await page.evaluate(locale=>window.fixture.setLocale(locale),locale);
   const checkbox=page.getByRole('checkbox'),complete=page.getByRole('button',{name:copy['projects.browserLogin.complete'],exact:true});
   await page.getByText(copy['projects.browserLogin.private'],{exact:true}).waitFor();
   await checkbox.focus();await page.keyboard.press('Space');await page.getByText(copy['projects.savedLogin.saveNote'],{exact:true}).waitFor();
   assert.equal(await checkbox.isChecked(),true);assert.equal(await page.getByText(copy['projects.browserLogin.private'],{exact:true}).count(),0);
   await page.evaluate(failure=>window.fixture.state.failure=failure,failure);
   // Native input changes before Vue's request settles. Inspect the actual DOM.
   await checkbox.focus();await page.keyboard.press('Space');await page.getByRole('alert').waitFor();
   const polls=await page.evaluate(()=>window.fixture.state.polls);
   await page.waitForFunction(n=>window.fixture.state.polls>=n+2,polls);
   assert.equal(await checkbox.isChecked(),failure==='not-applied');
   assert.equal(await complete.isDisabled(),true);assert.equal(await checkbox.isDisabled(),true);
   assert.equal(await page.getByRole('button',{name:copy['projects.browserLogin.stop'],exact:true}).isEnabled(),true);
   await complete.evaluate(button=>button.click());assert.equal(await page.evaluate(()=>window.fixture.state.completions),0);
   assert.equal(await page.getByText(copy['projects.browserLogin.private'],{exact:true}).count(),0);
   if(locale==='ar'&&width===390&&failure==='not-applied'&&process.env.ODDPATH_UI_SCREENSHOT)await page.screenshot({path:process.env.ODDPATH_UI_SCREENSHOT,fullPage:true});
   await page.evaluate(()=>window.fixture.state.failure=null);
   await page.getByRole('button',{name:copy['projects.savedLogin.retryConsent'],exact:true}).click();
   await page.getByText(copy['projects.browserLogin.private'],{exact:true}).waitFor();
   assert.equal(await checkbox.isChecked(),false);assert.equal(await complete.isEnabled(),true);
   await complete.click();await page.getByText(copy['projects.browserLogin.phase.FINISH_REQUESTED'],{exact:true}).waitFor();
   assert.equal(await page.evaluate(()=>window.fixture.state.saved),false);
   const layout=await page.evaluate(()=>({direction:document.documentElement.dir,overflow:document.documentElement.scrollWidth>innerWidth}));
   assert.equal(layout.overflow,false);assert.equal(layout.direction,locale==='ar'?'rtl':'ltr');assert.deepEqual(errors,[]);
  }finally{await context.close();}
 });
}

for(const locale of ['en','de','ar'])test(`${locale}: privacy follows confirmed saving, finish, READY and saved restoration`,{timeout:20000},async()=>{
 const copy=JSON.parse(await readFile(root+'src/i18n/messages/'+locale+'/projects.json','utf8'));
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(origin+'/consent-fixture');await page.waitForFunction(()=>window.fixture);await page.evaluate(locale=>window.fixture.setLocale(locale),locale);
  await page.getByRole('checkbox').focus();await page.keyboard.press('Space');await page.getByText(copy['projects.savedLogin.saveNote'],{exact:true}).waitFor();
  await page.getByRole('button',{name:copy['projects.browserLogin.complete'],exact:true}).click();
  await page.getByText(copy['projects.browserLogin.phase.FINISH_REQUESTED'],{exact:true}).waitFor();
  await page.getByText(copy['projects.savedLogin.saveNote'],{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.state.saved),true);
  await page.evaluate(()=>window.fixture.state.phase='READY');await page.getByText(copy['projects.browserLogin.readyNote'],{exact:true}).waitFor();
  await page.evaluate(()=>{Object.assign(window.fixture.state,{phase:'WAITING',authenticationKind:'SAVED_STATE',consent:false});window.fixture.props.scopeKey='restore-owner';});
  await page.getByText(copy['projects.savedLogin.restoringNote'],{exact:true}).waitFor();assert.equal(await page.getByText(copy['projects.browserLogin.private'],{exact:true}).count(),0);
  await page.evaluate(()=>{Object.assign(window.fixture.state,{phase:'LOGIN',authenticationKind:'MANUAL',enabled:false});window.fixture.props.scopeKey='no-save-owner';});
  await page.getByText(copy['projects.browserLogin.private'],{exact:true}).waitFor();assert.equal(await page.getByRole('checkbox').count(),0);
 }finally{await context.close();}
});
