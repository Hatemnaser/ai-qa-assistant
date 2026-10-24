import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {writeFile} from 'node:fs/promises';

export async function stackBrowser({appOrigin,apiOrigin,password,spki,check,output}){
 const browser=await chromium.launch({headless:true,args:['--host-resolver-rules=MAP *.oddpath.test 127.0.0.1','--ignore-certificate-errors-spki-list='+spki]});
 const context=await browser.newContext({locale:'en-US'}),page=await context.newPage();
 let receivedFrames=0;context.on('page',p=>p.on('websocket',socket=>socket.on('framereceived',()=>receivedFrames++)));
 const errors=[],responses=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.status()>=400){const u=new URL(r.url());responses.push({path:u.origin+u.pathname,status:r.status()});}});
 // This trusts only the generated fixture key. General TLS errors are not ignored.
 await page.goto(appOrigin+'/#/login');
 await page.locator('input[type=email]').fill('stack@example.test');
 await page.locator('input[type=password]').fill(password);
 const login=page.waitForResponse(r=>r.url()===apiOrigin+'/api/auth/login');
 await page.locator('button[type=submit]').click();assert.equal((await login).status(),200);
 await check('actual-built-frontend-login-over-TLS-with-Secure-cookie',(await context.cookies()).some(c=>c.name.includes('session')&&c.secure&&c.httpOnly));
 return {
  async open(qa){
   const previousFrames=receivedFrames;
   await page.goto(appOrigin+'/#/chat?projectId='+qa.projectId+'&sessionId='+qa.sessionId+'&requestId='+qa.requestId);
   // Fixtures create projects server-side; reload the account index rather than
   // assuming an already-mounted UI knows about the out-of-band new project.
   await page.reload();
   const details=page.getByRole('button',{name:'Review decision',exact:true});
   // The real responsive dock intentionally collapses its action details.
   // Open the existing control as a user would; do not force CSS/DOM state.
   await details.waitFor({timeout:30000});
   if(await details.getAttribute('aria-expanded')==='false')await details.click();
   await page.getByRole('button',{name:'Begin sign-in',exact:true}).waitFor({timeout:45000});
   await page.getByRole('button',{name:'Begin sign-in',exact:true}).click();
   await page.getByRole('button',{name:'Get browser link',exact:true}).waitFor({timeout:30000});
   await page.getByRole('button',{name:'Get browser link',exact:true}).click();
   const [popup]=await Promise.all([page.waitForEvent('popup'),page.getByRole('link',{name:'Open sign-in browser',exact:true}).click()]);
   await popup.locator('canvas').waitFor({timeout:30000});
   await popup.waitForFunction(()=>{
    const c=document.querySelector('canvas');if(!c||c.width<320||c.height<240)return false;
    const p=c.getContext('2d').getImageData(0,0,c.width,c.height).data,colors=new Set();
    for(let n=0;n<p.length;n+=4096)colors.add(p[n]+','+p[n+1]+','+p[n+2]);return colors.size>2;
   },{},{timeout:20000});
   for(let n=0;receivedFrames===previousFrames&&n<100;n++)await new Promise(r=>setTimeout(r,100));
   assert.ok(receivedFrames>previousFrames,'noVNC must receive real WebSocket frames');
   await popup.screenshot({path:output+'/viewer.png'});
   await check('viewer-opens-from-real-session-UI-with-noVNC-WebSocket-frames',true);
   return popup;
  },
  async complete(){await page.getByRole('button',{name:'I finished signing in — start the approved test',exact:true}).click();},
  async stop(){await page.getByRole('region',{name:'Private browser sign-in'}).getByRole('button',{name:'Stop',exact:true}).click();},
  async reload(){await page.reload();},
  async close(){await check('built-frontend-no-uncaught-page-errors',errors.length===0);await browser.close();},
  async abort(){try{await writeFile(output+'/browser-failure.json',JSON.stringify({errors,responses,body:await page.locator('body').innerText()},null,2));await page.screenshot({path:output+'/browser-failure.png'});}finally{await browser.close();}},
 };
}
