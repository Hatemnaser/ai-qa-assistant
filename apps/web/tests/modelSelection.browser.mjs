import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {before,after,test} from 'node:test';
import {chromium} from 'playwright';
import {createSessionResourceFixture} from './fixtures/session-resources.browser-fixture.mjs';
let fixture,browser;
before(async()=>{fixture=await createSessionResourceFixture();browser=await chromium.launch({headless:true});});
after(async()=>{await browser?.close();await fixture?.server.close();});
for(const locale of ['en','de','ar'])for(const width of [1280,390])test(`${locale}/${width}: explicit and Auto remain selectable and actual model survives a new reader`,{timeout:45000},async()=>{
 const copy=JSON.parse(await readFile(new URL('../src/i18n/messages/'+locale+'/chat.json',import.meta.url),'utf8'));
 const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.waitForFunction(()=>window.fixture);
  await page.evaluate(locale=>{window.fixture.setLocale(locale);const original=window.fetch;
   window.fixture.sent=[];
   window.fetch=async(url,init={})=>{
    const path=new URL(url,location.href).pathname;
    if(path.endsWith('/turns')){
     const input=JSON.parse(init.body);window.fixture.sent.push(input);
     const concrete=input.model==='auto'?'gemini-2.5-flash-lite':input.model;
     const session=window.fixture.session;session.version++;
     session.messages.push({id:'user-model-'+session.version,role:'user',content:input.content,mode:input.mode,model:input.model,createdAt:new Date().toISOString()});
     session.messages.push({id:'assistant-model-'+session.version,role:'assistant',content:'Recorded reply '+session.version,mode:input.mode,model:concrete,createdAt:new Date().toISOString()});
     return Response.json({session,turnId:'model-turn-'+session.version});
    }
    return original(url,init);
   };
  },locale);
  const model=page.getByRole('combobox',{name:copy['chat.topbar.model'],exact:true}),mode=page.getByRole('combobox',{name:copy['chat.topbar.mode'],exact:true});
  await model.selectOption('gemini-3.1-flash-lite');await mode.selectOption('screenshot_review');
  assert.equal(await model.isDisabled(),false);assert.equal(await model.inputValue(),'gemini-3.1-flash-lite');
  await page.getByRole('textbox',{name:copy['chat.composer.message'],exact:true}).fill('Use the explicit choice');
  await page.getByRole('button',{name:copy['chat.composer.send'],exact:true}).click();
  await page.getByText(copy['model.used'].replace('{model}','gemini-3.1-flash-lite'),{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.fixture.sent[0].model),'gemini-3.1-flash-lite');assert.equal(await page.evaluate(()=>window.fixture.sent[0].mode),'screenshot_review');
  await model.selectOption('auto');await page.getByText(copy['model.auto.description'],{exact:true}).waitFor();
  await page.getByRole('textbox',{name:copy['chat.composer.message'],exact:true}).fill('Use Auto');await page.getByRole('button',{name:copy['chat.composer.send'],exact:true}).click();
  await page.getByText(copy['model.used'].replace('{model}','gemini-2.5-flash-lite'),{exact:true}).waitFor();assert.equal(await page.evaluate(()=>window.fixture.sent[1].model),'auto');assert.equal(await model.inputValue(),'auto');
  assert.equal(await page.evaluate(()=>window.fixture.props.requestId),'current');assert.ok(!(await page.evaluate(()=>window.fixture.scopes)).some(scope=>scope.requestId==='past'));
  // Reload the real SessionPage with the persisted message DTO, not the selected model.
  const saved=await page.evaluate(()=>window.fixture.session.messages);await page.reload();await page.waitForFunction(()=>window.fixture);
  await page.evaluate(({saved,locale})=>{window.fixture.session.messages=saved;window.fixture.setLocale(locale);window.fixture.props.refreshRevision=1;},{saved,locale});
  await page.getByText(copy['model.used'].replace('{model}','gemini-2.5-flash-lite'),{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
test('a removed explicit selection stays visible instead of changing to a catalog default',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{await page.addInitScript(()=>{let fixture;Object.defineProperty(window,'fixture',{configurable:true,get:()=>fixture,set:value=>{fixture=value;value.props.preferredModel='removed-model';}});});
  await page.goto(fixture.origin+'/resource-fixture');await page.waitForFunction(()=>window.fixture);
  const model=page.getByRole('combobox',{name:'Model',exact:true});await page.getByRole('option',{name:'Unavailable: removed-model',exact:true}).waitFor({state:'attached'});assert.equal(await model.inputValue(),'removed-model');assert.equal(await model.isDisabled(),false);
  await model.selectOption('auto');assert.equal(await model.inputValue(),'auto');
 }finally{await context.close();}
});

test('imported unknown model stays unknown through local reload and JSON roundtrip',{timeout:30000},async()=>{
 const context=await browser.newContext(),page=await context.newPage();
 try{
  await page.goto(fixture.origin+'/resource-fixture');await page.waitForFunction(()=>window.fixture);
  const models=await page.evaluate(async()=>{
   const {parseImportedChatJson}=await import('/src/features/chat/chatImport.ts');
   const {saveChats,loadChats}=await import('/src/features/chat/chatStorage.ts');
   const {sanitizeChatForExport}=await import('/src/features/chat/chatExportFormatters.ts');
   const imported=parseImportedChatJson(JSON.stringify({model:'gemini-3.1-flash-lite',messages:[
    {role:'assistant',content:'History without recorded model'},
    {role:'assistant',content:'History with recorded model',model:'gemini-2.5-flash'},
    {role:'assistant',content:'Failed request',model:'gemini-3.1-flash-lite',isError:true},
   ]}));
   saveChats([imported]);const restored=parseImportedChatJson(JSON.stringify({type:'qa-chat',chat:sanitizeChatForExport(loadChats()[0])}));
   window.fixture.session.messages=restored.messages;window.fixture.props.refreshRevision++;
   return restored.messages.map(message=>message.model);
  });
  assert.deepEqual(models,['','gemini-2.5-flash','gemini-3.1-flash-lite']);
  await page.getByText('History without recorded model',{exact:true}).waitFor();
  await page.getByText('Model used: gemini-2.5-flash',{exact:true}).waitFor();
  assert.equal(await page.getByText('Model used: gemini-3.1-flash-lite',{exact:true}).count(),0);
  assert.equal(await page.getByText(/^Model used:/).count(),1);
 }finally{await context.close();}
});

test('PostgreSQL unified session DTO retains unknown/original models and error flags in Vue',{
 timeout:30000,skip:process.env.ODDPATH_MODEL_HISTORY_DTO_FILE?false:'Run the guarded PostgreSQL suite with ODDPATH_MODEL_HISTORY_DTO_FILE first',
},async()=>{
 const {session}=JSON.parse(await readFile(process.env.ODDPATH_MODEL_HISTORY_DTO_FILE,'utf8'));
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  // Set the returned messages before the real SessionPage performs its first
  // fetch, then repeat on reload. The fixture changes only the API transport.
  await page.addInitScript(messages=>{let fixture;Object.defineProperty(window,'fixture',{configurable:true,get:()=>fixture,set:value=>{fixture=value;value.session.messages=messages;}});},session.messages);
  for(let read=0;read<2;read++){
   if(read===0)await page.goto(fixture.origin+'/resource-fixture');else await page.reload();
   await page.getByText('Imported unknown source',{exact:true}).waitFor();
   await page.getByText('Imported failed request',{exact:true}).waitFor();
   await page.getByText('Model used: gpt-source-model',{exact:true}).waitFor();
   await page.getByText('Model used: gemini-2.5-flash',{exact:true}).waitFor();
   assert.equal(await page.getByText('Model used: gemini-3.1-flash-lite',{exact:true}).count(),0);
   assert.equal(await page.getByText(/^Model used:/).count(),2);
  }
  const flags=await page.evaluate(async session=>{
   const {testSessionTranscript}=await import('/src/features/test-sessions/sessionPresentation.ts');
   const {sanitizeChatForExport}=await import('/src/features/chat/chatExportFormatters.ts');
   const {parseImportedChatJson}=await import('/src/features/chat/chatImport.ts');
   const exported=sanitizeChatForExport(testSessionTranscript(session,'Informational history'));
   const restored=parseImportedChatJson(JSON.stringify({type:'qa-chat',chat:exported}));
   window.fixture.session.messages=restored.messages;window.fixture.props.refreshRevision++;
   return restored.messages.map(message=>({model:message.model,isError:message.isError===true}));
  },session);
  assert.deepEqual(flags,[{model:'',isError:false},{model:'gpt-source-model',isError:false},{model:'gemini-3.1-flash-lite',isError:true},{model:'gemini-2.5-flash',isError:false},{model:'',isError:false}]);
  await page.getByText('Model used: gpt-source-model',{exact:true}).waitFor();
  assert.equal(await page.getByText('Model used: gemini-3.1-flash-lite',{exact:true}).count(),0);
  assert.equal(await page.getByText(/^Model used:/).count(),2);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});

test('native account PostgreSQL DTO retains known models in Vue and transcript JSON roundtrip',{
 timeout:30000,skip:process.env.ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE?false:'Run the guarded PostgreSQL suite with ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE first',
},async()=>{
 const {session}=JSON.parse(await readFile(process.env.ODDPATH_NATIVE_MODEL_HISTORY_DTO_FILE,'utf8'));
 const context=await browser.newContext(),page=await context.newPage(),errors=[];
 page.on('pageerror',error=>errors.push(error.message));
 try{
  await page.addInitScript(messages=>{let fixture;Object.defineProperty(window,'fixture',{configurable:true,get:()=>fixture,set:value=>{fixture=value;value.session.messages=messages;}});},session.messages);
  for(let read=0;read<2;read++){
   if(read===0)await page.goto(fixture.origin+'/resource-fixture');else await page.reload();
   await page.getByText('Native archive known Gemini response',{exact:true}).waitFor();
   await page.getByText('Model used: gemini-2.5-flash',{exact:true}).waitFor();
   await page.getByText('Model used: gpt-source-model',{exact:true}).waitFor();
   assert.equal(await page.getByText('Model used: gemini-3.1-flash-lite',{exact:true}).count(),0);
   assert.equal(await page.getByText(/^Model used:/).count(),2);
  }
  const restored=await page.evaluate(async session=>{
   const {testSessionTranscript}=await import('/src/features/test-sessions/sessionPresentation.ts');
   const {sanitizeChatForExport}=await import('/src/features/chat/chatExportFormatters.ts');
   const {parseImportedChatJson}=await import('/src/features/chat/chatImport.ts');
   const imported=parseImportedChatJson(JSON.stringify({type:'qa-chat',chat:sanitizeChatForExport(testSessionTranscript(session,'Informational history'))}));
   window.fixture.session.messages=imported.messages;window.fixture.props.refreshRevision++;
   return imported.messages.map(message=>({id:message.id,model:message.model,isError:message.isError===true}));
  },session);
  assert.deepEqual(restored.map(({model,isError})=>({model,isError})),[{model:'gemini-2.5-flash',isError:false},{model:'gpt-source-model',isError:false},{model:'',isError:false},{model:'gemini-3.1-flash-lite',isError:true}]);
  await page.locator(`[data-message-id="${restored[0].id}"]`).first().waitFor();
  assert.equal(await page.getByText(/^Model used:/).count(),2);
  assert.equal(await page.getByText('Model used: gemini-3.1-flash-lite',{exact:true}).count(),0);
  assert.deepEqual(errors,[]);
 }finally{await context.close();}
});
