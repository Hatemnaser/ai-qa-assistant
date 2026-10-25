import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseBrowserStorageState,browserCookieDomainAllowed } from '@oddpath/qa-execution-contract';
import { preparationStep } from './preparation-failure.mjs';

// This in-container policy client only enforces navigation/download boundaries.
// The explicit vault methods read/write supported state only for the trusted
// supervisor's consent-bound transfer; no state is sent to an executor/model.
export class LoginPolicy {
  constructor({ baseUrl, authenticationOrigins = [], stop }) {
    const target = new URL(baseUrl);
    if (target.protocol !== 'https:' || target.username || target.password || target.port || target.search || target.hash
      || !Array.isArray(authenticationOrigins) || authenticationOrigins.length > 20
      || authenticationOrigins.some(value => { const origin = new URL(value); return origin.protocol !== 'https:' || origin.origin !== value; })) throw new Error('Invalid login origin policy.');
    this.baseUrl = baseUrl; this.targetOrigin = target.origin;
    this.origins = new Set([target.origin, ...authenticationOrigins]); this.stop = stop; this.finishing = false;
  }
  allowsFrame(frame) {
    try {
      const url = new URL(frame.url());
      // Only child documents may use these local URLs under an approved parent.
      // A top-level about:/chrome:/data: navigation remains prohibited.
      if (url.protocol === 'about:' && ['blank','srcdoc'].includes(url.pathname)) {
        const parent = frame.parentFrame();
        return parent !== null && this.allowsFrame(parent);
      }
      return this.finishing ? url.origin === this.targetOrigin : this.origins.has(url.origin);
    } catch { return false; }
  }
  async begin() {
    this.browser = await preparationStep('CDP',async()=>{
      const { chromium } = await import('playwright');
      return chromium.connectOverCDP('http://127.0.0.1:9222', { timeout: 5000 });
    });
    this.browser.on('disconnected', this.stop);
    this.context = this.browser.contexts()[0];
    if (!this.context) throw new Error('Login context missing.');
    await this.context.clearPermissions();
    const control = await this.browser.newBrowserCDPSession();
    await control.send('Browser.setDownloadBehavior', { behavior: 'deny' });
    await this.context.route('**/*', async route => {
      try {
      const request = route.request();
      if (request.isNavigationRequest()) {
        let origin;
        try { origin = new URL(request.url()).origin; } catch { await route.abort('blockedbyclient'); return; }
        if (!(this.finishing ? origin === this.targetOrigin : this.origins.has(origin))) { await route.abort('blockedbyclient'); return; }
      }
      await route.continue();
      } catch { this.stop(); }
    });
    const attach=page=>{
      page.on('crash',this.stop);
      // Network interception alone does not see browser-local or data URLs.
      // Observe committed frame URLs only; never inspect sign-in DOM/content.
      page.on('framenavigated',frame=>{
        if(!this.allowsFrame(frame))this.stop();
      });
    };
    for(const page of this.context.pages())attach(page);
    this.context.on('page',attach);
    const page = this.context.pages()[0] || await this.context.newPage();
    if (page.url() !== this.baseUrl) await preparationStep('NAVIGATION',()=>page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }));
    await page.bringToFront();
  }
  async input(enabled) {
    return preparationStep('INPUT',async()=>{
    const run = promisify(execFile);
    // A separate immediate query can overwrite the asynchronous X11 command.
    // Supplying both options makes x11vnc acknowledge the change, then query it.
    const {stdout}=await run('x11vnc',['-display',':99','-remote',enabled?'noviewonly':'viewonly','-query','viewonly'],
      {timeout:5000,maxBuffer:4096,env:{...process.env,X11VNC_SYNC_TIMEOUT:'2'}});
    if(!stdout.includes(`ans=viewonly:${enabled?'0':'1'}`))throw new Error('Browser input mode not confirmed.');
    });
  }
  async finish() {
    await this.input(false);
    this.finishing = true;
    // Navigate while capture is still blocked, removing filled login/MFA DOM
    // and authentication callback URLs before giving the executor access.
    const pages = this.context.pages();
    const page = pages[0];
    if (!page) throw new Error('Login page closed.');
    for (const other of pages.slice(1)) await other.close();
    await preparationStep('NAVIGATION',()=>page.goto(this.baseUrl, { waitUntil: 'domcontentloaded', timeout: 10000 }));
    if (new URL(page.url()).origin !== this.targetOrigin) throw new Error('Login did not return to the target.');
    await page.bringToFront();
  }
  async capture() {
    if(!this.finishing||!this.context)throw new Error('State capture requires completed human handoff.');
    const state=await this.context.storageState();
    return parseBrowserStorageState({cookies:state.cookies.filter(cookie=>browserCookieDomainAllowed(cookie.domain,[...this.origins])),origins:state.origins.filter(entry=>this.origins.has(entry.origin))},[...this.origins]);
  }
  async restore(raw) {
    const state=parseBrowserStorageState(raw,[...this.origins]);
    await this.context.setStorageState(state);
    await this.finish();
  }
}
