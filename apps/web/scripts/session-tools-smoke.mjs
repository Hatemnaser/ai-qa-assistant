// Read-only UI validation. Every API/asset response is an in-memory fixture;
// external hosts and all mutations are blocked. No real account/DB/Runner/provider.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = new URL(process.env.UX_SMOKE_URL || 'http://127.0.0.1:5182').origin;
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local preview only');
const output = resolve('work/session-tools-validation', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
const catalogs = Object.fromEntries(await Promise.all(['en', 'ar', 'de'].map(async locale => [locale,
  JSON.parse(await readFile(new URL(`../src/i18n/messages/${locale}/sessionTools.json`, import.meta.url), 'utf8'))])));
const projectCatalogs = Object.fromEntries(await Promise.all(['en', 'ar', 'de'].map(async locale => [locale,
  JSON.parse(await readFile(new URL(`../src/i18n/messages/${locale}/projects.json`, import.meta.url), 'utf8'))])));
const text = (locale, key) => { const value = catalogs[locale][`sessionTools.${key}`]; assert.ok(value, `Missing ${locale}: ${key}`); return value; };
const launchBrowser = () => chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
let browser = await launchBrowser();
let browserContextsCreated = 0;
const timestamp = '2026-10-04T12:00:00.000Z';
const model = 'gemini-3.1-flash-lite';
const imageBytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1kAAAAASUVORK5CYII=', 'base64');
const hostileText = '<script>window.__previewExecuted=true</script>\n<img src=x onerror="window.__previewExecuted=true">\nThis is source text, not executable HTML.';
const report = { origin, isolated: true, screenshots: [], scenarios: [], errors: [] };
let checks = 0;
let reportWrites = Promise.resolve();
const passed = name => {
  checks++; report.scenarios.push(name); console.log(`PASS ${name}`);
  const snapshot = JSON.stringify({ ...report, checks }, null, 2);
  reportWrites = reportWrites.then(() => writeFile(resolve(output, 'report.json'), snapshot));
};
console.log(`Screenshots: ${output}`);

const project = (id, name) => ({ id, name, description: 'Read-only fixture project', role: 'OWNER', createdAt: timestamp, updatedAt: timestamp });
const projects = [project('project-a', 'Browser QA project'), project('project-b', 'Shared knowledge / مشروع مشترك / Gemeinsamer Projektkontext')];
function request(id = 'request-a', phase = 'EVIDENCE_NEEDED') {
  const items = [1, 2].map(index => ({ id: `${id}-item-${index}`, artifactId: `${id}-artifact`, ordinal: index,
    clientRef: `check-${index}`, title: index === 1 ? 'Welcome heading is visible' : 'Missing marker (intentional failure)',
    category: 'Smoke', priority: 'P1', preconditions: [], steps: ['Open the public login page.', 'Check heading visibility.'],
    expectedResult: index === 1 ? 'Welcome back is visible.' : 'Missing marker is visible.', createdAt: timestamp,
    evidenceRequirements: [{ id: `${id}-requirement-${index}`, checklistItemId: `${id}-item-${index}`, ordinal: 1,
      kind: 'TEXT', description: 'Record the observed visibility result.', required: true, createdAt: timestamp }] }));
  const running = phase === 'RUNNING';
  return { id, projectId: 'project-a', title: id === 'historical-request' ? 'Earlier approved QA record' : 'Current login check',
    objective: 'Check the public login page. The missing marker intentionally fails.', phase, version: 4,
    createdAt: timestamp, updatedAt: timestamp, target: 'https://example.test/login', environment: 'Local',
    acceptanceNotes: 'No credentials', selectedArtifactId: `${id}-artifact`, contextSnapshots: [], executionRecipes: [],
    artifacts: [{ id: `${id}-artifact`, requestId: id, revision: 1, origin: 'ODDPATH_GENERATED', title: 'Login checks',
      lockedAt: timestamp, createdAt: timestamp, assessments: [], items }],
    operations: [{ operationId: `${id}-operation`, requestId: id, kind: 'CHECKLIST_GENERATION', status: 'SUCCEEDED', completedAt: timestamp }],
    runs: [{ id: `${id}-run`, requestId: id, artifactId: `${id}-artifact`, status: running ? 'ACTIVE' : 'RESULTS_SUBMITTED',
      outcome: running ? 'NOT_RUN' : 'FAIL', version: 3, sourceLabel: 'Isolated fixture', externalRunRef: null, commitSha: null,
      startedAt: timestamp, submittedAt: running ? null : timestamp, createdAt: timestamp, updatedAt: timestamp,
      executionMode: 'PLAYWRIGHT', executionJob: { id: `${id}-job`, runId: `${id}-run`, recipeId: `${id}-recipe`,
        runnerRegistrationId: 'fixture-runner', profileKey: 'local', status: running ? 'RUNNING' : 'SUCCEEDED',
        completedItems: running ? 1 : 2, totalItems: 2, failureCode: null, failureMessage: null,
        completedAt: running ? null : timestamp, createdAt: timestamp, updatedAt: timestamp },
      results: items.map((item, index) => ({ id: `${id}-result-${index}`, runId: `${id}-run`, checklistItemId: item.id,
        status: index ? 'FAIL' : 'PASS', observedResult: index ? 'Marker absent, as intended.' : 'Welcome heading observed.',
        notes: null, createdAt: timestamp, updatedAt: timestamp })),
      evidence: items.filter((_, index) => phase !== 'EVIDENCE_NEEDED' || index === 0).map((item, index) => ({ id: `${id}-evidence-${index}`,
        runId: `${id}-run`, checklistItemId: item.id, requirementId: item.evidenceRequirements[0].id, actorKind: 'INTEGRATION',
        transport: 'REST', kind: 'TEXT', textContent: 'Observed fixture result.', externalReference: null, metadata: null, assets: [], createdAt: timestamp })) }],
    reviews: phase === 'APPROVED' ? [{ id: `${id}-review`, runId: `${id}-run`, artifactId: `${id}-artifact`, decision: 'APPROVED', comment: null, runVersion: 3, createdAt: timestamp }] : [],
    events: ['REQUEST_CREATED', 'CHECK_RESULT_RECORDED', 'EVIDENCE_ADDED', 'RUN_RESULTS_SUBMITTED'].map((type, index) => ({
      id: `${id}-event-${index}`, sequence: index + 1, type, actorKind: 'SYSTEM', transport: 'SYSTEM', metadata: null, createdAt: timestamp })) };
}
function session(id, projectId, title, requests = []) {
  return { id, projectId, title, managed: true, version: 3, archivedAt: null, createdAt: timestamp, updatedAt: timestamp,
    currentRequestId: requests[0]?.id || null, requests, requestIds: requests.map(item => item.id), phase: requests[0]?.phase,
    messages: [{ id: `${id}-user`, timelinePosition: 1, role: 'user', content: 'Test the public login page without signing in.',
      model: null, createdAt: timestamp, attachments: [
        { type: 'file', name: 'saved-notes.txt', mimeType: 'text/plain', assetId: 'saved-text' },
        { type: 'file', name: 'old-metadata-only.txt', mimeType: 'text/plain' },
        { type: 'file', name: 'retry-notes.txt', mimeType: 'text/plain', assetId: 'retry-text' },
        { type: 'image', name: 'sample.png', mimeType: 'image/png', assetId: 'saved-image' },
      ] }, { id: `${id}-assistant`, timelinePosition: 2, role: 'assistant', content: 'Execution requires explicit approval.\n\n| Check | Expected |\n| --- | --- |\n| Login | Visible |\n\n```js\nconst mode = "public";\n```', model, createdAt: timestamp }],
    events: requests.flatMap((item, requestIndex) => item.events.map((event, index) => ({ ...event, requestId: item.id,
      title: item.title, timelinePosition: 3 + requestIndex * 4 + index }))), pendingProposal: null, preparation: null, turnStatus: null };
}

async function setup({ width = 1440, height = 900, locale = 'en', theme = 'light', historical = false, longHistory = false, guest = false, unavailableProject = true, savedDestination = false, sessionIndex = 'complete', authentication = 'ready', initialHash } = {}) {
  assert.ok(['ready', 'held', 'unavailable'].includes(authentication));
  if (initialHash !== undefined) assert.ok(initialHash.startsWith('#/'), 'Fixture destinations must be local hash routes');
  // Bound Chromium lifetime as well as open tabs on memory-constrained laptops.
  if (browserContextsCreated >= 6) {
    assert.equal(browser.contexts().length, 0, 'Close the preceding fixture before recycling its browser');
    await browser.close(); browser = await launchBrowser(); browserContextsCreated = 0;
  }
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: 'reduce' });
  browserContextsCreated++;
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  const current = request('request-a', historical ? 'RUNNING' : 'EVIDENCE_NEEDED');
  const previous = request('historical-request', 'APPROVED');
  const primary = session('session-a', 'project-a', 'Login testing session', [current, previous]);
  if (longHistory) {
    const firstMessages = primary.messages;
    primary.messages = Array.from({ length: 30 }, (_, index) => ({ ...firstMessages[index % 2], id: `history-${index}`,
      timelinePosition: index + 1, attachments: index === 0 ? firstMessages[0].attachments : undefined,
      content: `Recorded message ${index}: ` + 'Keep the reading position while new information arrives. '.repeat(8) }));
    primary.events.forEach((event, index) => { event.timelinePosition = primary.messages.length + index + 1; });
  }
  const entries = [primary, session('project-b-session', 'project-b', 'Planning inside another project'),
    { ...session('archived-project', 'project-a', 'Archived project session'), archivedAt: timestamp },
    session('standalone-session', '', 'Independent planning session'),
    { ...session('archived-standalone', '', 'Archived independent session'), archivedAt: timestamp },
    ...(unavailableProject ? [session('unavailable-session', 'unavailable-project', 'Retained unavailable-project session')] : [])];
  const user = { id: 'session-tools-fixture-user', name: 'Session Tools Fixture', email: 'fixture@example.test',
    locale, createdAt: timestamp, emailVerifiedAt: timestamp };
  const reads = [], writes = [], unexpected = [], external = [];
  let retryBytesFail = true, indexFailure = sessionIndex === 'unavailable', usageFailure = false;
  let authFailure = authentication === 'unavailable';
  let releaseAuth, authRequested;
  const authHold = new Promise(resolve => { releaseAuth = resolve; });
  const firstAuthRead = new Promise(resolve => { authRequested = resolve; });
  page.on('pageerror', error => report.errors.push(`${locale}/${theme}/${width}: ${error.message}`));
  await context.addInitScript(({ locale, theme, savedDestination }) => {
    localStorage.setItem('ai_qa_assistant_locale', locale); localStorage.setItem('ai_qa_assistant_theme', theme);
    if (savedDestination && !sessionStorage.getItem('fixture-navigation-seeded')) {
      localStorage.setItem('oddpath:navigation:v3:session-tools-fixture-user', JSON.stringify({ last: {
        view: 'conversations', page: 'chat', sessionId: 'session-a', projectId: 'project-a', requestId: 'historical-request',
      } }));
      sessionStorage.setItem('fixture-navigation-seeded', 'true');
    }
    window.__previewExecuted = false;
  }, { locale, theme, savedDestination });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) { external.push(req.url()); return route.abort(); }
    if (path.startsWith('/__session_tools_assets/')) {
      const key = path.split('/').at(-1);
      if (key === 'retry-text' && retryBytesFail) return route.fulfill({ status: 503, body: 'Fixture preview unavailable' });
      const image = key === 'saved-image';
      return route.fulfill({ status: 200, contentType: image ? 'image/png' : 'text/plain', body: image ? imageBytes : Buffer.from(hostileText) });
    }
    if (!path.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (req.method() !== 'GET') { writes.push({ path, method: req.method() }); return json({ error: 'Read-only fixture; mutations are blocked.' }, 405); }
    reads.push(path);
    if (path === '/api/auth/me') {
      authRequested();
      if (authentication === 'held') await authHold;
      if (authFailure) return json({ error: 'Fixture identity temporarily unavailable' }, 503);
      return json({ user: guest ? null : user }, guest ? 401 : 200);
    }
    if (path === '/api/auth/csrf') return json({ csrfToken: 'fixture-only' });
    if (path === '/api/settings') return json({ settings: { defaultModel: model, language: locale, theme, updatedAt: timestamp } });
    if (path === '/api/ai/models') return json({ defaultModel: model, defaultProvider: 'fixture', providers: ['fixture'], models: [
      { value: model, label: 'Gemini 3.1 Flash Lite', provider: 'fixture', recommendedFor: 'Fixture', capabilities: { images: true, text: true, textAttachments: true } },
      { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', provider: 'fixture', recommendedFor: 'Fixture', capabilities: { images: true, text: true, textAttachments: true } },
    ] });
    if (path === '/api/usage/summary') return usageFailure ? json({ error: 'Fixture usage unavailable' }, 503)
      : json({ limit: 100, remaining: 73, used: 27, unit: 'credits', windowHours: 24, since: timestamp, modelTotals: [], recentEvents: [], statusTotals: [] });
    if (path === '/api/projects') return json({ projects });
    if (path === '/api/chats') return json({ chats: sessionIndex !== 'complete' ? [] : [{ id: primary.id, projectId: primary.projectId, title: 'Stale duplicate index title',
      mode: 'general', model, messages: [], createdAt: timestamp, updatedAt: timestamp }] });
    if (path === '/api/sessions') return indexFailure ? json({ error: 'Fixture index unavailable' }, 503)
      : json({ sessions: sessionIndex === 'omitted' ? entries.filter(item => item.id !== primary.id) : entries,
        unlinkedRequests: [{ ...previous, id: 'legacy-request', title: 'Legacy approved result' }] });
    if (path.startsWith('/api/sessions/')) {
      const record = entries.find(item => item.id === path.split('/')[3]);
      if (record) return json({ session: record });
    }
    if (path.endsWith('/runner-profiles')) return json({ profiles: [] });
    if (path.endsWith('/connections')) return json({ connections: [] });
    if (path.includes('/qa/requests/')) {
      const id = path.split('/').at(-1);
      const detail = id === current.id ? current : id === previous.id ? previous : id === 'legacy-request' ? { ...previous, id, title: 'Legacy approved result' } : null;
      if (detail) return json({ request: detail });
    }
    if (/^\/api\/assets\/[^/]+\/download$/.test(path)) return json({ download: {
      url: `${origin}/__session_tools_assets/${path.split('/')[3]}`, expiresAt: '2099-01-01T00:00:00.000Z',
    } });
    if (path.endsWith('/instructions')) return json({ instruction: { projectId: path.split('/')[3], content: 'Project instruction fixture: no real credentials.', updatedAt: timestamp } });
    if (path.endsWith('/memory')) return json({ memory: { projectId: path.split('/')[3], content: 'Project memory fixture: public login.', source: 'USER', updatedAt: timestamp } });
    if (path.endsWith('/documents')) return json({ documents: [] });
    unexpected.push(`GET ${path}`); return json({ error: 'Unexpected fixture read' }, 500);
  });
  await page.goto(initialHash ? `${origin}/${initialHash}` : savedDestination ? `${origin}/` : guest ? `${origin}/#/home` : `${origin}/#/chat?sessionId=session-a&projectId=project-a&requestId=${historical ? previous.id : current.id}`);
  await page.waitForFunction(({ locale, theme }) => document.documentElement.lang === locale && document.documentElement.dataset.theme === theme, { locale, theme });
  try {
    if (authentication !== 'ready' || (guest && /[?&](?:sessionId|projectId|requestId)=/.test(initialHash || ''))) {
      await firstAuthRead;
      const gate = page.locator('main > .workspace-feedback');
      await gate.waitFor();
      if (authentication === 'unavailable') await gate.getByRole('button', { name: 'Try again', exact: true }).waitFor();
      else if (authentication === 'ready') await gate.getByRole('button', { name: 'Sign in', exact: true }).waitFor();
    }
    else if (guest) await page.locator('.composer-textarea').waitFor();
    else { await page.locator('.chat-message-turn').first().waitFor(); await page.locator('.session-tools-buttons button').first().waitFor(); }
  } catch (error) {
    releaseAuth();
    report.startupFailure = { reads, writes, unexpected, external, url: page.url(), visibleText: (await page.locator('body').innerText()).slice(0, 5000) };
    await page.screenshot({ path: resolve(output, 'startup-failure.png'), fullPage: true });
    throw error;
  }
  assert.equal(await page.locator('.session-tools-panel').count(), 0, 'Tools start closed');
  assert.equal(await page.locator('.test-session .workspace-work-panel').count(), 0, 'Project management is not mounted inside the conversation');
  assert.deepEqual(reads.filter(path => /\/(instructions|memory|documents)$/.test(path)), [], 'Opening a session does not fetch editing panels');
  return { context, page, locale, theme, width, height, reads, writes, unexpected, external,
    releaseAuth, allowAuthRead() { authFailure = false; },
    allowRetryBytes() { retryBytesFail = false; }, failIndex(value) { indexFailure = value; }, failUsage(value) { usageFailure = value; },
    appendMessage() { primary.messages.push({ id: 'late-fixture-update', role: 'assistant', content: 'A later recorded message must not move the reader.',
      model, createdAt: timestamp, timelinePosition: Math.max(0, ...primary.messages.map(message => message.timelinePosition), ...primary.events.map(event => event.timelinePosition)) + 1 }); } };
}

async function screenshot(f, name) {
  const path = resolve(output, `${name}.png`); await f.page.screenshot({ path, fullPage: true }); report.screenshots.push(path);
}
async function noWrites(f, label) {
  assert.deepEqual(f.writes, [], `${label}: no mutation, turn, QA preparation or execution`);
  assert.deepEqual(f.unexpected, [], `${label}: all API reads are fixture-defined`);
  assert.deepEqual(f.external, [], `${label}: no external traffic`);
}
async function openNavigation(f) {
  if (f.width < 992 && !(await f.page.locator('#app-sidebar').getAttribute('class')).includes('sidebar--mobile-open')) {
    await f.page.locator('.sidebar-mobile-bar button').first().click();
    await f.page.locator('#app-sidebar[role=dialog]').waitFor();
  }
}
async function closeNavigation(f) {
  if (f.width < 992 && (await f.page.locator('#app-sidebar').getAttribute('class')).includes('sidebar--mobile-open')) await f.page.keyboard.press('Escape');
}
function toolButton(f, tool) { return f.page.locator('.session-tools-buttons').getByRole('button', { name: text(f.locale, tool), exact: true }); }
async function openTool(f, tool) {
  const button = toolButton(f, tool); await button.scrollIntoViewIfNeeded(); await button.click();
  await f.page.locator('.session-tools-panel').waitFor(); return button;
}
async function escapeTools(f, button) {
  // Give desktop Escape a target within the panel; drawer already has focus.
  await f.page.locator('.session-tools-panel__header button').focus(); await f.page.keyboard.press('Escape');
  await f.page.locator('.session-tools-panel').waitFor({ state: 'detached' });
  assert.equal(await button.evaluate(element => element === document.activeElement), true, 'Escape restores the exact invoking tool');
}
async function assertViewport(f, label, panel = false) {
  const bounds = await f.page.evaluate(() => {
    const tool = document.querySelector('.session-tools-panel'), body = tool?.querySelector('.session-tools-panel__body');
    const textarea = document.querySelector('.test-session .composer-textarea');
    const send = document.querySelector('.test-session .composer-send-btn');
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
      panel: tool?.getBoundingClientRect().toJSON(), body: body?.getBoundingClientRect().toJSON(),
      panelRole: tool?.getAttribute('role'), bodyScrollWidth: body?.scrollWidth, bodyClientWidth: body?.clientWidth,
      textarea: textarea?.getBoundingClientRect().toJSON(), send: send?.getBoundingClientRect().toJSON() };
  });
  assert.ok(bounds.scrollWidth <= bounds.width + 1, `${label}: document horizontal overflow ${JSON.stringify(bounds)}`);
  if (panel) {
    assert.ok(bounds.panel?.x >= -1 && bounds.panel.right <= bounds.width + 1 && bounds.panel.y >= -1 && bounds.panel.bottom <= bounds.height + 1,
      `${label}: panel is clipped ${JSON.stringify(bounds)}`);
    assert.ok(bounds.body?.height >= 160, `${label}: panel reading height ${JSON.stringify(bounds)}`);
    assert.ok(bounds.bodyScrollWidth <= bounds.bodyClientWidth + 1, `${label}: panel horizontal overflow`);
    if (f.width <= 991) assert.equal(bounds.panelRole, 'dialog');
    if (bounds.panelRole !== 'dialog') assert.ok(bounds.textarea?.width >= 100, `${label}: writer readable alongside tools`);
  } else {
    await f.page.locator('.test-session .composer-send-btn').scrollIntoViewIfNeeded();
    const writer = await f.page.locator('.test-session .composer-send-btn').boundingBox();
    assert.ok(writer?.y >= 0 && writer.y + writer.height <= f.height + 1, `${label}: send is reachable`);
    assert.ok(bounds.textarea?.width >= 120, `${label}: writing area too narrow`);
  }
  await noWrites(f, label);
}

async function sidebarScenario(f) {
  await openNavigation(f);
  const nav = f.page.locator('.conversation-navigation');
  const recent = nav.locator(':scope > .sidebar-section').nth(1);
  await recent.getByRole('button', { name: 'Independent planning session', exact: true }).waitFor();
  assert.equal(await recent.getByRole('button', { name: 'Login testing session', exact: true }).count(), 0);
  assert.equal(await recent.locator('.sidebar-chat-project').count(), 0, 'Recents never adds a project label');
  assert.equal(await nav.getByRole('button', { name: 'Stale duplicate index title', exact: true }).count(), 0, 'One managed session supersedes a duplicate legacy index row');
  const group = nav.locator('.sidebar-project-group').filter({ has: f.page.locator('.sidebar-project-toggle').filter({ hasText: projects[0].name }) });
  const toggle = group.locator('.sidebar-project-actions button');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  assert.equal(await group.getByRole('button', { name: 'Login testing session', exact: true }).count(), 1);
  await toggle.click();
  assert.equal(await group.getByRole('button', { name: 'Login testing session', exact: true }).count(), 0, 'Collapsing project does not migrate its row into Recent');
  assert.equal(await recent.getByRole('button', { name: 'Login testing session', exact: true }).count(), 0);
  await toggle.click();
  await group.locator('.sidebar-archive > summary').click();
  assert.equal(await group.getByRole('button', { name: 'Archived project session', exact: true }).count(), 1);
  assert.equal(await recent.getByRole('button', { name: 'Archived project session', exact: true }).count(), 0);
  const standaloneArchive = recent.locator(':scope > .sidebar-section-toggle').last();
  await standaloneArchive.click();
  assert.equal(await recent.getByRole('button', { name: 'Archived independent session', exact: true }).count(), 1);
  assert.equal(await nav.locator('.sidebar-unavailable-projects').getByRole('button', { name: 'Retained unavailable-project session', exact: true }).count(), 1);
  assert.equal(await recent.getByRole('button', { name: 'Retained unavailable-project session', exact: true }).count(), 0);
  await screenshot(f, `navigation-${f.locale}-${f.theme}-${f.width}x${f.height}`);
  await closeNavigation(f); await noWrites(f, 'Sidebar partitions and archives');
  passed('strict project/Recent partition, scoped archives, duplicate ID and unavailable-project preservation');
}

async function sourceScenario(f, { screenshots = false } = {}) {
  const writer = f.page.locator('.composer-textarea'); await writer.fill('Unsent follow-up: preserve this draft.');
  const selects = f.page.locator('.composer-setting select');
  assert.equal(await selects.first().locator('option').count(), 6, 'All six conversational tasks remain');
  await selects.first().selectOption('bug_report'); await selects.nth(1).selectOption('gemini-2.5-flash');
  await f.page.locator('.composer input[type=file]').setInputFiles({ name: 'draft-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(hostileText) });
  const attachment = f.page.locator('.attachment-preview-open').filter({ hasText: 'draft-notes.txt' });
  await attachment.click(); await f.page.locator('.session-sources__preview pre').waitFor();
  assert.equal(await f.page.locator('.session-sources__preview pre').innerText(), hostileText);
  assert.equal(await f.page.evaluate(() => window.__previewExecuted), false, 'Text is never executed');
  assert.equal(await f.page.locator('.session-sources__preview script, .session-sources__preview iframe').count(), 0);
  assert.match(await f.page.locator('.session-sources').innerText(), new RegExp(text(f.locale, 'draftSources')));
  assert.equal(await f.page.locator('.session-sources__item').filter({ hasText: 'saved-notes.txt' }).count(), 1);
  if (screenshots) await screenshot(f, `sources-draft-${f.locale}-${f.theme}-${f.width}`);
  await f.page.locator('.session-sources__item').filter({ hasText: 'saved-notes.txt' }).click();
  await f.page.locator('.session-sources__preview pre').waitFor();
  assert.equal(await f.page.locator('.session-sources__preview pre').innerText(), hostileText);
  await f.page.locator('.session-sources__item').filter({ hasText: 'old-metadata-only.txt' }).click();
  await f.page.getByText(text(f.locale, 'previewUnavailable'), { exact: true }).waitFor();
  assert.equal(await f.page.locator('.session-sources__actions a').count(), 0, 'Unavailable historical content has no silent download/open action');
  if (screenshots) await screenshot(f, `sources-unavailable-${f.locale}-${f.theme}-${f.width}`);
  await f.page.locator('.session-sources__item').filter({ hasText: 'retry-notes.txt' }).click();
  await f.page.getByText(text(f.locale, 'previewFailed'), { exact: true }).waitFor();
  f.allowRetryBytes(); await f.page.getByRole('button', { name: text(f.locale, 'retryPreview'), exact: true }).click();
  await f.page.locator('.session-sources__preview pre').waitFor();
  assert.equal(await f.page.locator('.session-sources__preview pre').innerText(), hostileText);
  await f.page.locator('.session-sources__item').filter({ hasText: 'sample.png' }).click();
  await f.page.locator('.session-sources__preview img').waitFor();
  await f.page.waitForFunction(() => { const image = document.querySelector('.session-sources__preview img'); return image?.complete && image.naturalWidth > 0; });
  await escapeTools(f, attachment);
  assert.equal(await writer.inputValue(), 'Unsent follow-up: preserve this draft.');
  assert.equal(await selects.first().inputValue(), 'bug_report');
  assert.equal(await selects.nth(1).inputValue(), 'gemini-2.5-flash');
  assert.equal(await attachment.count(), 1, 'Closing tools does not delete attachment');
  assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible().catch(() => false), false, 'Tool focus alone does not create Back to latest');
  await noWrites(f, 'Sources'); passed('draft/saved TXT safe previews, unavailable metadata, retry, image, modes/model and unsent draft preservation');
}

async function activityScenario(f, { screenshots = false, historical = false } = {}) {
  const button = await openTool(f, 'activity');
  await f.page.locator('.session-activity').waitFor();
  if (historical) {
    assert.match(await f.page.locator('.session-activity__group[data-group=active]').innerText(), /Current login check/);
    assert.match(await f.page.locator('.session-activity__group[data-group=completed]').innerText(), /Earlier approved QA record/);
    assert.match(await f.page.locator('.session-activity').innerText(), new RegExp(text(f.locale, 'activity.viewed')));
    assert.match(await f.page.locator('.session-activity__outcome').innerText(), /FAIL/);
  }
  await f.page.locator('.session-activity__history > summary').click();
  assert.equal(await f.page.locator('.session-activity__history li').count(), 8, 'All primary and routine history entries remain');
  assert.match(await f.page.locator('.session-activity__history').innerText(), new RegExp(text(f.locale, 'events.checkResultRecorded')));
  assert.equal(await f.page.locator('.test-session__conversation').getByText('CHECK_RESULT_RECORDED', { exact: true }).count(), 0);
  if (screenshots) await screenshot(f, `activity-${f.locale}-${f.theme}-${f.width}`);
  if (historical) {
    const currentRow = f.page.locator('.session-activity__group[data-group=active] li[data-kind=request]').filter({ hasText: 'Current login check' });
    await currentRow.getByRole('button', { name: text(f.locale, 'activity.openRequest'), exact: true }).click();
    await f.page.waitForURL('**requestId=request-a');
    assert.match(await f.page.locator('.session-activity__group[data-group=active]').innerText(), /Current login check/);
    assert.equal(await f.page.locator('.session-tools-panel').count(), 1, 'Selecting a record leaves the activity tool open');
  }
  await assertViewport(f, 'Activity reading surface', true); await escapeTools(f, button);
  await noWrites(f, 'Activity'); passed('localized complete history, current versus viewed work and explicit historical request selection');
}

async function resultsScenario(f, { screenshots = false } = {}) {
  const button = await openTool(f, 'results'); await f.page.locator('.test-record__heading').waitFor();
  const failed = f.page.locator('.test-record__check').filter({ hasText: 'Missing marker (intentional failure)' });
  assert.equal(await failed.getAttribute('open'), '', 'Failed/missing requirement is expanded by default');
  assert.match(await failed.innerText(), /FAIL/); assert.match(await failed.innerText(), /Marker absent, as intended/);
  assert.equal(await f.page.locator('.test-record__missing').count(), 1, 'Missing requirement remains actual, not a made-up upload action');
  await assertViewport(f, 'Results panel', true);
  const missing = f.page.locator('.test-record__missing'); await missing.scrollIntoViewIfNeeded();
  const missingBox = await missing.boundingBox(); assert.ok(missingBox && missingBox.height > 20 && missingBox.y < f.height, 'Missing evidence is reachable');
  if (screenshots) await screenshot(f, `results-${f.locale}-${f.theme}-${f.width}x${f.height}`);
  await escapeTools(f, button); await noWrites(f, 'Results');
}

async function accountScenario(f, { screenshotName } = {}) {
  await openNavigation(f);
  assert.equal(await f.page.locator('.sidebar-account-credit, .chat-topbar .badge').count(), 0, 'Credit is not a permanent chat/sidebar adornment');
  await f.page.locator('.sidebar-account-btn').click();
  const usage = f.page.locator('.workspace-navigation__usage'); await usage.waitFor({ state: 'visible' });
  assert.match(await usage.innerText(), /73/); assert.match(await usage.innerText(), /27/);
  assert.equal(await usage.locator('progress').getAttribute('value'), '27');
  if (screenshotName) await screenshot(f, screenshotName);
  await f.page.keyboard.press('Escape'); await closeNavigation(f); await noWrites(f, 'Account usage');
}

async function projectScenario(f) {
  const before = f.reads.length;
  await f.page.goto(`${origin}/#/projects?projectId=project-a`);
  await f.page.locator('.project-detail__header h1').waitFor();
  assert.equal(await f.page.locator('.project-detail__header h1').innerText(), projects[0].name);
  await f.page.locator('.workspace-work-panel').waitFor();
  if (f.width < 992) await f.page.locator('.workspace-work-panel__mobile-toggle').click();
  await f.page.getByText('Project instruction fixture: no real credentials.', { exact: true }).waitFor();
  assert.ok(f.reads.slice(before).some(path => path.endsWith('/instructions')));
  assert.ok(f.reads.slice(before).some(path => path.endsWith('/memory')));
  assert.ok(f.reads.slice(before).some(path => path.endsWith('/documents')));
  assert.equal(await f.page.locator('.session-tools-panel').count(), 0, 'Project management is not the session source panel');
  assert.equal(await f.page.locator('.composer-textarea').count(), 1, 'Project page keeps one writer, not a second session controller');
  assert.equal(await f.page.locator('.project-detail .project-chat-item').filter({ hasText: 'Login testing session' }).count(), 1);
  assert.equal(await f.page.locator('.project-detail .project-chat-item').filter({ hasText: 'Independent planning session' }).count(), 0);
  await screenshot(f, `project-context-${f.locale}-${f.theme}-${f.width}`);
  await noWrites(f, 'Project navigation'); passed('project editing context exists only in project page, shared session list and one writer');
}

async function projectAddChatsLayout(f, name) {
  await f.page.goto(`${origin}/#/projects?projectId=project-a`);
  await f.page.locator('.project-detail__header h1').waitFor();
  const opener = f.page.getByRole('button', { name: projectCatalogs[f.locale]['projects.addChats'], exact: true });
  await opener.click();
  const dialog = f.page.locator('.project-add-chats-modal');
  await dialog.waitFor();
  assert.equal(await dialog.locator('.project-add-chat-item').count(), 3, 'Managed candidates are present; QA-linked/archived rows are not movable');
  await dialog.getByRole('checkbox').first().check();
  const submit = dialog.getByRole('button', { name: projectCatalogs[f.locale]['projects.addChats.addSelected'], exact: true });
  assert.equal(await submit.isEnabled(), true);
  await submit.scrollIntoViewIfNeeded();
  const bounds = await submit.boundingBox();
  assert.ok(bounds && bounds.y >= 0 && bounds.y + bounds.height <= f.height + 1, `${name}: modal submit stays reachable`);
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: dialog has no horizontal overflow`);
  await screenshot(f, `add-chats-${name}`);
  await f.page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true, 'Project Add chats Escape restores opener');
  await noWrites(f, 'Project Add chats layout');
}

async function projectIntegrationsScenario(f, name) {
  await f.page.goto(`${origin}/#/projects?projectId=project-a`);
  await f.page.locator('.project-detail__header h1').waitFor();
  const writer = f.page.locator('.composer-textarea');
  await writer.fill('Unsent project draft survives integrations');
  if (f.width >= 992) {
    const toggle = f.page.locator('.session-panel-toggle');
    if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
    assert.equal(await f.page.locator('.workspace-work-panel').isVisible(), false);
  }
  const opener = f.page.locator('.project-detail__integrations');
  assert.equal(await opener.innerText(), projectCatalogs[f.locale]['projects.integrations.title']);
  await opener.click();
  const dialog = f.page.locator('.project-integrations-dialog');
  await dialog.waitFor();
  assert.equal(await f.page.locator('.project-integrations-dialog').count(), 1, 'One project-owned integrations dialog');
  assert.equal(await dialog.locator('.qa-modal-eyebrow').textContent(), projects[0].name);
  assert.ok(f.reads.includes('/api/projects/project-a/connections'));
  await dialog.getByText(projectCatalogs[f.locale]['projects.integrations.noProfiles'], { exact: true }).waitFor();
  assert.ok(f.reads.includes('/api/projects/project-a/qa/runner-profiles'));
  assert.equal(await dialog.locator('.workspace-feedback--error').count(), 0);
  const headerBounds = await dialog.locator('.modal-header').evaluate(header => {
    const title = header.querySelector('div').getBoundingClientRect();
    const close = header.querySelector('.btn-close').getBoundingClientRect();
    return { title: title.toJSON(), close: close.toJSON() };
  });
  assert.ok(headerBounds.title.right <= headerBounds.close.left - 8 || headerBounds.close.right <= headerBounds.title.left - 8,
    `${name}: dialog title and close control need an RTL-safe gap ${JSON.stringify(headerBounds)}`);
  await dialog.getByRole('button', { name: projectCatalogs[f.locale]['projects.integrations.manageRunners'], exact: true }).scrollIntoViewIfNeeded();
  assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: integrations fits viewport`);
  await screenshot(f, `integrations-${name}`);
  await f.page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true, 'Integrations restores header opener');
  assert.equal(await writer.inputValue(), 'Unsent project draft survives integrations');
  await screenshot(f, `integrations-entry-${name}`);
  if (f.width >= 992) await f.page.locator('.session-panel-toggle').click();
  else await f.page.locator('.workspace-work-panel__mobile-toggle').click();
  const footer = f.page.locator('.project-context__integrations');
  await footer.click(); await dialog.waitFor();
  await f.page.keyboard.press('Escape'); await dialog.waitFor({ state: 'detached' });
  assert.equal(await footer.evaluate(element => element === document.activeElement), true, 'Same dialog restores footer opener');
  await noWrites(f, 'Project integrations discovery');
}

async function newSessionScenario(f, name, { longDraft = false } = {}) {
  await openNavigation(f);
  await f.page.locator('.sidebar-nav button').click();
  const welcome = f.page.locator('.test-session__welcome');
  await welcome.waitFor();
  assert.equal(await welcome.locator('h2').innerText(), text(f.locale, 'start.heading'));
  assert.equal(await f.page.locator('.topbar-title').innerText(), text(f.locale, 'start.title'));
  assert.equal(await f.page.locator('.test-session__scroll .project-chat-list, .test-session__scroll .project-chat-item, .test-session .chat-message-turn').count(), 0,
    'New session contains no saved-history list or messages');
  assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible().catch(() => false), false, 'No latest-navigation in an empty session');
  assert.equal(await f.page.locator('.session-tools-panel').count(), 0);
  try { await f.page.waitForFunction(() => {
    const heading = document.querySelector('.test-session__welcome h2');
    const scroll = document.querySelector('.test-session__scroll');
    const writer = document.querySelector('.session-composer-dock');
    if (!heading || !scroll || !writer) return false;
    const h = heading.getBoundingClientRect(), s = scroll.getBoundingClientRect(), w = writer.getBoundingClientRect();
    return h.top >= s.top - 1 && h.bottom <= Math.min(s.bottom, w.top) + 1;
  }); } catch (error) {
    report.emptyStartFailure = await f.page.evaluate(() => {
      const selectors = ['.test-session__main', '.test-session__scroll', '.test-session__welcome h2', '.session-composer-dock'];
      return selectors.map(selector => {
        const element = document.querySelector(selector);
        return { selector, rect: element?.getBoundingClientRect().toJSON(), scrollTop: element?.scrollTop,
          scrollHeight: element?.scrollHeight, clientHeight: element?.clientHeight, className: element?.className };
      });
    });
    await screenshot(f, `empty-start-failure-${name}`); throw error;
  }
  const glyphs = await f.page.locator('.session-tools-buttons button svg').evaluateAll(elements => elements.map(svg => svg.innerHTML));
  assert.equal(glyphs.length, 2, 'Sources and Activity are available without a fake Results tool');
  assert.equal(new Set(glyphs).size, 2, 'Sources and Activity have distinct glyphs');
  for (const tool of ['sources', 'activity']) {
    const button = toolButton(f, tool);
    assert.equal(await button.getAttribute('title'), text(f.locale, tool));
    assert.equal(await button.evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)', 'Quiet, unboxed tool buttons');
  }
  assert.doesNotMatch(await f.page.locator('body').innerText(), /sessionTools\./, 'Live page has registered translations');
  await screenshot(f, `new-session-${name}`);
  await assertViewport(f, `${name}: new session`);
  if (await f.page.locator('.test-session__main').evaluate(element => element.classList.contains('session-canvas--flow'))) {
    await screenshot(f, `new-session-writer-reachable-${name}`);
  }
  const opener = await openTool(f, 'activity');
  await f.page.getByText(text(f.locale, 'activity.empty'), { exact: true }).waitFor();
  assert.doesNotMatch(await f.page.locator('.session-tools-panel').innerText(), /sessionTools\./);
  await assertViewport(f, `${name}: empty activity`, true);
  await screenshot(f, `new-session-activity-${name}`);
  await escapeTools(f, opener);
  if (longDraft) {
    const draft = 'Unsent working draft\n'.repeat(40);
    await f.page.locator('.composer-textarea').fill(draft);
    await f.page.locator('.composer input[type=file]').setInputFiles({ name: 'unsent.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent context, not execution evidence') });
    // Reproduce native overflow from welcome/padding without any real entries.
    const scroll = f.page.locator('.test-session__scroll');
    await scroll.evaluate(element => {
      element.style.setProperty('padding-bottom', '1200px', 'important');
      element.scrollTop = 0; element.dispatchEvent(new Event('scroll'));
    });
    assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible().catch(() => false), false);
    const sourcesButton = await openTool(f, 'sources');
    await f.page.locator('.session-sources__item').filter({ hasText: 'unsent.txt' }).click();
    await f.page.locator('.session-sources__preview pre').waitFor();
    await escapeTools(f, sourcesButton);
    assert.equal(await f.page.locator('.composer-textarea').inputValue(), draft, 'Opening tools retains the long draft');
    await scroll.evaluate(element => element.style.removeProperty('padding-bottom'));
  }
  await noWrites(f, 'New session and empty tools');
}

async function readingPositionScenario(f) {
  const scroll = f.page.locator('.test-session__scroll');
  await f.page.waitForFunction(() => document.querySelector('.test-session__scroll')?.dataset.followLatest === 'true');
  // Header focus is not itself a request to stop following the conversation.
  await toolButton(f, 'activity').focus();
  assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible(), false);
  const button = await openTool(f, 'activity'); await escapeTools(f, button);
  assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible(), false);
  await scroll.evaluate(element => { element.scrollTop = 0; element.dispatchEvent(new Event('scroll')); });
  await f.page.locator('.session-composer-dock__latest').waitFor({ state: 'visible' });
  const before = await scroll.evaluate(element => element.scrollTop);
  f.appendMessage(); await openTool(f, 'activity');
  await f.page.locator('.session-tools-actions button').last().click();
  await f.page.getByText('A later recorded message must not move the reader.', { exact: true }).waitFor({ state: 'attached' });
  const after = await scroll.evaluate(element => element.scrollTop);
  assert.ok(Math.abs(after - before) <= 2, `Later state refresh moved reader from ${before} to ${after}`);
  await screenshot(f, 'older-reading-retained-en-light'); await escapeTools(f, button);
  await f.page.locator('.session-composer-dock__latest').click();
  await f.page.waitForFunction(() => document.querySelector('.test-session__scroll')?.dataset.followLatest === 'true');
  assert.equal(await f.page.locator('.session-composer-dock__latest').isVisible(), false);
  await noWrites(f, 'Reading position'); passed('header/tool focus does not interrupt following; older reading and explicit return to latest are preserved');
}

async function mobileDeactivationScenario(f) {
  const writer = f.page.locator('.composer-textarea'); await writer.fill('KeepAlive mobile draft');
  await f.page.locator('.composer input[type=file]').setInputFiles({ name: 'kept-mobile.txt', mimeType: 'text/plain', buffer: Buffer.from('Preserved without sending') });
  const button = await openTool(f, 'sources');
  assert.equal(await f.page.locator('.session-tools-panel').getAttribute('role'), 'dialog');
  assert.equal(await f.page.locator('#app').evaluate(element => element.inert), true);
  await f.page.evaluate(() => { window.location.hash = '/settings'; });
  await f.page.waitForURL('**#/settings');
  await f.page.locator('.session-tools-panel').waitFor({ state: 'detached' });
  assert.equal(await f.page.locator('#app').evaluate(element => element.inert), false, 'Hidden KeepAlive tool must not keep the application inert');
  await f.page.evaluate(() => { window.location.hash = '/projects'; });
  await f.page.waitForURL('**#/projects'); await f.page.locator('.projects-search').waitFor();
  assert.equal(await f.page.locator('.session-tools-panel').count(), 0);
  await f.page.evaluate(() => { window.location.hash = '/chat?sessionId=session-a&projectId=project-a&requestId=request-a'; });
  await f.page.waitForFunction(() => document.querySelector('.composer-textarea')?.value === 'KeepAlive mobile draft');
  assert.equal(await f.page.locator('.session-tools-panel').count(), 0, 'Returning never revives an old open tool');
  assert.equal(await f.page.locator('#app').evaluate(element => element.inert), false);
  assert.match(await f.page.locator('.attachment-preview').innerText(), /kept-mobile.txt/);
  await noWrites(f, 'Mobile deactivation'); passed('mobile Sources deactivation removes Teleport/inert and preserves unsent file/text');
  // Verify the retained header still has a usable source opener.
  await button.click(); await escapeTools(f, button);
  await button.click();
  const firstSource = f.page.locator('.session-sources__list li').filter({ hasText: 'saved-notes.txt' });
  await firstSource.getByRole('button', { name: text(f.locale, 'fromMessage'), exact: true }).click();
  await f.page.locator('.session-tools-panel').waitFor({ state: 'detached' });
  await f.page.waitForFunction(() => document.activeElement?.matches('[data-message-id]'));
  assert.match(await writer.inputValue(), /KeepAlive mobile draft/);
  await noWrites(f, 'Sources message focus'); passed('mobile source navigation restores focus to the original message, not the drawer opener');
}

async function authenticationScenarios() {
  const ownedHash = '#/chat?sessionId=session-a&projectId=project-a&requestId=historical-request';
  const delayed = await setup({ authentication: 'held', initialHash: ownedHash, theme: 'dark' });
  try {
    const gate = delayed.page.locator('main > .workspace-feedback');
    assert.equal(await gate.getAttribute('role'), 'status');
    assert.equal(await delayed.page.locator('.composer-textarea').count(), 0, 'Unresolved identity must never expose the guest writer');
    assert.equal(await delayed.page.locator('.composer button[type=submit]').count(), 0);
    assert.equal(delayed.reads.filter(path => path === '/api/auth/me').length, 1);
    assert.equal(delayed.reads.some(path => path.startsWith('/api/sessions')), false, 'Owned session loading waits for identity');
    await delayed.page.locator('body').press('Enter');
    await noWrites(delayed, 'Held authentication before release');
    assert.equal(new URL(delayed.page.url()).hash, ownedHash);
    await screenshot(delayed, 'auth-held-no-guest-composer');
    delayed.releaseAuth();
    await delayed.page.locator('.test-session .chat-message-turn').first().waitFor();
    await delayed.page.locator('.test-session .composer-textarea').fill('Unsent after the account identity is known');
    assert.equal(await delayed.page.locator('.test-session .topbar-title').innerText(), 'Login testing session');
    assert.equal(new URL(delayed.page.url()).hash, ownedHash, 'Identity resolution preserves the explicitly selected historical request');
    assert.ok(delayed.reads.includes('/api/sessions/session-a'));
    await noWrites(delayed, 'Held authentication recovery');
    passed('held auth identity shows no guest composer or mutation; release restores the exact owned session/request');
  } finally { delayed.releaseAuth(); await delayed.context.close(); }

  const failed = await setup({ authentication: 'unavailable', initialHash: ownedHash, theme: 'dark' });
  try {
    const gate = failed.page.locator('main > .workspace-feedback');
    assert.equal(await gate.getAttribute('role'), 'alert');
    assert.equal(await failed.page.locator('.composer-textarea').count(), 0, 'An identity read failure is not a confirmed guest');
    assert.equal(failed.reads.filter(path => path === '/api/auth/me').length, 1, 'No silent auth retry');
    assert.equal(new URL(failed.page.url()).hash, ownedHash);
    await failed.page.locator('body').press('Enter');
    await noWrites(failed, 'Failed authentication before retry');
    await screenshot(failed, 'auth-read-failure-explicit-retry');
    failed.allowAuthRead();
    await gate.getByRole('button', { name: 'Try again', exact: true }).click();
    await failed.page.locator('.test-session .chat-message-turn').first().waitFor();
    await failed.page.locator('.test-session .composer-textarea').fill('Unsent after explicit identity retry');
    assert.equal(failed.reads.filter(path => path === '/api/auth/me').length, 2);
    assert.equal(new URL(failed.page.url()).hash, ownedHash);
    assert.equal(await failed.page.locator('main > .workspace-feedback[role=alert]').count(), 0);
    await noWrites(failed, 'Failed authentication explicit recovery');
    passed('auth 503 preserves owned destination and blocks guest submission; explicit retry recovers without mutations');
  } finally { await failed.context.close(); }

  const guest = await setup({ guest: true, initialHash: '#/chat' });
  try {
    const writer = guest.page.locator('.composer-textarea');
    assert.equal(await guest.page.locator('.test-session').count(), 0);
    assert.equal(await writer.isEnabled(), true);
    await writer.fill('Confirmed guest draft remains available');
    assert.equal(await guest.page.locator('.composer button[type=submit]').isEnabled(), true);
    assert.equal(guest.reads.filter(path => path === '/api/auth/me').length, 1);
    assert.equal(guest.reads.some(path => path.startsWith('/api/sessions')), false);
    await noWrites(guest, 'Confirmed unscoped guest');
    passed('confirmed guest 401 unlocks the unscoped composer without creating or reading an owned session');
  } finally { await guest.context.close(); }

  for (const [name, hash] of [
    ['canonical session', ownedHash],
    ['legacy QA request', '#/tests?projectId=project-a&requestId=historical-request'],
    ['project page', '#/projects?projectId=project-a'],
  ]) {
    const owned = await setup({ guest: true, initialHash: hash });
    try {
      const gate = owned.page.locator('main > .workspace-feedback');
      assert.equal(await owned.page.locator('.composer-textarea').count(), 0);
      assert.equal(await gate.getByRole('button', { name: 'Try again', exact: true }).count(), 0, 'A confirmed guest is not a transport error');
      assert.equal(new URL(owned.page.url()).hash, hash);
      assert.equal(owned.reads.some(path => /^\/api\/(sessions|projects)(?:\/|$)/.test(path)), false, 'No private data reads before sign-in');
      await owned.page.locator('body').press('Enter');
      await noWrites(owned, `Guest owned ${name}`);
      await gate.getByRole('button', { name: 'Sign in', exact: true }).click();
      await owned.page.waitForURL('**#/login');
      await owned.page.locator('#login-email').waitFor();
      assert.equal(await owned.page.locator('.composer-textarea').count(), 0);
      // Choosing a new unscoped destination is explicit, not an auth fallback.
      await owned.page.evaluate(() => { window.location.hash = '/chat'; });
      await owned.page.waitForURL('**#/chat');
      await owned.page.locator('.composer-textarea').fill('A separate unscoped guest draft');
      assert.equal(await owned.page.locator('.test-session').count(), 0);
      await noWrites(owned, `Guest owned ${name} sign-in navigation`);
      passed(`confirmed guest cannot submit an owned ${name}; sign-in and explicit unscoped navigation remain available`);
    } finally { await owned.context.close(); }
  }
}

async function guestPreviewScenario() {
  const f = await setup({ guest: true, width: 390, height: 667, theme: 'dark' });
  try {
    await f.page.locator('.composer-textarea').fill('Unsent guest text');
    await f.page.locator('.composer input[type=file]').setInputFiles({ name: 'guest-notes.txt', mimeType: 'text/plain', buffer: Buffer.from(hostileText) });
    const attachment = f.page.locator('.attachment-preview-open').filter({ hasText: 'guest-notes.txt' });
    await attachment.click(); await f.page.locator('.session-sources__preview pre').waitFor();
    assert.equal(await f.page.locator('.session-sources__preview pre').innerText(), hostileText);
    assert.equal(await f.page.evaluate(() => window.__previewExecuted), false);
    await escapeTools(f, attachment);
    assert.equal(await f.page.locator('.composer-textarea').inputValue(), 'Unsent guest text');
    assert.equal(await attachment.count(), 1);
    await noWrites(f, 'Guest preview'); passed('guest composer reuses the safe TXT preview and retains unsent text/file');
  } finally { await f.context.close(); }
}

async function resizingToolsScenario() {
  const f = await setup({ theme: 'dark' });
  try {
    const writer = f.page.locator('.composer-textarea');
    await writer.fill('Keep the same writer and source while resizing.');
    const opener = await openTool(f, 'sources');
    await f.page.locator('.session-sources__item').filter({ hasText: 'saved-notes.txt' }).click();
    await f.page.locator('.session-sources__preview pre').waitFor();
    const assetReads = () => f.reads.filter(path => path.includes('/api/assets/')).length;
    const readsBefore = assetReads();
    for (const [width, height, role] of [[1024, 900, 'dialog'], [390, 667, 'dialog'], [1440, 900, 'complementary']]) {
      await f.page.setViewportSize({ width, height });
      f.width = width; f.height = height;
      await f.page.waitForFunction(expected => document.querySelector('.session-tools-panel')?.getAttribute('role') === expected, role);
      assert.equal(await f.page.locator('.session-sources__preview pre').innerText(), hostileText, 'Resize retains selected preview');
      assert.equal(await writer.inputValue(), 'Keep the same writer and source while resizing.');
      assert.equal(await f.page.locator('.session-tools-panel').count(), 1);
      assert.equal(await f.page.locator('#app').evaluate(element => element.inert), role === 'dialog', 'Only modal drawers make the workspace inert');
      await assertViewport(f, `Resized Sources ${width}`, true);
    }
    assert.equal(assetReads(), readsBefore, 'Resize does not restart saved source access');
    await escapeTools(f, opener);
    assert.equal(await f.page.locator('#app').evaluate(element => element.inert), false);
    await noWrites(f, 'Resize tools'); passed('same tool/source and writer survive split/drawer/mobile resize with modal cleanup');
  } finally { await f.context.close(); }
}

try {
  // Larger behavioral journeys first; all contexts are closed before the next opens.
  if (!process.env.SESSION_TOOLS_SMOKE_ONLY || process.env.SESSION_TOOLS_SMOKE_BEHAVIOR_ONLY) {
    await authenticationScenarios();
    for (const sessionIndex of ['omitted', 'unavailable']) {
      const restored = await setup({ savedDestination: true, historical: true, sessionIndex });
      try {
        const scope = new URLSearchParams(restored.page.url().split('?')[1]);
        assert.equal(scope.get('sessionId'), 'session-a');
        assert.equal(scope.get('projectId'), 'project-a');
        assert.equal(scope.get('requestId'), 'historical-request', 'Restoration preserves the selected historical request');
        assert.ok(restored.reads.includes('/api/sessions/session-a'));
        assert.ok(restored.reads.includes('/api/projects/project-a/qa/requests/historical-request'));
        await restored.page.reload(); await restored.page.locator('.chat-message-turn').first().waitFor();
        assert.ok(restored.page.url().includes('requestId=historical-request'), 'Explicit reload keeps historical scope');
        await activityScenario(restored, { historical: true });
        await noWrites(restored, `Saved destination with ${sessionIndex} list`);
        passed(`owned saved destination and historical request restore with ${sessionIndex} sidebar list; current QA remains distinct`);
      } finally { await restored.context.close(); }
    }
    const f = await setup({ theme: 'dark' });
    try {
      await sidebarScenario(f); await sourceScenario(f, { screenshots: true });
      await activityScenario(f, { screenshots: true }); await resultsScenario(f, { screenshots: true });
      await accountScenario(f, { screenshotName: 'account-usage-en-dark-1440' }); await projectScenario(f);
      await projectIntegrationsScenario(f, 'en-dark-behavior'); passed('project integrations stays reachable with collapsed context; one scoped dialog, draft and Escape focus preserved');
    } finally { await f.context.close(); }
    const historical = await setup({ locale: 'ar', theme: 'dark', historical: true });
    try { await activityScenario(historical, { screenshots: true, historical: true }); } finally { await historical.context.close(); }
    const reader = await setup({ longHistory: true });
    try { await readingPositionScenario(reader); } finally { await reader.context.close(); }
    const mobile = await setup({ width: 390, height: 667, theme: 'dark' });
    try { await mobileDeactivationScenario(mobile); } finally { await mobile.context.close(); }
    const empty = await setup({ theme: 'dark', unavailableProject: false });
    try {
      await newSessionScenario(empty, 'en-dark-behavior', { longDraft: true });
      passed('empty start keeps history in navigation; translated distinct tools and long unsent draft do not create work or false latest-navigation');
    } finally { await empty.context.close(); }
    const projectless = await setup({ locale: 'de' });
    try {
      await projectless.page.goto(`${origin}/#/chat?sessionId=standalone-session`);
      await projectless.page.locator('.chat-message-turn').first().waitFor();
      assert.ok(projectless.page.url().includes('sessionId=standalone-session'));
      await projectless.page.reload(); await projectless.page.locator('.chat-message-turn').first().waitFor();
      assert.ok(projectless.page.url().includes('sessionId=standalone-session'));
      await noWrites(projectless, 'Projectless canonical reload'); passed('projectless canonical session restored without creating work');
    } finally { await projectless.context.close(); }
    await guestPreviewScenario();
    await resizingToolsScenario();
  }
  for (const [width, height] of [[1440, 900], [1024, 900], [992, 900], [991, 900], [390, 844], [320, 740], [390, 667], [320, 568]]) {
    if (process.env.SESSION_TOOLS_SMOKE_BEHAVIOR_ONLY) break;
    for (const locale of ['en', 'ar', 'de']) for (const theme of ['light', 'dark']) {
      const name = `${locale}-${theme}-${width}x${height}`;
      if (process.env.SESSION_TOOLS_SMOKE_ONLY && !process.env.SESSION_TOOLS_SMOKE_ONLY.split(',').some(selected => [name, `${locale}-${theme}-${width}`].includes(selected))) continue;
      const f = await setup({ width, height, locale, theme });
      try {
        await f.page.locator('.composer-textarea').fill('Preserved mobile/desktop draft');
        assert.equal(await f.page.locator('.composer-setting select').first().locator('option').count(), 6);
        assert.equal(await f.page.locator('.answer table').count(), 1); assert.equal(await f.page.locator('.answer pre code').count(), 1);
        await assertViewport(f, `${name}: closed tools`); await screenshot(f, `closed-${name}`);
        const sourceButton = await openTool(f, 'sources');
        await f.page.locator('.session-sources__item').filter({ hasText: 'saved-notes.txt' }).click();
        await f.page.locator('.session-sources__preview pre').waitFor();
        await assertViewport(f, `${name}: source preview`, true); await escapeTools(f, sourceButton);
        const activityButton = await openTool(f, 'activity');
        await assertViewport(f, `${name}: activity`, true); await escapeTools(f, activityButton);
        await resultsScenario(f, { screenshots: true });
        await accountScenario(f, { screenshotName: `account-${name}` });
        assert.equal(await f.page.locator('.composer-textarea').inputValue(), 'Preserved mobile/desktop draft');
        await assertViewport(f, `${name}: controls restored`);
        await projectAddChatsLayout(f, name);
        await projectIntegrationsScenario(f, name);
        await newSessionScenario(f, name); passed(name);
      } finally { await f.context.close(); }
    }
  }
  assert.deepEqual(report.errors, [], 'No browser runtime errors');
  console.log(`Completed ${checks} read-only scenarios; no real API writes or outbound provider calls.`);
} catch (error) {
  report.errors.push(error.stack || String(error)); throw error;
} finally {
  await reportWrites;
  await writeFile(resolve(output, 'report.json'), JSON.stringify({ ...report, checks }, null, 2));
  await browser.close();
}
