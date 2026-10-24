import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { createSessionResourceFixture } from './fixtures/session-resources.browser-fixture.mjs';

let fixture,browser,viewerGate=null,viewerTarget=null,viewerCount=0,productionPolicy=null;
before(async()=>{
 if(process.env.ODDPATH_RESOURCE_PRODUCTION_HEADERS==='1'){
  const headers=await readFile(new URL('../dist/_headers',import.meta.url),'utf8');
  productionPolicy=headers.match(/Content-Security-Policy: (.+)/)[1].trim();
  assert.match(productionPolicy,/frame-src https:\/\/viewer\.example\.test;/);
 }
 fixture=await createSessionResourceFixture({securityPolicy:productionPolicy,viewer:async()=>{
  const count=++viewerCount,gate=viewerGate;viewerGate=null;
  if(gate){gate.entered();await gate.promise;}
  return {url:viewerTarget||fixture.origin+'/open#fixture-'+count};
 }});
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await fixture?.server.close();});

test('expired evidence remains visible as a receipt without a download control',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();
  await page.evaluate(()=>window.fixture.past.runs[0].evidence.push({id:'expired-proof',runId:'run-past',checklistItemId:null,requirementId:null,actorKind:'INTEGRATION',transport:'REST',kind:'SCREENSHOT',textContent:null,externalReference:null,metadata:null,createdAt:'2026-10-14T12:00:00Z',assets:[{id:'expired-binding',ordinal:0,asset:{id:'unavailable:expired-binding',originalName:'expired.png',declaredMimeType:'image/png',detectedMimeType:'image/png',sizeBytes:68,status:'EXPIRED',readyAt:null}}]}));
  await page.getByRole('button',{name:'Activity',exact:true}).click();const panel=page.locator('#session-resources-panel');await panel.getByRole('combobox').first().selectOption('evidence:past');
  await panel.getByText(/expired\.png.*Evidence file expired/u).waitFor();assert.equal(await panel.getByRole('button',{name:/expired\.png/u}).count(),0);
 }finally{await context.close();}
});

test('linked screenshots fulfill evidence in the real reader without bypassing expired local files',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();
  await page.evaluate(()=>{
   const requirement={id:'linked-requirement',ordinal:0,kind:'SCREENSHOT',description:'Linked screenshot requirement',required:true};
   window.fixture.past.artifacts=[{id:'artifact',requestId:'past',revision:1,title:'Linked proof',items:[{id:'linked-item',ordinal:0,title:'Heading',steps:['Observe heading'],preconditions:[],expectedResult:'Visible heading',evidenceRequirements:[requirement]}]}];
   window.fixture.past.runs[0].evidence=[{id:'linked-proof',runId:'run-past',checklistItemId:'linked-item',requirementId:requirement.id,kind:'SCREENSHOT',actorKind:'USER',transport:'WEB',externalReference:'https://evidence.example.test/proof.png',textContent:null,assets:[]}];
  });
  await page.getByRole('button',{name:'Activity',exact:true}).click();const panel=page.locator('#session-resources-panel');await panel.getByRole('combobox').first().selectOption('evidence:past');
  await panel.locator('a[href="https://evidence.example.test/proof.png"]').waitFor();
  assert.equal(await panel.getByText('SCREENSHOT · Linked screenshot requirement',{exact:true}).count(),0);
  await page.evaluate(()=>window.fixture.past.runs[0].evidence[0].assets=[{id:'expired-local',ordinal:0,asset:{id:'unavailable:expired-local',originalName:'expired-local.png',status:'EXPIRED',evidenceExpiresAt:'1970-01-01T00:00:00Z'}}]);
  await panel.getByRole('button',{name:'Refresh',exact:true}).click();
  await panel.getByText('SCREENSHOT · Linked screenshot requirement',{exact:true}).waitFor();
  await panel.getByText(/expired-local\.png.*Evidence file expired/u).waitFor();
 }finally{await context.close();}
});

test('historical QA export preserves the writer and uses the selected run and format',{timeout:30000},async()=>{
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();await page.locator('.composer-textarea').fill('Keep my draft');
  await page.getByRole('button',{name:'Activity',exact:true}).click();const panel=page.locator('#session-resources-panel');await panel.getByRole('combobox').first().selectOption('results:past');await panel.getByRole('heading',{name:'PAST',exact:true}).waitFor();
  for(const [format,extension] of [['JSON','json'],['MARKDOWN','md'],['ZIP','zip']]){
   await panel.getByLabel('Report format',{exact:false}).selectOption(format);const downloaded=page.waitForEvent('download');await panel.getByRole('button',{name:'Export QA report',exact:true}).click();assert.equal((await downloaded).suggestedFilename(),'oddpath-qa-report.'+extension);
  }
  assert.equal(await page.evaluate(()=>window.fixture.props.requestId),'current');assert.ok(!(await page.evaluate(()=>window.fixture.scopes)).some(s=>s.requestId==='past'));
  await panel.getByRole('button',{name:'Hide tabs',exact:true}).click();assert.equal(await page.locator('.composer-textarea').inputValue(),'Keep my draft');
 }finally{await context.close();}
});

test('late QA export after owner change never downloads and export errors stay retryable',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();let downloads=0;page.on('download',()=>downloads++);
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();await page.getByRole('button',{name:'Activity',exact:true}).click();const panel=page.locator('#session-resources-panel');await panel.getByRole('combobox').first().selectOption('results:past');await panel.getByRole('heading',{name:'PAST',exact:true}).waitFor();
  await page.evaluate(()=>window.fixture.state.exportFailed=true);await panel.getByRole('button',{name:'Export QA report',exact:true}).click();await panel.getByRole('alert').getByText('The report could not be exported. Retry or export a smaller record.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.fixture.state.exportFailed=false;window.fixture.pending.export=new Promise(resolve=>window.fixture.pending.resolveExport=resolve);});await panel.getByRole('button',{name:'Export QA report',exact:true}).click();
  await page.waitForFunction(()=>window.fixture.calls.filter(c=>c.path.endsWith('/export')).length===2);
  await page.evaluate(()=>{window.fixture.props.currentUser={id:'second-owner',email:'second@example.test'};});await page.waitForFunction(()=>!document.querySelector('[role=tab]'));
  await page.evaluate(()=>window.fixture.pending.resolveExport());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(downloads,0);
 }finally{await context.close();}
});
for(const locale of ['en','de','ar'])for(const width of [1280,390])test(`${locale}/${width}: independent historical tabs retain writer, pin, scroll, hide and close`,{timeout:30000},async()=>{
 const copy=JSON.parse(await readFile(new URL('../src/i18n/messages/'+locale+'/sessionResources.json',import.meta.url),'utf8'));
 const tools=JSON.parse(await readFile(new URL('../src/i18n/messages/'+locale+'/sessionTools.json',import.meta.url),'utf8'));
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.waitForFunction(()=>window.fixture);
  await page.evaluate(locale=>window.fixture.setLocale(locale),locale);
  await page.locator('.test-session__results-link').getByText('CURRENT',{exact:false}).waitFor();
  await page.locator('.composer-textarea').fill('Retain my unsent draft');
  await page.getByRole('button',{name:tools['sessionTools.activity'],exact:true}).click();
  const panel=page.locator('#session-resources-panel'),picker=panel.getByRole('combobox').first();
  await picker.selectOption('evidence:past');await panel.getByText('PAST OBSERVATION 0',{exact:true}).waitFor();
  const evidenceName=copy['sessionResources.evidence']+' · PAST';
  await panel.getByRole('button',{name:copy['sessionResources.pin'].replace('{name}',evidenceName),exact:true}).click();
  await panel.getByRole('tab',{name:evidenceName,exact:true}).focus();await page.keyboard.press('Home');
  assert.equal(await panel.getByRole('tab',{name:evidenceName,exact:true}).getAttribute('aria-selected'),'true');
  const scroll=panel.locator('[role=tabpanel]:visible');await scroll.evaluate(element=>element.scrollTop=250);
  await picker.selectOption('sources');await panel.getByRole('tab',{name:evidenceName,exact:true}).click();
  assert.ok(await scroll.evaluate(element=>element.scrollTop)>=200);
  await panel.getByRole('button',{name:copy['sessionResources.hide'],exact:true}).click();
  assert.equal(await page.getByRole('button',{name:tools['sessionTools.activity'],exact:true}).evaluate(button=>document.activeElement===button),true);
  assert.equal(await page.locator('.composer-textarea').inputValue(),'Retain my unsent draft');
  assert.equal(await page.evaluate(()=>window.fixture.props.requestId),'current');
  assert.ok(!(await page.evaluate(()=>window.fixture.scopes)).some(item=>item.requestId==='past'));
  await page.getByRole('button',{name:copy['sessionResources.show'],exact:true}).click();
  assert.equal(await panel.getByRole('tab',{name:evidenceName,exact:true}).getAttribute('aria-selected'),'true');
  await picker.selectOption('readiness:past');await panel.getByText(copy['sessionResources.notEvaluated'],{exact:true}).waitFor();
  await picker.selectOption('results:past');await panel.getByRole('heading',{name:'PAST',exact:true}).waitFor();
  await panel.getByRole('button',{name:copy['sessionResources.expand'],exact:true}).click();await page.waitForFunction(()=>document.getElementById('app').inert);
  await panel.getByRole('button',{name:copy['sessionResources.collapse'],exact:true}).click();
  await panel.getByRole('button',{name:copy['sessionResources.close'].replace('{name}',copy['sessionResources.results']+' · PAST'),exact:true}).click();
  await panel.getByRole('button',{name:copy['sessionResources.hide'],exact:true}).click();
  assert.equal(await page.evaluate(()=>document.getElementById('app').inert),false);
  assert.equal(await page.evaluate(()=>window.fixture.calls.filter(item=>item.path.endsWith('/cancel')).length),0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(locale==='ar'&&width===1280&&process.env.ODDPATH_RESOURCE_SCREENSHOT){await page.getByRole('button',{name:copy['sessionResources.show'],exact:true}).click();await page.screenshot({path:process.env.ODDPATH_RESOURCE_SCREENSHOT,fullPage:true});}
  await page.evaluate(()=>window.fixture.props.currentUser={id:'second-owner',email:'second@example.test'});
  await page.waitForFunction(()=>!document.querySelector('[role=tab]'));
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

for(const mode of ['NONE','LOGIN'])test(`${mode}: disconnect invalidates a held grant and keeps polling and reconnect usable`,{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();let release;
 try{
  await page.goto(fixture.origin+'/resource-fixture?login='+mode);await page.locator('.test-session__results-link').waitFor();
  await page.getByRole('button',{name:'Browser',exact:true}).click();const panel=page.locator('#session-resources-panel');
  const connect=panel.getByRole('button',{name:mode==='LOGIN'?'Get browser link':'Connect browser view',exact:true});
  let firstEntered;const firstAtGate=new Promise(resolve=>firstEntered=resolve),firstPending=new Promise(resolve=>release=resolve);
  viewerGate={promise:firstPending,entered:firstEntered};await connect.click();await firstAtGate;
  const firstPolls=await page.evaluate(()=>window.fixture.calls.filter(item=>item.path.endsWith('/browser-runtimes/execution')).length);
  await page.waitForFunction(count=>window.fixture.calls.filter(item=>item.path.endsWith('/browser-runtimes/execution')).length>count,firstPolls);
  assert.equal(await connect.isDisabled(),true);
  const firstReplied=page.waitForResponse(response=>new URL(response.url()).pathname==='/fixture-viewer');release();await firstReplied;await page.locator('iframe').waitFor();
  let entered;const atGate=new Promise(resolve=>entered=resolve),promise=new Promise(resolve=>release=resolve);
  viewerGate={promise,entered};await connect.click();await atGate;
  // Let an ordinary status poll arrive while the new grant is pending.
  const polls=await page.evaluate(()=>window.fixture.calls.filter(item=>item.path.endsWith('/browser-runtimes/execution')).length);
  await page.waitForFunction(count=>window.fixture.calls.filter(item=>item.path.endsWith('/browser-runtimes/execution')).length>count,polls);
  await panel.getByRole('button',{name:'Disconnect view',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('iframe'));
  const replied=page.waitForResponse(response=>new URL(response.url()).pathname==='/fixture-viewer');release();await replied;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('iframe').count(),0);assert.equal(await connect.isEnabled(),true);
  await panel.getByText('View disconnected',{exact:true}).waitFor();
  await connect.click();await page.locator('iframe').waitFor();
  // A later explicit connect also wins over an older disconnected request.
  let oldEntered;const oldAtGate=new Promise(resolve=>oldEntered=resolve),oldPending=new Promise(resolve=>release=resolve);
  viewerGate={promise:oldPending,entered:oldEntered};await connect.click();await oldAtGate;
  await panel.getByRole('button',{name:'Disconnect view',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('iframe'));
  await connect.click();await page.locator('iframe').waitFor();const latest=await page.locator('iframe').getAttribute('src');
  const oldReplied=page.waitForResponse(response=>new URL(response.url()).pathname==='/fixture-viewer');release();await oldReplied;
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.equal(await page.locator('iframe').getAttribute('src'),latest);
  assert.equal(await page.evaluate(()=>window.fixture.calls.some(item=>item.path.endsWith('/cancel'))),false);
 }finally{release?.();viewerGate=null;await context.close();}
});

for(const width of [1280,390])test(`${width}: private-login modal keyboard visits the iframe and returns inside the dialog`,{timeout:30000},async()=>{
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage();
 try{
  await context.route('**/open',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><input aria-label="First login field"><input aria-label="Last login field">'}));
  await page.goto(fixture.origin+'/resource-fixture?login=LOGIN');await page.locator('.test-session__results-link').waitFor();
  await page.getByRole('button',{name:'Browser',exact:true}).click();const panel=page.locator('#session-resources-panel');
  if(width===1280)await panel.getByRole('button',{name:'Expand',exact:true}).click();
  await page.waitForFunction(()=>document.getElementById('app').inert);
  await panel.getByRole('button',{name:'Get browser link',exact:true}).click();await page.frameLocator('iframe').getByRole('textbox',{name:'First login field'}).waitFor();
  const back=panel.getByRole('button',{name:'Return to session controls',exact:true}),summary=panel.locator('.session-browser-resource > details > summary');
  await back.focus();await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(()=>document.activeElement.tagName),'IFRAME');
  const first=page.frameLocator('iframe').getByRole('textbox',{name:'First login field'}),last=page.frameLocator('iframe').getByRole('textbox',{name:'Last login field'});
  assert.equal(await first.evaluate(field=>document.activeElement===field),true);
  await page.keyboard.press('Tab');assert.equal(await last.evaluate(field=>document.activeElement===field),true);
  await page.keyboard.press('Tab');assert.equal(await summary.evaluate(element=>document.activeElement===element),true);
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'IFRAME');
  assert.equal(await last.evaluate(field=>document.activeElement===field),true);
  await page.keyboard.press('Shift+Tab');await page.keyboard.press('Shift+Tab');assert.equal(await back.evaluate(element=>document.activeElement===element),true);
  await panel.getByRole('button',{name:width===1280?'Collapse':'Expand',exact:true}).focus();await page.keyboard.press('Shift+Tab');
  assert.equal(await summary.evaluate(element=>document.activeElement===element),true);
  await page.keyboard.press('Tab');assert.ok(['Expand','Collapse'].includes(await page.evaluate(()=>document.activeElement.textContent.trim())));
  await summary.focus();await page.keyboard.press('Space');await page.keyboard.press('Tab');
  const savedRefresh=panel.locator('.session-browser-resource > details').getByRole('button',{name:'Refresh',exact:true});
  assert.equal(await savedRefresh.evaluate(element=>document.activeElement===element),true);
  await page.keyboard.press('Tab');assert.ok(['Expand','Collapse'].includes(await page.evaluate(()=>document.activeElement.textContent.trim())));
  await page.keyboard.press('Shift+Tab');assert.equal(await savedRefresh.evaluate(element=>document.activeElement===element),true);
  await page.evaluate(()=>window.fixture.state.savedLoginUnavailable=true);await savedRefresh.click();
  await page.waitForFunction(()=>!document.querySelector('.session-browser-resource > details'));
  await last.focus();await page.keyboard.press('Tab');
  assert.ok(['Expand','Collapse'].includes(await page.evaluate(()=>document.activeElement.textContent.trim())));
  await page.keyboard.press('Shift+Tab');assert.equal(await page.evaluate(()=>document.activeElement.tagName),'IFRAME');
  assert.equal(await page.evaluate(()=>document.getElementById('app').inert),true);
  await panel.getByRole('button',{name:'Hide tabs',exact:true}).click();assert.equal(await page.evaluate(()=>document.getElementById('app').inert),false);
 }finally{await context.close();}
});

for(const allowed of [true,false])test(`production CSP ${allowed?'permits the configured viewer':'blocks a different viewer'} in SessionPage`,{timeout:30000,skip:process.env.ODDPATH_RESOURCE_PRODUCTION_HEADERS!=='1'},async()=>{
 const context=await browser.newContext(),page=await context.newPage();let requests=0;
 const origin=allowed?'https://viewer.example.test':'https://other.example.test';viewerTarget=origin+'/open#fixture';
 try{
  await context.route(origin+'/**',route=>{requests++;return route.fulfill({contentType:'text/html',body:'<!doctype html><input aria-label="Production policy viewer">'});});
  await page.addInitScript(()=>{window.frameViolations=[];document.addEventListener('securitypolicyviolation',event=>{if(event.effectiveDirective==='frame-src')window.frameViolations.push(event.blockedURI);});});
  await page.goto(fixture.origin+'/resource-fixture?productionPolicy=1');await page.locator('.test-session__results-link').waitFor();
  await page.getByRole('button',{name:'Browser',exact:true}).click();await page.locator('#session-resources-panel').getByRole('button',{name:'Connect browser view',exact:true}).click();
  if(allowed){await page.frameLocator('iframe').getByRole('textbox',{name:'Production policy viewer'}).waitFor();assert.equal(requests,1);assert.deepEqual(await page.evaluate(()=>window.frameViolations),[]);}
  else{await page.waitForFunction(()=>window.frameViolations.includes('https://other.example.test'));assert.equal(requests,0);}
  assert.equal(await page.getByText('Browser display connected',{exact:true}).count(),0);
 }finally{viewerTarget=null;await context.close();}
});

test('iframe load and spoofed messages do not report browser success',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();
  await page.getByRole('button',{name:'Browser',exact:true}).click();const panel=page.locator('#session-resources-panel');
  await panel.getByRole('button',{name:'Connect browser view',exact:true}).click();await page.locator('iframe').waitFor();
  await page.evaluate(()=>window.postMessage({type:'oddpath-browser',state:'connected',runtimeId:'runtime',mode:'VIEW'},location.origin));
  assert.equal(await panel.getByText('Browser display connected',{exact:true}).count(),0);
  await panel.getByText('The browser display could not connect. Retry with a new viewer grant.',{exact:true}).waitFor({timeout:20000});
  assert.equal(await page.locator('iframe').count(),0);assert.equal(await page.evaluate(()=>window.fixture.calls.some(item=>item.path.endsWith('/cancel'))),false);
 }finally{await context.close();}
});

test('opening, hiding and closing browser tabs preserve unresolved save-consent decisions',{timeout:30000},async()=>{
 const context=await browser.newContext({viewport:{width:390,height:900}}),page=await context.newPage();
 const copy=JSON.parse(await readFile(new URL('../src/i18n/messages/en/projects.json',import.meta.url),'utf8'));
 try{
  await page.goto(fixture.origin+'/resource-fixture?login=LOGIN');await page.locator('.test-session__results-link').waitFor();
  const decision=page.getByRole('button',{name:'Review decision',exact:true});if(await decision.isVisible())await decision.click();
  await page.getByRole('checkbox').waitFor();await page.getByRole('checkbox').focus();await page.keyboard.press('Space');
  await page.waitForFunction(()=>window.fixture.state.consent && !document.querySelector('.form-check-input')?.disabled);
  await page.evaluate(()=>window.fixture.state.loseConsentResponse=true);await page.getByRole('checkbox').focus();await page.keyboard.press('Space');
  const complete=page.getByRole('button',{name:copy['projects.browserLogin.complete'],exact:true});await page.waitForFunction(()=>document.querySelector('.form-check-input')?.disabled);
  assert.equal(await complete.isDisabled(),true);
  await page.getByRole('button',{name:'Browser',exact:true}).click();await page.locator('#session-resources-panel').getByRole('button',{name:'Hide tabs',exact:true}).click();
  assert.equal(await complete.isDisabled(),true);assert.equal(await page.getByRole('checkbox').isChecked(),true);
  await page.getByRole('button',{name:'Show tabs',exact:true}).click();await page.locator('#session-resources-panel').getByRole('button',{name:'Close Browser · CURRENT',exact:true}).click();
  assert.equal(await complete.isDisabled(),true);
  await page.evaluate(()=>window.fixture.state.loseConsentResponse=false);await page.getByRole('button',{name:copy['projects.savedLogin.retryConsent'],exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('.form-check-input')?.disabled===false);assert.equal(await complete.isEnabled(),true);assert.equal(await page.getByRole('checkbox').isChecked(),false);
 }finally{await context.close();}
});

test('a closed or deactivated reader never adopts its late historical response',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();
  await page.evaluate(()=>{window.fixture.pending.read=new Promise(resolve=>window.fixture.pending.resolve=resolve);});
  await page.getByRole('button',{name:'Activity',exact:true}).click();await page.locator('#session-resources-panel').getByRole('combobox').first().selectOption('evidence:past');
  await page.evaluate(()=>window.fixture.props.active=false);await page.evaluate(()=>window.fixture.pending.resolve());
  assert.equal(await page.getByText('PAST OBSERVATION 0',{exact:true}).isVisible(),false);
  await page.evaluate(()=>{window.fixture.props.currentUser={id:'other',email:'other@example.test'};window.fixture.props.active=true;});
  await page.waitForFunction(()=>!document.querySelector('[role=tab]'));
 }finally{await context.close();}
});
