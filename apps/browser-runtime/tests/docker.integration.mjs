import { before, after, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { randomUUID, randomBytes } from 'node:crypto';
import { DockerRuntimeDriver } from '../src/docker-driver.mjs';
import { RuntimeJournal } from '../src/journal.mjs';
import { BrowserSupervisor } from '../src/supervisor.mjs';
import { signGrant } from '../src/viewer-grants.mjs';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createSessionResourceFixture } from '../../web/tests/fixtures/session-resources.browser-fixture.mjs';
import {assertSupervisorImageParity} from './image-parity.mjs';

if (process.env.ODDPATH_BROWSER_DOCKER_TESTS !== '1') throw new Error('Explicit disposable Docker test acknowledgement required.');
const run = promisify(execFile);
const docker = async (args, timeout = 30_000) => (await run('docker', args, { timeout, maxBuffer: 2 * 1024 * 1024 })).stdout.trim();
const suffix = randomUUID(), instanceId = `phase2-test-${suffix}`, controller = `oddpath-phase2-controller-${suffix}`;
const chromeTestImage=process.env.ODDPATH_CHROME_TEST_IMAGE || 'oddpath/chrome-runtime:phase-02';
const egressTestImage=process.env.ODDPATH_EGRESS_TEST_IMAGE || 'oddpath/browser-egress:phase-02';
const allocations = [], results = {};
let driver, delayedDriver, delayedImage;
async function probe(script) {
  return JSON.parse(await docker(['exec', controller, 'node', '--input-type=module', '-e', script]));
}
async function allocation(leaseMs = 45_000, executionMs = 120_000, managed = false, runtimeDriver = driver, manual = false, preparationMs = 60000, manualExecutionMs = executionMs) {
  const input = { executionId: `execution-${randomUUID()}`, runtimeId: randomUUID(), token: randomBytes(32).toString('hex'),
    deadline: Date.now() + executionMs, leaseUntil: Date.now() + Math.min(leaseMs, executionMs), origins: ['https://example.com'] };
  allocations.push(input.runtimeId);
  if (manual) { input.origins.push('https://example.org','https://www.iana.org');input.manual = { baseUrl: 'https://example.com/', authenticationOrigins: ['https://example.org'], executionTimeoutMs: Math.min(600000,manualExecutionMs) }; input.preparationDeadline = Date.now()+preparationMs; }
  const endpoint = managed ? (await probe(`const {DockerRuntimeDriver}=await import('./apps/browser-runtime/src/docker-driver.mjs');const driver=new DockerRuntimeDriver(${JSON.stringify({ instanceId, supervisorContainer: controller, chromeImage: driver.chromeImage, egressImage: driver.egressImage })});console.log(JSON.stringify({endpoint:await driver.start(${JSON.stringify(input)})}));`)).endpoint : await runtimeDriver.start(input);
  // Normal test executions renew their private lease, like the real worker.
  // Explicit watchdog/deadline tests deliberately omit this fixture heartbeat.
  if (leaseMs === 45_000) await docker(['exec','--detach',controller,'node','--input-type=module','-e',`const endpoint=${JSON.stringify(endpoint)},token=${JSON.stringify(input.token)},deadline=${input.deadline};const timer=setInterval(async()=>{if(Date.now()>=deadline){clearInterval(timer);return;}try{await fetch(endpoint+'/lease',{method:'POST',headers:{authorization:'Bearer '+token,'x-oddpath-lease-ms':String(Math.min(Date.now()+45000,deadline))},signal:AbortSignal.timeout(1000)});}catch{}},5000);`]);
  const names = driver.names(input.runtimeId);
  return { ...input, endpoint, ...names };
}
function connection(runtime) {
  return `const endpoint=${JSON.stringify(runtime.endpoint)},token=${JSON.stringify(runtime.token)};
    let data;for(let i=0;i<20;i++){try{const r=await fetch(endpoint+'/cdp/json/version',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(1000)});if(r.ok){data=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,100));}
    if(!data)throw Error('Chrome never became ready');
    const {chromium}=await import('playwright');
    const browser=await chromium.connectOverCDP(endpoint.replace(/^http/,'ws')+'/cdp'+new URL(data.webSocketDebuggerUrl).pathname,{headers:{authorization:'Bearer '+token},timeout:5000});
    const context=browser.contexts()[0],page=context.pages()[0]||await context.newPage();`;
}
// Dimensions and screenshot size also pass for a blank noVNC framebuffer.
// Check known pixels delivered by the real RFB stream, with JPEG tolerance.
async function framebufferPixels(page, color) {
  const frame = await page.waitForFunction(expected => {
    const canvas = document.querySelector('#screen canvas');
    if (!canvas?.width || !canvas.height) return false;
    const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
    let matches = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      if (Math.abs(pixels[i] - expected[0]) <= 3 && Math.abs(pixels[i + 1] - expected[1]) <= 3 && Math.abs(pixels[i + 2] - expected[2]) <= 3) matches++;
    }
    return matches > 100_000 ? matches : false;
  }, color, { timeout: 15000 });
  try { return await frame.jsonValue(); } finally { await frame.dispose(); }
}

describe('disposable production Chrome isolation and lifecycle', { concurrency: false }, () => {
  before(async () => {
    await assertSupervisorImageParity(docker,process.env.ODDPATH_SUPERVISOR_TEST_IMAGE || 'oddpath/browser-supervisor:phase-02');
    const chromeImage = await docker(['image','inspect',chromeTestImage,'--format','{{.Id}}']);
    const egressImage = await docker(['image','inspect',egressTestImage,'--format','{{.Id}}']);
    await docker(['run','--detach','--name',controller,'--label','oddpath.test=phase-02','--network','bridge','--publish','127.0.0.1::8081','--volume','/var/run/docker.sock:/var/run/docker.sock','--entrypoint','node',
      process.env.ODDPATH_SUPERVISOR_TEST_IMAGE || 'oddpath/browser-supervisor:phase-02','-e','setInterval(()=>{},1000)']);
    driver = new DockerRuntimeDriver({ instanceId, supervisorContainer: controller, chromeImage, egressImage });
    delayedImage = `oddpath/chrome-runtime:viewer-startup-${suffix}`;
    await docker(['build', '--network', 'none', '--build-arg', 'CHROME_IMAGE='+chromeTestImage,
      '--label', `oddpath.fixture=${suffix}`, '-t', delayedImage,
      fileURLToPath(new URL('./fixtures/viewer-startup', import.meta.url))], 90_000);
    const delayedDigest = await docker(['image', 'inspect', delayedImage, '--format', '{{.Id}}']);
    delayedDriver = new DockerRuntimeDriver({ instanceId, supervisorContainer: controller, chromeImage: delayedDigest, egressImage });
    results.images = { chromeImage, egressImage };
  });
  after(async () => {
    for (const runtimeId of allocations) await driver?.stop(runtimeId).catch(() => {});
    const label = await docker(['inspect',controller,'--format','{{index .Config.Labels "oddpath.test"}}']);
    assert.equal(label, 'phase-02'); await docker(['rm','--force',controller]);
    const imageLabel = await docker(['image', 'inspect', delayedImage, '--format', '{{index .Config.Labels "oddpath.fixture"}}']);
    assert.equal(imageLabel, suffix); await docker(['image', 'rm', delayedImage]);
    console.log('Sanitized browser runtime evidence:', JSON.stringify(results));
  });
  it('runs Chrome Stable non-root with namespace/seccomp sandbox and private bounded services', async () => {
    results.supervisorDocker = await docker(['exec',controller,'docker','version','--format','{{.Client.Version}} / {{.Server.Version}}']);
    const runtime = await allocation(45_000, 120_000, true);
    try {
      const info = await driver.inspect(runtime.browser);
      assert.equal(info.Config.User, '10001:10001'); assert.equal(info.HostConfig.ReadonlyRootfs, true);
      assert.deepEqual(info.HostConfig.PortBindings, {}); assert.equal(info.HostConfig.Privileged, false);
      assert.equal(info.HostConfig.PidsLimit, 256); assert.equal(info.HostConfig.Memory, 1200 * 1024 * 1024);
      assert.equal(info.Mounts.some(mount => mount.Type === 'bind'), false);
      assert.equal(info.Config.Env.some(value => /^(DATABASE_URL|GEMINI_API_KEY|SMTP_PASSWORD|ODDPATH_TOKEN)=/u.test(value)), false);
      const observed = await probe(`${connection(runtime)}await page.goto('chrome://sandbox');console.log(JSON.stringify({version:browser.version(),sandbox:await page.locator('body').innerText()}));await browser.close();`);
      assert.match(observed.sandbox, /Layer 1 Sandbox\s+Namespace/iu);
      assert.match(observed.sandbox, /PID namespaces\s+Yes/iu);
      assert.match(observed.sandbox, /Network namespaces\s+Yes/iu);
      assert.match(observed.sandbox, /Seccomp-BPF sandbox\s+Yes/iu);
      results.chrome = observed;
    } finally { await driver.stop(runtime.runtimeId); }
  });
  it('runs an approved navigation/assertion through pinned public egress and serves real noVNC', async () => {
    const runtime = await allocation();
    try {
      const observed = await probe(`const {createManagedPlaywrightSession}=await import('@oddpath/runner');
        ${connection(runtime)}await browser.close();
        const session=await createManagedPlaywrightSession(endpoint,token,'https://example.com');await session.navigate('https://example.com/','domcontentloaded',15000);
        await session.expect({kind:'visible',locator:{by:'text',value:'This domain is for use in documentation examples'}},5000);
        const image=await session.screenshot();const vnc=await fetch(endpoint+'/viewer/core/rfb.js',{headers:{authorization:'Bearer '+token}});
        const unauthorized=await fetch(endpoint+'/cdp/json/version');
        const {request}=await import('node:http');
        const rfb=await new Promise((resolve,reject)=>{let socket;const timer=setTimeout(()=>{socket?.destroy();reject(Error('noVNC handshake timeout'));},5000);const req=request(endpoint+'/viewer/websockify',{headers:{authorization:'Bearer '+token,connection:'Upgrade',upgrade:'websocket','sec-websocket-key':Buffer.alloc(16).toString('base64'),'sec-websocket-version':'13','sec-websocket-protocol':'binary'}});req.on('error',reject);req.on('upgrade',(_r,s)=>{socket=s;s.on('error',reject);s.once('data',bytes=>{clearTimeout(timer);resolve(bytes.toString('ascii'));s.destroy();});});req.end();});
        console.log(JSON.stringify({url:session.currentUrl(),screenshotBytes:image.length,noVNC:vnc.status,rfb,unauthorized:unauthorized.status}));await session.close();`);
      assert.equal(observed.noVNC, 200); assert.equal(observed.unauthorized, 403); assert.ok(observed.screenshotBytes > 1_000);
      assert.match(observed.rfb, /RFB 003\.008/u);
      results.navigation = observed;
    } finally { await driver.stop(runtime.runtimeId); }
  });
  it('blocks direct Internet/metadata access outside the proxy and unapproved CONNECT hosts', async () => {
    const runtime = await allocation();
    try {
      const network = await driver.inspectNetwork(runtime.network);
      assert.equal(network.Options['com.docker.network.bridge.gateway_mode_ipv4'], 'isolated');
      const hostBridge = network.IPAM.Config[0].Subnet.split('/')[0].replace(/\.0$/u, '.1');
      const out = JSON.parse(await docker(['exec',runtime.browser,'node','--input-type=module','-e',
        `const {connect}=await import('node:net');const result={};for(const [key,[host,port]] of Object.entries({internet:['example.com',443],metadata:['169.254.169.254',80],host:['host.docker.internal',5432],hostBridge:[${JSON.stringify(hostBridge)},5432]})){result[key]=await new Promise(resolve=>{const socket=connect({host,port,timeout:1500});socket.once('connect',()=>{socket.destroy();resolve('REACHABLE');});socket.once('error',()=>resolve('BLOCKED'));socket.once('timeout',()=>{socket.destroy();resolve('BLOCKED');});});}console.log(JSON.stringify(result));`]));
      assert.deepEqual(out, { internet: 'BLOCKED', metadata: 'BLOCKED', host: 'BLOCKED', hostBridge: 'BLOCKED' });
      const blocked = await probe(`${connection(runtime)}let blocked=false;try{await page.goto('https://google.com',{timeout:5000});}catch{blocked=true;}console.log(JSON.stringify({blocked}));await browser.close();`);
      assert.equal(blocked.blocked, true); results.network = out;
    } finally { await driver.stop(runtime.runtimeId); }
  });
  it('keeps prior evidence and reports renderer crash as execution failure while Chrome stays responsive', async () => {
    const fixtureUrl = new URL('../../runner/tests/fixtures.ts', import.meta.url).href;
    const fixture = JSON.parse((await run(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `const {managedClaimedExecution}=await import(${JSON.stringify(fixtureUrl)});console.log(JSON.stringify(managedClaimedExecution()));`],
    { cwd: fileURLToPath(new URL('../../../', import.meta.url)), timeout: 10_000 })).stdout);
    const runtime = await allocation();
    try {
      const observed = await probe(`${connection(runtime)}
        const {executeClaim,createManagedPlaywrightSession,hashCanonicalJson}=await import('@oddpath/runner');
        const claim=${JSON.stringify(fixture)},task=claim.task;
        task.recipe.bundle.items[0].steps=[{action:'navigate',path:'/',ref:'open',waitUntil:'domcontentloaded',timeoutMs:15000},
          {action:'expect',ref:'verify',expectation:{kind:'visible',locator:{by:'text',value:'Oddpath crash marker'}},timeoutMs:1000}];
        task.artifact.items.push({...structuredClone(task.artifact.items[0]),id:'item-2',title:'Second item'});
        task.recipe.bundle.items.push({...structuredClone(task.recipe.bundle.items[0]),checklistItemId:'item-2'});
        task.recipe.hash=claim.claim.recipeHash=task.approval.recipeHash=hashCanonicalJson(task.recipe.bundle);
        const {bindingHash,...approval}=task.approval;
        task.approval.bindingHash=hashCanonicalJson({...approval,authentication:task.profile.authentication,executionLimits:task.profile.executionLimits,candidate:task.profile.target.candidate});
        let version=1,checks=0;
        const evidence={pageCrash:false,browserStillResponsive:false,passedBeforeCrash:false,recorded:[],finished:false,failure:null,terminated:false};
        const receipt=(status='RUNNING')=>({executionId:task.executionId,runId:task.runId,runVersion:version++,status,requestPhase:'RUNNING',leaseExpiresAt:new Date(Date.now()+45000).toISOString()});
        const client={accept:async()=>receipt(),heartbeat:async()=>receipt(),
          recordItem:async(_id,item,_lease,value)=>{evidence.recorded.push({item,status:value.status,evidence:value.evidence});return receipt();},
          finish:async()=>{evidence.finished=true;return receipt('SUCCEEDED');},fail:async(_id,_lease,value)=>{evidence.failure=value.code;return receipt('FAILED');},
          completeEvidenceUpload:async()=>{throw Error('Unexpected binary evidence');},initiateEvidenceUpload:async()=>{throw Error('Unexpected binary evidence');},uploadEvidenceBytes:async()=>{throw Error('Unexpected binary evidence');}};
        await executeClaim(claim,{allowProduction:false,client,profiles:[],logger:{info(){},warn(){},error(){}},heartbeatIntervalMs:5000,
          createSession:async()=>{const session=await createManagedPlaywrightSession(endpoint,token,task.profile.target.baseUrl),original=session.expect.bind(session);
            session.expect=async(expectation,timeout)=>{
              await page.evaluate(()=>{const marker=document.createElement('p');marker.textContent='Oddpath crash marker';document.body.append(marker);});
              await original(expectation,timeout);
              if(++checks===2){evidence.passedBeforeCrash=true;const cdp=await context.newCDPSession(page),crashed=page.waitForEvent('crash',{timeout:5000});
                void cdp.send('Page.crash').catch(()=>{});await crashed;evidence.pageCrash=true;
                evidence.browserStillResponsive=(await fetch(endpoint+'/cdp/json/version',{headers:{authorization:'Bearer '+token}})).ok;
                return original(expectation,timeout);}
            };return session;},
          managedV2:{profileHashes:[task.profile.manifestHash],beforeSteps:async()=>{},terminate:async()=>{evidence.terminated=true;},
            assertRuntimeLive:async()=>{if(!(await fetch(endpoint+'/cdp/json/version',{headers:{authorization:'Bearer '+token}})).ok)throw Error('Runtime unavailable');}}});
        await browser.close();console.log(JSON.stringify(evidence));`);
      assert.equal(observed.pageCrash, true); assert.equal(observed.browserStillResponsive, true);
      assert.equal(observed.passedBeforeCrash, true); assert.equal(observed.finished, false);
      assert.equal(observed.failure, 'BROWSER_SESSION_UNAVAILABLE'); assert.equal(observed.terminated, true);
      assert.equal(observed.recorded.length, 1); assert.equal(observed.recorded[0].item, 'item-1');
      assert.equal(observed.recorded[0].status, 'PASS'); assert.equal(observed.recorded[0].evidence[0].kind, 'TEXT');
      results.rendererCrash = observed;
    } finally { await driver.stop(runtime.runtimeId); }
  });
  for (const delayed of [false, true]) it(`renders the real owner-scoped noVNC framebuffer and disconnects it after physical Stop${delayed ? ' with delayed viewer startup' : ''}`, async () => {
    const runtime = await allocation(45_000, 120_000, false, delayed ? delayedDriver : driver), key = 'e'.repeat(64);
    const port = await docker(['inspect',controller,'--format','{{(index (index .NetworkSettings.Ports "8081/tcp") 0).HostPort}}']);
    const publicOrigin = `http://127.0.0.1:${port}`;
    const grant = { schemaVersion: 1, executionId: runtime.executionId, runtimeId: runtime.runtimeId, ownerId: 'viewer-fixture', projectId: 'viewer-project', bindingHash: 'b'.repeat(64), nonce: randomUUID(), expiresAt: Date.now() + 60000, mode: 'VIEW' };
    const input = { ...runtime, projectId: grant.projectId, bindingHash: grant.bindingHash };
    const gatewayScript = `const {RuntimeJournal}=await import('./apps/browser-runtime/src/journal.mjs');const {createViewerGateway}=await import('./apps/browser-runtime/src/viewer-gateway.mjs');const journal=new RuntimeJournal(':memory:');journal.reserve(${JSON.stringify(input)});journal.live(${JSON.stringify(runtime.executionId)});createViewerGateway({journal,driver:{async endpoint(){return ${JSON.stringify(runtime.endpoint)}}},signingKey:${JSON.stringify(key)},publicOrigin:${JSON.stringify(publicOrigin)},secure:false}).listen(8081,'0.0.0.0');`;
    const gatewayPid = Number(await docker(['exec',controller,'node','--input-type=module','-e',
      `const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(gatewayScript)}],{detached:true,stdio:'ignore'});child.unref();console.log(child.pid);`]));
    assert.ok(Number.isSafeInteger(gatewayPid) && gatewayPid > 1);
    let browser;
    try {
      for (let i=0;i<30;i++) { try { if ((await fetch(publicOrigin+'/open')).ok) break; } catch {} await new Promise(resolve=>setTimeout(resolve,100)); }
      await probe(`${connection(runtime)}await page.setContent('<!doctype html><body style="margin:0;background:rgb(210,30,45);min-height:100vh"><h1>Oddpath framebuffer fixture</h1></body>');await page.bringToFront();console.log('{}');await browser.close();`);
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext(), page = await context.newPage();
      await page.goto(publicOrigin + '/open#' + signGrant(grant, key));
      await page.waitForFunction(() => { const screen = document.querySelector('#screen canvas'); return screen?.width === 1440 && screen?.height === 900; }, null, { timeout: 15000 });
      assert.equal(new URL(page.url()).hash, '');
      const cookie = (await context.cookies()).find(value=>value.name==='oddpath_view'); assert.equal(cookie.httpOnly, true);
      const redPixels = await framebufferPixels(page, [210, 30, 45]);
      await probe(`${connection(runtime)}await page.evaluate(()=>{document.body.style.background='rgb(20,85,210)';});console.log('{}');await browser.close();`);
      const bluePixels = await framebufferPixels(page, [20, 85, 210]);
      assert.ok(await page.evaluate(() => {
        const canvas = document.querySelector('#screen canvas');
        const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
        let remainingRed = 0;
        for (let i = 0; i < pixels.length; i += 4) if (Math.abs(pixels[i] - 210) <= 3 && Math.abs(pixels[i + 1] - 30) <= 3 && Math.abs(pixels[i + 2] - 45) <= 3) remainingRed++;
        return remainingRed < 1000;
      }), 'The previous framebuffer must be replaced by the updated Chrome content');
      const bytes = await page.screenshot(); assert.ok(bytes.length > 1000);
      await driver.stop(runtime.runtimeId);
      await page.getByText('Browser disconnected', { exact: true }).waitFor({ timeout: 5000 });
      results[delayed ? 'delayedViewerFramebuffer' : 'viewerFramebuffer'] = { width: 1440, height: 900, redPixels, bluePixels, previousFrameReplaced: true, screenshotBytes: bytes.length, disconnectedAfterStop: true };
    } finally {
      await browser?.close(); await driver.stop(runtime.runtimeId);
      // The two viewer cases share a controller port; remove this case's own
      // gateway so its journal cannot answer the next case's ticket exchange.
      await docker(['exec',controller,'node','--input-type=module','-e',
        `const {readFileSync}=await import('node:fs');let command;try{command=readFileSync('/proc/${gatewayPid}/cmdline','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(command){if(!command.includes('createViewerGateway')||!command.includes(${JSON.stringify(runtime.executionId)}))throw Error('Gateway fixture ownership mismatch');process.kill(${gatewayPid},'SIGTERM');}`]);
    }
  });
  it('embeds the real Chrome framebuffer in SessionPage tabs and distinguishes view close from physical Stop', async () => {
    const runtime=await allocation(45_000,180_000),key='f'.repeat(64);
    const port=await docker(['inspect',controller,'--format','{{(index (index .NetworkSettings.Ports "8081/tcp") 0).HostPort}}']);
    const origin='http://127.0.0.1:'+port;
    let tickets=0,stops=0,gatewayPid,browser,fixture;
    const grant=()=>({schemaVersion:1,executionId:runtime.executionId,runtimeId:runtime.runtimeId,ownerId:'owner',projectId:'project',bindingHash:'b'.repeat(64),nonce:randomUUID(),expiresAt:Date.now()+60000,mode:'VIEW'});
    try {
      fixture=await createSessionResourceFixture({runtimeId:runtime.runtimeId,executionId:runtime.executionId,
        viewer:async()=>{tickets++;return {url:origin+'/open#'+signGrant(grant(),key)};},onStop:async()=>{stops++;await driver.stop(runtime.runtimeId);}});
      const input={...runtime,projectId:'project',ownerId:'owner',bindingHash:'b'.repeat(64)};
      // The allocation fixture renews the browser's lease. Its separate viewer
      // journal must follow accepted heartbeats too, as the supervisor does,
      // instead of silently expiring at 45 seconds on a busy test host.
      const leaseProofPath=`/tmp/embedded-lease-${runtime.runtimeId}.json`;
      const script=`const {RuntimeJournal}=await import('./apps/browser-runtime/src/journal.mjs');const {createViewerGateway}=await import('./apps/browser-runtime/src/viewer-gateway.mjs');const {writeFileSync}=await import('node:fs');const input=${JSON.stringify(input)},journal=new RuntimeJournal(':memory:');let renewals=0;const pulse=async()=>{const leaseUntil=Math.min(Date.now()+45000,input.deadline);const response=await fetch(${JSON.stringify(runtime.endpoint)}+'/lease',{method:'POST',headers:{authorization:'Bearer '+input.token,'x-oddpath-lease-ms':String(leaseUntil)},signal:AbortSignal.timeout(2000)});if(!response.ok)throw Error('Fixture browser heartbeat rejected');return leaseUntil;};input.leaseUntil=await pulse();journal.reserve(input);journal.live(input.executionId);setInterval(async()=>{try{const leaseUntil=await pulse();journal.renew(input.executionId,leaseUntil);renewals++;writeFileSync(${JSON.stringify(leaseProofPath)},JSON.stringify({renewals,leaseUntil,deadline:input.deadline}));}catch{}},5000);createViewerGateway({journal,driver:{async endpoint(){return ${JSON.stringify(runtime.endpoint)}}},signingKey:${JSON.stringify(key)},publicOrigin:${JSON.stringify(origin)},frameOrigin:${JSON.stringify(fixture.origin)},secure:false}).listen(8081,'0.0.0.0');`;
      gatewayPid=Number(await docker(['exec',controller,'node','--input-type=module','-e',`const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(script)}],{detached:true,stdio:'ignore'});child.unref();console.log(child.pid);`]));
      for(let index=0;index<30;index++){try{if((await fetch(origin+'/open')).ok)break;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
      await probe(`${connection(runtime)}await page.setContent('<!doctype html><body style="margin:0;background:rgb(210,30,45);min-height:100vh"><h1>Embedded Oddpath</h1></body>');await page.bringToFront();console.log('{}');await browser.close();`);
      browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage();
      await page.goto(fixture.origin+'/resource-fixture');await page.locator('.test-session__results-link').waitFor();
      await page.getByRole('button',{name:'Browser',exact:true}).click();const panel=page.locator('#session-resources-panel');
      await panel.getByRole('button',{name:'Connect browser view',exact:true}).click();
      await panel.getByText('Browser display connected',{exact:true}).waitFor({timeout:20000});
      const framed=page.frames().find(frame=>frame.url().startsWith(origin+'/r/'));assert.ok(framed);const pixels=await framebufferPixels(framed,[210,30,45]);
      assert.equal((await context.cookies()).find(cookie=>cookie.name==='oddpath_view')?.httpOnly,true);
      await panel.getByRole('button',{name:'Expand',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('iframe'));
      assert.equal(await panel.getByText('Browser display connected',{exact:true}).count(),0);assert.equal((await driver.inspect(runtime.browser)).State.Running,true);
      await page.setViewportSize({width:390,height:900});await panel.getByRole('button',{name:'Connect browser view',exact:true}).click();
      await panel.getByText('Browser display connected',{exact:true}).waitFor({timeout:20000});
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const mobileFrame=page.frames().find(frame=>frame.url().startsWith(origin+'/r/'));assert.ok(mobileFrame);await framebufferPixels(mobileFrame,[210,30,45]);
      await panel.getByRole('button',{name:'Hide tabs',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('iframe'));
      assert.equal(stops,0);assert.equal((await driver.inspect(runtime.browser)).State.Running,true);
      await page.getByRole('button',{name:'Show tabs',exact:true}).click();await panel.getByRole('button',{name:'Connect browser view',exact:true}).click();
      await panel.getByText('Browser display connected',{exact:true}).waitFor({timeout:20000});assert.equal(tickets,3);
      await panel.getByRole('button',{name:'Stop',exact:true}).click();await panel.getByText('Stop confirmed; browser processes exited.',{exact:true}).waitFor({timeout:15000});
      assert.equal(stops,1);assert.equal(await driver.inspect(runtime.browser),null);assert.equal(await page.locator('iframe').count(),0);
      const leaseProof=await probe(`const {readFileSync}=await import('node:fs');console.log(readFileSync(${JSON.stringify(leaseProofPath)},'utf8'));`);
      assert.ok(leaseProof.renewals>0);assert.ok(leaseProof.leaseUntil<=runtime.deadline);assert.equal(leaseProof.deadline,runtime.deadline);
      results.resourceTabs={realSessionPage:true,realIframe:true,pixels,layoutDisconnect:true,mobileFramebuffer:true,freshGrantAfterHide:true,hideDidNotStop:true,physicalStop:true,gatewayLeaseRenewals:leaseProof.renewals,gatewayLeaseBounded:true};
    } finally {
      await browser?.close();await fixture?.server.close();await driver.stop(runtime.runtimeId);
      if(gatewayPid)await docker(['exec',controller,'node','--input-type=module','-e',`const {readFileSync}=await import('node:fs');let command;try{command=readFileSync('/proc/${gatewayPid}/cmdline','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(command){if(!command.includes('createViewerGateway')||!command.includes(${JSON.stringify(runtime.executionId)}))throw Error('Gateway ownership mismatch');process.kill(${gatewayPid},'SIGTERM');}`]);
    }
  });
  it('isolates cookies, localStorage, files and container networks between two tenants', async () => {
    const a = await allocation(), b = await allocation();
    try {
      const fixturePage = `await context.route('https://example.com/**',route=>route.fulfill({contentType:'text/html',body:'<h1>Tenant fixture</h1>'}));await page.goto('https://example.com',{waitUntil:'domcontentloaded',timeout:5000});`;
      await probe(`${connection(a)}${fixturePage}await context.addCookies([{name:'tenant',value:'account-a',domain:'example.com',path:'/'}]);await page.evaluate(()=>localStorage.setItem('tenant','account-a'));console.log('{}');await browser.close();`);
      const other = await probe(`${connection(b)}${fixturePage}console.log(JSON.stringify({cookies:await context.cookies(),storage:await page.evaluate(()=>localStorage.getItem('tenant'))}));await browser.close();`);
      assert.equal(other.storage, null); assert.equal(other.cookies.some(cookie => cookie.name === 'tenant'), false);
      await docker(['exec',a.browser,'node','-e',"require('node:fs').writeFileSync('/home/browser/tenant-fixture','account-a')"]);
      const fileLeak = JSON.parse(await docker(['exec',b.browser,'node','-e',"console.log(require('node:fs').existsSync('/home/browser/tenant-fixture'))"]));
      assert.equal(fileLeak, false);
      const aInfo = await driver.inspect(a.browser), bInfo = await driver.inspect(b.browser);
      assert.notDeepEqual(Object.keys(aInfo.NetworkSettings.Networks), Object.keys(bInfo.NetworkSettings.Networks));
      const reachability = JSON.parse(await docker(['exec',a.browser,'node','--input-type=module','-e',
        `try{await fetch(${JSON.stringify(b.endpoint)}+'/health',{signal:AbortSignal.timeout(1000)});console.log('true');}catch{console.log('false');}`]));
      assert.equal(reachability, false); results.tenantIsolation = 'PASS';
    } finally { await driver.stop(a.runtimeId); await driver.stop(b.runtimeId); }
  });
  it('confirms Stop only after both containers have exited and removes their network', async () => {
    const runtime = await allocation(), requestedAt = Date.now(), proof = await driver.stop(runtime.runtimeId);
    assert.equal(proof.processExited, true); assert.ok(proof.observedAt >= requestedAt);
    assert.equal(await driver.inspect(runtime.browser), null); assert.equal(await driver.inspect(runtime.egress), null);
    await assert.rejects(docker(['network','inspect',runtime.network])); results.stop = 'CONFIRMED';
  });
  for(const stage of ['network create','service readiness']) it(`keeps physical Stop unconfirmed while ${stage} is pending in another supervisor`,async()=>{
    const directory=await mkdtemp(join(tmpdir(),'oddpath-runtime-'));
    let workerJournal,reaperJournal,pending,release,entered;
    const atGate=new Promise(resolve=>{entered=resolve;}),gate=new Promise(resolve=>{release=resolve;});
    let gated=false,runtimeId;
    try{
      const path=join(directory,'journal.sqlite');
      workerJournal=new RuntimeJournal(path);reaperJournal=new RuntimeJournal(path);
      const controlledDriver=new DockerRuntimeDriver({instanceId,supervisorContainer:controller,chromeImage:driver.chromeImage,egressImage:driver.egressImage,execute:async args=>{
        if(stage==='network create'&&!gated&&args[0]==='network'&&args[1]==='create'){
          gated=true;entered();await gate;return docker(args);
        }
        const output=await docker(args);
        if(stage==='service readiness'&&!gated&&args[0]==='exec'&&args.includes('--input-type=module')){gated=true;entered();await gate;}
        return output;
      }});
      const worker=new BrowserSupervisor({journal:workerJournal,driver:controlledDriver}),reaper=new BrowserSupervisor({journal:reaperJournal,driver});
      const task={executionId:'stop-race-'+randomUUID(),projectId:'stop-race-project',approval:{bindingHash:'b'.repeat(64)},deadlineAt:new Date(Date.now()+120000).toISOString(),profile:{target:{baseUrl:'https://example.com',resourceOrigins:[],authenticationOrigins:[]}}};
      pending=worker.allocate(task,Date.now()+45000,async row=>{runtimeId=row.runtime;allocations.push(runtimeId);}).then(value=>({value}),error=>({error}));
      await Promise.race([atGate,pending.then(result=>{throw result.error||Error('Allocation settled before its gate');})]);
      if(stage==='service readiness')assert.equal((await driver.inspect(driver.names(runtimeId).browser)).State.Running,true);
      await assert.rejects(reaper.stop(task.executionId),/creation is pending/u);
      assert.equal(reaperJournal.get(task.executionId).state,'STOPPING');assert.equal(reaperJournal.get(task.executionId).proof,null);
      assert.equal(typeof reaperJournal.get(task.executionId).allocationOwner,'string');assert.deepEqual(reaperJournal.unreported(),[]);
      release();
      const result=await pending;assert.match(result.error?.message??'',/Allocation authority lost/u);
      const proof=await reaper.stop(task.executionId);
      assert.equal(proof.processExited,true);assert.equal(reaperJournal.get(task.executionId).state,'STOPPED');
      assert.equal(reaperJournal.get(task.executionId).allocationOwner,null);
      assert.equal(await driver.inspect(driver.names(runtimeId).browser),null);assert.equal(await driver.inspect(driver.names(runtimeId).egress),null);
      assert.equal(await driver.inspectNetwork(driver.names(runtimeId).network),null);
      assert.deepEqual(await worker.stop(task.executionId),proof);
      results.pendingCreationStop??={};results.pendingCreationStop[stage]='UNCONFIRMED_UNTIL_SETTLED_AND_CLEANED';
    }finally{
      release?.();await pending;if(runtimeId)await driver.stop(runtimeId);
      workerJournal?.close();reaperJournal?.close();assert.equal(dirname(resolve(directory)),resolve(tmpdir()));assert.match(directory,/oddpath-runtime-/u);
      await rm(directory,{recursive:true});
    }
  });
  it('keeps Stop unconfirmed after real Docker CLI EOF and cleans the late accepted network', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'oddpath-runtime-'));
    let workerJournal, reaperJournal, runtimeId, queuedArgs, serverOperation, release;
    const gate = new Promise(resolve => { release = resolve; });
    let requestName;
    // Fault injection models a server retaining an accepted operation after the
    // reply connection is lost. CLI error and subsequent Docker resources are real.
    const server = createServer(async (req, res) => {
      if (req.url === '/_ping') { res.setHeader('API-Version', '1.53'); res.end('OK'); return; }
      if (req.url?.endsWith('/networks/create')) {
        let body = ''; for await (const chunk of req) body += chunk;
        requestName = JSON.parse(body).Name;
        serverOperation = (async () => { await gate; await docker(queuedArgs); })();
        serverOperation.catch(() => {});
        req.socket.destroy(); return;
      }
      res.statusCode = 404; res.end('{}');
    });
    try {
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      const host = `tcp://127.0.0.1:${server.address().port}`;
      const path = join(directory, 'journal.sqlite');
      workerJournal = new RuntimeJournal(path); reaperJournal = new RuntimeJournal(path);
      const controlledDriver = new DockerRuntimeDriver({ instanceId, supervisorContainer: controller, chromeImage: driver.chromeImage, egressImage: driver.egressImage,
        execute: async args => {
          if (!queuedArgs && args[0] === 'network' && args[1] === 'create') {
            queuedArgs = args; return docker(['--host', host, ...args]);
          }
          return docker(args);
        } });
      const worker = new BrowserSupervisor({ journal: workerJournal, driver: controlledDriver });
      let reaper = new BrowserSupervisor({ journal: reaperJournal, driver });
      const task = { executionId: 'eof-race-' + randomUUID(), projectId: 'eof-race-project', approval: { bindingHash: 'b'.repeat(64) },
        deadlineAt: new Date(Date.now() + 120000).toISOString(), profile: { target: { baseUrl: 'https://example.com', resourceOrigins: [], authenticationOrigins: [] } } };
      await assert.rejects(worker.allocate(task, Date.now() + 45000, async row => { runtimeId = row.runtime; allocations.push(runtimeId); }), error => {
        assert.equal(error.code, 1); assert.equal(error.killed, false); assert.equal(error.signal, null);
        assert.match(error.stderr, /: EOF\s*$/u); assert.equal(error.allocationSettlementUnknown, true); return true;
      });
      const names = driver.names(runtimeId), owner = workerJournal.get(task.executionId).allocationOwner;
      assert.equal(requestName, names.network); assert.equal(typeof owner, 'string');
      assert.equal(await driver.inspectNetwork(names.network), null);
      await assert.rejects(reaper.stop(task.executionId), /creation is pending/u);
      assert.equal(reaperJournal.get(task.executionId).state, 'STOPPING');
      assert.equal(reaperJournal.get(task.executionId).proof, null); assert.deepEqual(reaperJournal.unreported(), []);
      reaperJournal.close(); reaperJournal = new RuntimeJournal(path);
      reaper = new BrowserSupervisor({ journal: reaperJournal, driver });
      await assert.rejects(reaper.recover(), /creation is pending/u);
      assert.equal(reaperJournal.get(task.executionId).allocationOwner, owner);
      release(); await serverOperation;
      assert.notEqual(await driver.inspectNetwork(names.network), null);
      await assert.rejects(reaper.stop(task.executionId), /creation is pending/u);
      assert.equal(await driver.inspectNetwork(names.network), null);
      assert.equal(await driver.inspect(names.browser), null); assert.equal(await driver.inspect(names.egress), null);
      assert.equal(reaperJournal.get(task.executionId).allocationOwner, owner);
      assert.equal(reaperJournal.get(task.executionId).proof, null); assert.deepEqual(reaperJournal.unreported(), []);
      await assert.rejects(worker.allocate({ ...task, executionId: 'another-' + randomUUID() }, Date.now() + 45000), /capacity is busy/u);
      results.mutationEof = 'UNCONFIRMED_ACROSS_RESTART_LATE_NETWORK_CLEANED';
    } finally {
      release(); await serverOperation?.catch(() => {});
      try { if (runtimeId) await driver.stop(runtimeId); }
      finally {
        workerJournal?.close(); reaperJournal?.close(); server.closeAllConnections();
        if (server.listening) await new Promise(resolve => server.close(resolve));
        assert.equal(dirname(resolve(directory)), resolve(tmpdir())); assert.match(directory, /oddpath-runtime-/u);
        await rm(directory, { recursive: true });
      }
    }
  });
  it('captures consent-bound supported state and restores it in a fresh saved-login browser without human input',async()=>{
    const manual=await allocation(45000,120000,false,driver,true),epoch=randomUUID();let savedId;
    try{
      assert.equal(await probe(`const r=await fetch(${JSON.stringify(manual.endpoint)}+'/login/begin',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(manual.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify(r.status));`),200);
      await docker(['exec',manual.browser,'node','--input-type=module','-e',`const {chromium}=await import('playwright');const b=await chromium.connectOverCDP('http://127.0.0.1:9222'),c=b.contexts()[0],p=c.pages()[0];await c.addCookies([{name:'qa_saved_fixture',value:'fixture-only-secret',domain:'example.com',path:'/',secure:true,httpOnly:true,sameSite:'Strict'}]);await p.evaluate(()=>localStorage.setItem('qa_saved_fixture','قيمة محفوظة'));await b.close();`]);
      assert.equal(await probe(`const r=await fetch(${JSON.stringify(manual.endpoint)}+'/login/complete',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(manual.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify(r.status));`),200);
      const state=await probe(`const r=await fetch(${JSON.stringify(manual.endpoint)}+'/auth/capture',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(manual.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});if(!r.ok)throw Error('Capture rejected');console.log(JSON.stringify(await r.json()));`);
      assert.equal(state.cookies.some(cookie=>cookie.name==='qa_saved_fixture'),true);
      await driver.stop(manual.runtimeId);
      const input={executionId:'saved-fixture-'+randomUUID(),runtimeId:randomUUID(),token:randomBytes(32).toString('hex'),deadline:Date.now()+120000,leaseUntil:Date.now()+45000,
        origins:['https://example.com'],saved:true,manual:{baseUrl:'https://example.com/',authenticationOrigins:[],executionTimeoutMs:30000},preparationDeadline:Date.now()+60000};
      savedId=input.runtimeId;allocations.push(savedId);const endpoint=await driver.start(input),savedEpoch=randomUUID();
      assert.equal(await probe(`const r=await fetch(${JSON.stringify(endpoint)}+'/cdp/json/list',{headers:{authorization:'Bearer '+${JSON.stringify(input.token)}}});console.log(JSON.stringify(r.status));`),403);
      const restored=await probe(`const r=await fetch(${JSON.stringify(endpoint)}+'/auth/restore',{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(input.token)},'content-type':'application/json','x-oddpath-login-epoch':${JSON.stringify(savedEpoch)}},body:${JSON.stringify(JSON.stringify(state))}});console.log(JSON.stringify({status:r.status,body:await r.json()}));`);
      assert.equal(restored.status,200);assert.equal(restored.body.phase,'READY');
      const observed=await probe(`const endpoint=${JSON.stringify(endpoint)},token=${JSON.stringify(input.token)};let data=await(await fetch(endpoint+'/cdp/json/version',{headers:{authorization:'Bearer '+token}})).json();const {chromium}=await import('playwright');const b=await chromium.connectOverCDP(endpoint.replace(/^http/,'ws')+'/cdp'+new URL(data.webSocketDebuggerUrl).pathname,{headers:{authorization:'Bearer '+token}}),c=b.contexts()[0],p=c.pages()[0];console.log(JSON.stringify({cookie:(await c.cookies()).some(x=>x.name==='qa_saved_fixture'&&x.value==='fixture-only-secret'),storage:await p.evaluate(()=>localStorage.getItem('qa_saved_fixture')==='قيمة محفوظة')}));await b.close();`);
      assert.deepEqual(observed,{cookie:true,storage:true});await driver.stop(savedId);
      assert.equal(await driver.inspectNetwork(driver.names(savedId).network),null);results.savedLogin={freshBrowser:true,cookieRestored:true,localStorageRestored:true,captureBlockedUntilReady:true,physicalStop:true};
    }finally{await driver.stop(manual.runtimeId);if(savedId)await driver.stop(savedId);}
  });
  it('self-terminates on lease expiry even without the supervisor or API', async () => {
    const runtime = await allocation(12_000);
    await new Promise(resolve => setTimeout(resolve, 13_000));
    const info = await driver.inspect(runtime.browser); assert.equal(info.State.Running, false);
    await driver.stop(runtime.runtimeId); results.leaseWatchdog = 'PASS';
  });
  it('refuses to extend the immutable deadline and exits at its hard bound', async () => {
    const runtime = await allocation(12_000, 12_000);
    const observed = await probe(`${connection(runtime)}const response=await fetch(endpoint+'/lease',{method:'POST',headers:{authorization:'Bearer '+token,'x-oddpath-lease-ms':${JSON.stringify(String(runtime.deadline + 1000))}}});console.log(JSON.stringify({status:response.status}));await browser.close();`);
    assert.equal(observed.status, 409);
    await new Promise(resolve => setTimeout(resolve, Math.max(1, runtime.deadline - Date.now() + 1000)));
    assert.equal((await driver.inspect(runtime.browser)).State.Running, false);
    await driver.stop(runtime.runtimeId); results.hardDeadline = 'PASS';
  });
  it('reaps a real Chrome crash without resuming a durably started recipe', async () => {
    const runtime = await allocation(), journal = new RuntimeJournal(':memory:');
    journal.reserve({ ...runtime, projectId: 'crash-fixture', bindingHash: 'b'.repeat(64) }); journal.live(runtime.executionId); journal.markStarted(runtime.executionId);
    try {
      await probe(`${connection(runtime)}console.log('{}');await browser.close();`);
      await docker(['exec',runtime.browser,'node','--input-type=module','-e',`const {readdirSync,readFileSync}=await import('node:fs');let killed=false;for(const id of readdirSync('/proc'))if(/^\\d+$/.test(id)){let args;try{args=readFileSync('/proc/'+id+'/cmdline','utf8');}catch{continue;}if(args.split('\\0')[0].includes('chrome')&&args.includes('--remote-debugging-port=9222')&&!args.includes('--type=')){process.kill(Number(id),'SIGKILL');killed=true;break;}}if(!killed)throw Error('Chrome PID missing');`]);
      for (let i=0;i<30&&(await driver.inspect(runtime.browser)).State.Running;i++) await new Promise(resolve=>setTimeout(resolve,100));
      assert.equal((await driver.inspect(runtime.browser)).State.Running, false);
      await new BrowserSupervisor({ driver, journal }).reap();
      assert.equal(journal.get(runtime.executionId).state, 'STOPPED'); assert.throws(()=>journal.markStarted(runtime.executionId));
      results.chromeCrash = 'STOPPED_WITHOUT_REPLAY';
    } finally { journal.close(); await driver.stop(runtime.runtimeId); }
  });
  it('cleans networks orphaned before any container was created', async () => {
    const runtimeId = randomUUID(), names = driver.names(runtimeId), journal = new RuntimeJournal(':memory:'); allocations.push(runtimeId);
    await docker(['network','create','--internal',...driver.labels('orphan-fixture',runtimeId,Date.now()+60000),names.network]);
    try {
      await new BrowserSupervisor({ driver, journal }).reap();
      await assert.rejects(docker(['network','inspect',names.network])); results.orphanNetwork = 'REMOVED';
    } finally { journal.close(); await driver.stop(runtimeId); }
  });
  it('returns a bounded safe navigation cause before stopping a login with unavailable egress',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true),epoch=randomUUID();
    try{
      await docker(['kill',runtime.egress]);await docker(['wait',runtime.egress]);
      const response=await probe(`const response=await fetch(${JSON.stringify(runtime.endpoint+'/login/begin')},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}},signal:AbortSignal.timeout(20000)});console.log(JSON.stringify({status:response.status,body:await response.json()}));`);
      assert.equal(response.status,409);assert.deepEqual(Object.keys(response.body),['failure']);
      assert.equal(response.body.failure.stage,'NAVIGATION');
      assert.ok(['NETWORK_TIMEOUT','NETWORK_PROXY','NETWORK_DNS','NETWORK_CONNECTION'].includes(response.body.failure.reason));
      assert.deepEqual(Object.keys(response.body.failure).sort(),['reason','stage']);
      assert.ok(!JSON.stringify(response.body).includes('https:'));assert.ok(!JSON.stringify(response.body).includes(runtime.token));
      for(let attempt=0;attempt<30&&(await driver.inspect(runtime.browser)).State.Running;attempt++)await new Promise(r=>setTimeout(r,100));
      assert.equal((await driver.inspect(runtime.browser)).State.Running,false);
      results.preparationFailure=response.body.failure;
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('allows real human password/MFA input while blocking CDP, then revokes human input before execution',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true),epoch=randomUUID(),key='e'.repeat(64);
    let browser,gatewayPid;
    try{
      // White-box fixture setup happens BEFORE human input is enabled. No real
      // credentials are used, no sign-in screenshot or storage is recorded.
      const setup=JSON.parse(await docker(['exec',runtime.browser,'node','--input-type=module','-e',`const {chromium}=await import('playwright');const browser=await chromium.connectOverCDP('http://127.0.0.1:9222');const page=browser.contexts()[0].pages()[0];await page.goto('https://example.com/',{waitUntil:'domcontentloaded',timeout:15000});await page.setContent('<body style="margin:0;background:rgb(10,60,130);min-height:100vh"><input id="password" type="password" style="position:absolute;left:40px;top:50px;width:200px;height:30px;background:rgb(240,240,10)"><input id="mfa" type="password" style="position:absolute;left:40px;top:100px;width:200px;height:30px;background:rgb(10,240,240)"><button id="submit" style="position:absolute;left:40px;top:150px;width:200px;height:30px;background:rgb(240,10,240)" onclick="if(document.querySelector(\\'#password\\').value===\\'fixture-password\\'&&document.querySelector(\\'#mfa\\').value===\\'654321\\')document.cookie=\\'qa_manual_authenticated=fixture; Secure; Path=/; SameSite=Strict\\'">Sign in</button></body>');console.log(JSON.stringify(await page.evaluate(()=>{const y=window.outerHeight-window.innerHeight+window.screenY;return {password:{x:50,y:y+60},mfa:{x:50,y:y+110},submit:{x:50,y:y+160}};})));await browser.close();` ]));
      const port=await docker(['inspect',controller,'--format','{{(index (index .NetworkSettings.Ports "8081/tcp") 0).HostPort}}']),origin=`http://127.0.0.1:${port}`;
      const grant={schemaVersion:1,executionId:runtime.executionId,runtimeId:runtime.runtimeId,ownerId:'manual-owner',projectId:'manual-project',bindingHash:'b'.repeat(64),nonce:randomUUID(),expiresAt:Date.now()+60000,mode:'LOGIN',controlEpoch:epoch};
      const input={...runtime,projectId:grant.projectId,bindingHash:grant.bindingHash};
      const script=`const {RuntimeJournal}=await import('./apps/browser-runtime/src/journal.mjs');const {createViewerGateway}=await import('./apps/browser-runtime/src/viewer-gateway.mjs');const journal=new RuntimeJournal(':memory:');journal.reserve(${JSON.stringify(input)});journal.live(${JSON.stringify(runtime.executionId)});const headers={authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}};const start=await fetch(${JSON.stringify(runtime.endpoint+'/login/begin')},{method:'POST',headers});if(!start.ok)throw Error('Human mode failed');journal.loginTransition(${JSON.stringify(runtime.executionId)},'PREPARING','LOGIN',${JSON.stringify(epoch)});createViewerGateway({journal,driver:{async endpoint(){return ${JSON.stringify(runtime.endpoint)}}},signingKey:${JSON.stringify(key)},publicOrigin:${JSON.stringify(origin)},secure:false}).listen(8081,'0.0.0.0');process.on('SIGUSR1',async()=>{journal.loginTransition(${JSON.stringify(runtime.executionId)},'LOGIN','READY',${JSON.stringify(epoch)});});`;
      gatewayPid=Number(await docker(['exec',controller,'node','--input-type=module','-e',`const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['--input-type=module','-e',${JSON.stringify(script)}],{detached:true,stdio:'ignore'});child.unref();console.log(child.pid);`]));
      let gatewayReady=false;for(let i=0;i<150;i++){try{if((await fetch(origin+'/open')).ok){gatewayReady=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}
      if(!gatewayReady){const info=await driver.inspect(runtime.browser);assert.fail('Human gateway unavailable; browser running='+info?.State.Running);}
      const blocked=await probe(`const endpoint=${JSON.stringify(runtime.endpoint)},headers={authorization:'Bearer '+${JSON.stringify(runtime.token)}};console.log(JSON.stringify({cdp:(await fetch(endpoint+'/cdp/json/version',{headers})).status,health:(await (await fetch(endpoint+'/health',{headers})).json()).phase}));`);
      assert.equal(blocked.cdp,403);assert.equal(blocked.health,'LOGIN');
      browser=await chromium.launch({headless:true});const context=await browser.newContext({viewport:{width:1600,height:1000}}),page=await context.newPage();
      const bad=await context.request.post(origin+'/open',{headers:{origin},data:{ticket:signGrant({...grant,nonce:randomUUID(),controlEpoch:randomUUID()},key)}});assert.equal(bad.status(),403);
      const viewGrant={...grant,mode:'VIEW',nonce:randomUUID()};delete viewGrant.controlEpoch;
      assert.equal((await context.request.post(origin+'/open',{headers:{origin},data:{ticket:signGrant(viewGrant,key)}})).status(),403);
      await page.goto(origin+'/open#'+signGrant(grant,key));await page.waitForFunction(()=>document.querySelector('#screen canvas')?.width===1440,null,{timeout:15000});
      await framebufferPixels(page,[10,60,130]);
      assert.match(await docker(['exec',runtime.browser,'x11vnc','-display',':99','-query','viewonly']),/ans=viewonly:0/);
      const canvas=page.locator('#screen canvas'),box=await canvas.boundingBox();assert.ok(box);
      // Click the actual RFB fixture rectangles rather than estimating Chrome's
      // toolbar geometry from outerHeight (which includes bottom decoration).
      const positions={};
      for(const [field,color] of Object.entries({password:[240,240,10],mfa:[10,240,240],submit:[240,10,240]})){
        const point=await page.waitForFunction(expected=>{const canvas=document.querySelector('#screen canvas'),bytes=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;let count=0,x=0,y=0;
          for(let i=0;i<bytes.length;i+=4)if(Math.abs(bytes[i]-expected[0])<4&&Math.abs(bytes[i+1]-expected[1])<4&&Math.abs(bytes[i+2]-expected[2])<4){count++;x+=(i/4)%canvas.width;y+=Math.floor(i/4/canvas.width);}
          return count>500?{x:x/count,y:y/count}:false;},color,{timeout:5000});positions[field]=await point.jsonValue();await point.dispose();
      }
      for(const [field,value] of [['password','fixture-password'],['mfa','654321']]){await canvas.click({position:{x:positions[field].x*box.width/1440,y:positions[field].y*box.height/900}});await page.keyboard.type(value);}
      await canvas.click({position:{x:positions.submit.x*box.width/1440,y:positions.submit.y*box.height/900}});await new Promise(r=>setTimeout(r,300));
      // Handoff closes the human socket, disables physical VNC input and clears
      // filled DOM before exposing ordinary CDP. Only boolean fixture proof is read.
      const completed=await probe(`const response=await fetch(${JSON.stringify(runtime.endpoint+'/login/complete')},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify({status:response.status,body:response.ok?await response.json():null}));`);
      assert.equal(completed.status,200);assert.equal(completed.body.phase,'READY');
      await page.getByText('Browser disconnected',{exact:true}).waitFor({timeout:5000});
      await docker(['exec',controller,'node','-e',`process.kill(${gatewayPid},'SIGUSR1')`]);
      await new Promise(r=>setTimeout(r,100));
      assert.equal((await context.request.get(page.url())).status(),403);
      const observed=await probe(`${connection(runtime)}console.log(JSON.stringify({authenticated:(await context.cookies()).some(c=>c.name==='qa_manual_authenticated'),loginFormCleared:await page.locator('#password').count()===0,url:page.url()}));await browser.close();`);
      assert.equal(observed.authenticated,true);assert.equal(observed.loginFormCleared,true);assert.equal(observed.url,'https://example.com/');
      await driver.stop(runtime.runtimeId);results.humanLogin={inputAndMfa:true,cdpDuringLogin:403,viewAndWrongEpochBlocked:true,filledDomCleared:true,humanDisconnected:true,physicalStop:true};
    }finally{await browser?.close();await driver.stop(runtime.runtimeId);if(gatewayPid)await docker(['exec',controller,'node','--input-type=module','-e',`const {readFileSync}=await import('node:fs');let command;try{command=readFileSync('/proc/${gatewayPid}/cmdline','utf8');}catch(error){if(error.code!=='ENOENT')throw error;}if(command){if(!command.includes('createViewerGateway')||!command.includes(${JSON.stringify(runtime.executionId)}))throw Error('Gateway fixture ownership mismatch');process.kill(${gatewayPid},'SIGTERM');}`]);}
  });
  it('allows only the approved SSO origin while rejecting a resource origin as a login target',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true,60000,2000),epoch=randomUUID();
    try{
      const begun=await probe(`const r=await fetch(${JSON.stringify(runtime.endpoint+'/login/begin')},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify({status:r.status}));`);assert.equal(begun.status,200);
      // Privileged white-box fixture inspects navigation metadata only; there
      // are no credentials, DOM captures or sign-in screenshots in this case.
      const policy=JSON.parse(await docker(['exec',runtime.browser,'node','--input-type=module','-e',`const {chromium}=await import('playwright');const b=await chromium.connectOverCDP('http://127.0.0.1:9222');const p=b.contexts()[0].pages()[0];await p.goto('https://example.org/',{waitUntil:'domcontentloaded',timeout:15000});const allowed=new URL(p.url()).origin==='https://example.org';let resourceBlocked=false;try{await p.goto('https://www.iana.org/',{timeout:5000});}catch{resourceBlocked=true;}console.log(JSON.stringify({allowed,resourceBlocked}));await b.close().catch(()=>{});`]));
      assert.equal(policy.allowed,true);assert.equal(policy.resourceBlocked,true);
      results.loginOrigins={approvedSso:true,resourceNotTarget:true};
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('keeps blank/srcdoc child frames alive during login and after managed handoff',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true),epoch=randomUUID();
    try {
      const action=async name=>probe(`const r=await fetch(${JSON.stringify(runtime.endpoint)}+'/login/'+${JSON.stringify(name)},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify({status:r.status}));`);
      assert.equal((await action('begin')).status,200);
      const addFrames=async()=>JSON.parse(await docker(['exec',runtime.browser,'node','--input-type=module','-e',
        `const {chromium}=await import('playwright');const b=await chromium.connectOverCDP('http://127.0.0.1:9222');const p=b.contexts()[0].pages()[0];
         await p.evaluate(()=>{const blank=document.createElement('iframe');document.body.append(blank);const srcdoc=document.createElement('iframe');srcdoc.srcdoc='<p>Inline fixture</p><iframe srcdoc="Nested inline fixture"></iframe>';document.body.append(srcdoc);});
         await p.waitForTimeout(500);console.log(JSON.stringify({urls:p.frames().map(f=>f.url())}));await b.close();`]));
      const during=await addFrames();assert.ok(during.urls.includes('about:blank'));assert.ok(during.urls.includes('about:srcdoc'));
      assert.equal((await driver.inspect(runtime.browser)).State.Running,true);
      const blocked=await probe(`const h={authorization:'Bearer '+${JSON.stringify(runtime.token)}};console.log(JSON.stringify({cdp:(await fetch(${JSON.stringify(runtime.endpoint+'/cdp/json/version')},{headers:h})).status,phase:(await(await fetch(${JSON.stringify(runtime.endpoint+'/health')},{headers:h})).json()).phase}));`);
      assert.equal(blocked.cdp,403);assert.equal(blocked.phase,'LOGIN');
      assert.equal((await action('complete')).status,200);await addFrames();
      assert.equal((await action('start')).status,200);
      const observed=await probe(`const {createManagedPlaywrightSession}=await import('@oddpath/runner');const s=await createManagedPlaywrightSession(${JSON.stringify(runtime.endpoint)},${JSON.stringify(runtime.token)},'https://example.com/');
        await s.navigate('https://example.com/','domcontentloaded',10000);await s.expect({kind:'visible',locator:{by:'text',value:'This domain is for use in documentation examples'}},3000);console.log(JSON.stringify({url:s.currentUrl()}));await s.close();`);
      assert.equal(observed.url,'https://example.com/');
      results.inheritedChildFrames={blank:true,srcdoc:true,nested:true,captureStillBlockedDuringLogin:true,managedHandoff:true};
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('still stops top-level about:blank during human control',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true),epoch=randomUUID();
    try {
      const begun=await probe(`const r=await fetch(${JSON.stringify(runtime.endpoint+'/login/begin')},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify({status:r.status}));`);assert.equal(begun.status,200);
      await docker(['exec',runtime.browser,'node','--input-type=module','-e',`const {chromium}=await import('playwright');const b=await chromium.connectOverCDP('http://127.0.0.1:9222');await b.contexts()[0].pages()[0].goto('about:blank',{timeout:5000}).catch(()=>{});await b.close().catch(()=>{});`]).catch(error=>{if(![137,143].includes(error.code))throw error;});
      for(let i=0;i<30&&(await driver.inspect(runtime.browser)).State.Running;i++)await new Promise(r=>setTimeout(r,100));
      const info=await driver.inspect(runtime.browser);assert.equal(info.State.Running,false);assert.equal(info.State.OOMKilled,false);
      assert.ok(Date.now()<runtime.preparationDeadline);results.topLevelBlank='STOPPED';
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('stops browser-local navigation during human control without exposing capture',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true),epoch=randomUUID();
    try{
      const begun=await probe(`const r=await fetch(${JSON.stringify(runtime.endpoint+'/login/begin')},{method:'POST',headers:{authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}}});console.log(JSON.stringify({status:r.status}));`);assert.equal(begun.status,200);
      await docker(['exec',runtime.browser,'node','--input-type=module','-e',`const {chromium}=await import('playwright');const b=await chromium.connectOverCDP('http://127.0.0.1:9222');await b.contexts()[0].pages()[0].goto('chrome://settings',{timeout:5000}).catch(()=>{});await b.close().catch(()=>{});`]).catch(error=>{if(![137,143].includes(error.code))throw error;});
      for(let i=0;i<30&&(await driver.inspect(runtime.browser)).State.Running;i++)await new Promise(r=>setTimeout(r,100));
      const observed=await driver.inspect(runtime.browser);assert.equal(observed.State.Running,false);assert.equal(observed.State.OOMKilled,false);
      assert.ok(Date.now()<runtime.preparationDeadline,'Navigation must terminate before preparation expiry');results.browserLocalLogin='STOPPED';
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('enforces the execution clock separately after manual handoff',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true,60000,2000),epoch=randomUUID();
    try{
      const receipt=await probe(`const h={authorization:'Bearer '+${JSON.stringify(runtime.token)},'x-oddpath-login-epoch':${JSON.stringify(epoch)}};const starts=[];for(const action of ['begin','complete','start','start']){const r=await fetch(${JSON.stringify(runtime.endpoint)}+'/login/'+action,{method:'POST',headers:h});if(!r.ok)throw Error('Handoff failed');const body=await r.json();if(action==='start')starts.push(body);}console.log(JSON.stringify({starts}));`);
      assert.equal(receipt.starts[0].phase,'EXECUTING');assert.equal(receipt.starts[0].executionDeadline,receipt.starts[1].executionDeadline);
      assert.ok(receipt.starts[0].executionDeadline<runtime.deadline);
      await new Promise(r=>setTimeout(r,Math.max(1,receipt.starts[0].executionDeadline-Date.now()+1000)));
      assert.equal((await driver.inspect(runtime.browser)).State.Running,false);results.manualExecutionClock={boundedSeparately:true,retryDidNotExtend:true,stopped:true};
    }finally{await driver.stop(runtime.runtimeId);}
  });
  it('self-terminates an unfinished human preparation and cannot revive it with a lease renewal',async()=>{
    const runtime=await allocation(45000,120000,false,driver,true,18000);
    try{
      await new Promise(r=>setTimeout(r,Math.max(1,runtime.preparationDeadline-Date.now()+1000)));
      assert.equal((await driver.inspect(runtime.browser)).State.Running,false);
      results.preparationDeadline='STOPPED_WITHOUT_INPUT_OR_REPLAY';
    }finally{await driver.stop(runtime.runtimeId);}
  });
});
