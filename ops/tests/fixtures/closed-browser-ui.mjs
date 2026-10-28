import assert from 'node:assert/strict';
import {chromium} from '/opt/oddpath/node_modules/playwright/index.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const input=JSON.parse(process.env.ODDPATH_CLOSED_UI),state={status:'STARTING',checks:[],errors:[]};
const save=async()=>{await writeFile('/evidence/state.next',JSON.stringify(state),{mode:0o600});await rename('/evidence/state.next','/evidence/state.json');};
const browser=await chromium.launch({executablePath:'/usr/bin/google-chrome-stable',chromiumSandbox:true,headless:true,args:['--disable-setuid-sandbox','--host-resolver-rules='+[input.appOrigin,input.apiOrigin,input.viewerOrigin].map(value=>'MAP '+new URL(value).hostname+' '+input.gatewayIp).join(', '),'--ignore-certificate-errors-spki-list='+input.spki]});
let popup,page;
try{
 const context=await browser.newContext({locale:'en-US',viewport:{width:1440,height:1000}});page=await context.newPage();
 page.on('pageerror',error=>state.errors.push(error.message));let frames=0;
 context.on('page',p=>p.on('websocket',s=>s.on('framereceived',()=>frames++)));
 await page.goto(input.appOrigin+'/#/login');await page.locator('input[type=email]').fill('stack@example.test');await page.locator('input[type=password]').fill(input.password);
 const authenticated=page.waitForResponse(r=>r.url()===input.apiOrigin+'/api/auth/login');await page.locator('button[type=submit]').click();assert.equal((await authenticated).status(),200);
 assert((await context.cookies()).some(c=>c.name.includes('session')&&c.secure&&c.httpOnly));state.checks.push('actual frontend production HTTPS authentication');state.status='READY';await save();let seen='';
 for(;;){
  let command;try{command=JSON.parse(await readFile('/tmp/closed-ui-command.json','utf8'));}catch{await delay(100);continue;}
  if(command.id===seen){await delay(100);continue;}seen=command.id;state.commandId=seen;
  if(command.action==='open'){
   if(popup){await popup.close();popup=null;}const qa=command.qa,oldFrames=frames;
   await page.goto(input.appOrigin+'/#/chat?projectId='+qa.projectId+'&sessionId='+qa.sessionId+'&requestId='+qa.requestId);await page.reload();
   const details=page.getByRole('button',{name:'Review decision',exact:true});await details.waitFor({timeout:30000});if(await details.getAttribute('aria-expanded')==='false')await details.click();
   const panel=page.locator('.qa-run-approval');await panel.waitFor({state:'visible',timeout:30000});
   const setup=panel.getByRole('button',{name:'Runner & Recipe details',exact:true});
   if(await setup.count()){if(await setup.getAttribute('aria-expanded')==='false')await setup.click();}else{const details=panel.locator('details').first();if(await details.getAttribute('open')===null)await details.locator('summary').first().click();}
   const profiles=page.getByRole('combobox',{name:/Runner profile/});await profiles.waitFor();
   const manual=profiles.locator('option').filter({hasText:'manual login'}).first();await manual.waitFor({state:'attached',timeout:30000});await profiles.selectOption(await manual.getAttribute('value'));await profiles.press('Escape');
   const approve=panel.locator('.qa-run-approval__confirmation input[type=checkbox]').first();await approve.check();
   const queued=page.waitForResponse(r=>r.request().method()==='POST'&&r.url()===input.apiOrigin+'/api/projects/'+qa.projectId+'/qa/requests/'+qa.requestId+'/runs');
   await panel.getByRole('button',{name:'Approve & run',exact:true}).click();const receipt=await queued;assert.equal(receipt.status(),201);const accepted=await receipt.json();state.execution={executionId:accepted.executionId,runId:accepted.runId};state.checks.push('immutable approval and queue from actual UI');state.status='QUEUED';await save();
   await page.getByText('Work in progress on the current request',{exact:true}).waitFor({timeout:30000});if(await details.getAttribute('aria-expanded')==='false')await details.click();
   await page.getByRole('button',{name:'Begin sign-in',exact:true}).waitFor({timeout:45000});await page.getByRole('button',{name:'Begin sign-in',exact:true}).click();
   await page.getByRole('button',{name:'Get browser link',exact:true}).waitFor({timeout:30000});await page.getByRole('button',{name:'Get browser link',exact:true}).click();
   [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'Open sign-in browser',exact:true}).click()]);
   await popup.locator('canvas').waitFor({timeout:30000});await popup.waitForFunction(()=>{const c=document.querySelector('canvas');if(!c||c.width<320||c.height<240)return false;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();for(let n=0;n<b.length;n+=4096)colors.add(b[n]+','+b[n+1]+','+b[n+2]);return colors.size>2;},null,{timeout:20000});
   assert(frames>oldFrames,'Actual noVNC WebSocket must deliver framebuffer data');assert.equal(new URL(popup.url()).hash,'');state.frames=frames;state.checks.push('actual HTTPS/WSS noVNC framebuffer from UI grant');
   // Also exercise the embedded per-session resource, not only the popup.
   const pageUrl=page.url(),embeddedBefore=frames;
   await page.locator('.test-session__header-actions').getByRole('button',{name:'Browser',exact:true}).click();
   const resources=page.locator('#session-resources-panel');await resources.waitFor({state:'visible'});
   await resources.getByRole('button',{name:'Get browser link',exact:true}).click();
   const embedded=page.frameLocator('iframe.session-browser-frame');await embedded.locator('canvas').waitFor({timeout:30000});
   await resources.getByText('Browser display connected',{exact:true}).waitFor({timeout:30000});
   const embeddedFrame=page.frames().find(frame=>frame.parentFrame()&&frame.url().startsWith(input.viewerOrigin+'/r/'));
   assert(embeddedFrame,'The actual cross-origin viewer frame must exist');
   await embeddedFrame.waitForFunction(()=>{const c=document.querySelector('canvas');if(!c||c.width<320||c.height<240)return false;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();for(let n=0;n<b.length;n+=4096)colors.add(b[n]+','+b[n+1]+','+b[n+2]);return colors.size>2;},null,{timeout:20000});
   assert.equal(new URL(embeddedFrame.url()).hash,'','Embedded bootstrap must exchange the fragment capability');
   assert.equal(page.url(),pageUrl,'Embedded browser must not navigate the main session');
   assert.equal(new URL(page.url()).origin,input.appOrigin);
   await page.screenshot({path:'/evidence/embedded-browser.png'});
   const picker=resources.getByRole('combobox',{name:'Open a resource',exact:true});await picker.selectOption('sources');
   await page.locator('iframe.session-browser-frame').waitFor({state:'detached',timeout:10000});
   assert.equal(page.url(),pageUrl,'Resource switching must retain the current session');
   await resources.getByRole('tab',{name:'Browser',exact:false}).click();
   await resources.getByText('View disconnected',{exact:true}).waitFor({timeout:10000});
   assert.equal(await page.locator('iframe.session-browser-frame').count(),0,'Returning to a tab must not replay a viewer grant');
   await resources.getByRole('button',{name:'Hide tabs',exact:true}).click();
   state.checks.push('per-session embedded browser, Sources tab switch and no automatic grant replay');state.status='VIEWER_OPEN';await save();
  }else if(command.action==='complete'){
   await page.getByRole('button',{name:'I finished signing in — start the approved test',exact:true}).click();state.status='ACTION_SENT';await save();
  }else if(command.action==='stop'){
   await page.getByRole('region',{name:'Private browser sign-in'}).getByRole('button',{name:'Stop',exact:true}).click();state.status='ACTION_SENT';await save();
  }else if(command.action==='check-revoked'){
   await popup.getByText('Browser disconnected',{exact:true}).waitFor({timeout:30000});const status=await popup.evaluate(async()=>{const response=await fetch(location.href,{credentials:'same-origin',cache:'no-store',redirect:'error'});return response.status;});assert.equal(status,403);state.checks.push('old viewer cookie denied after physical Stop/recovery');state.status='REVOKED';await save();
  }else if(command.action==='reload'){
   if(popup){await popup.close();popup=null;}await page.reload();await page.getByRole('button',{name:'Review decision',exact:true}).waitFor({timeout:30000});state.status='RELOADED';await save();
  }else if(command.action==='finish'){
   assert.deepEqual(state.errors,[]);state.status='PASS';await save();break;
  }else throw Error('Unknown observer command');
 }
}catch(error){state.status='FAIL';state.error=String(error.stack||error);state.visibleText=await page?.locator('body').innerText().catch(()=>undefined);state.formControls=await page?.getByRole('combobox').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,label:n.closest('label')?.textContent,visible:!!n.getClientRects().length}))).catch(()=>undefined);await save();console.log(JSON.stringify({status:'FAIL',error:state.error}));process.exitCode=1;}
finally{await browser.close();}
