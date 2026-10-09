// All API responses and mutations below are in-memory fixtures. External traffic
// is blocked; no actual provider, account, database or Runner is contacted.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.UX_SMOKE_URL || 'http://127.0.0.1:5182';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local preview only');
const output = resolve('work/test-session-validation', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
console.log(`Screenshots: ${output}`);
// Playwright normally hides headless scrollbars, masking dock/rail overlap.
const browser = await chromium.launch({ headless: true, ignoreDefaultArgs: ['--hide-scrollbars'] });
const timestamp = '2026-09-23T12:00:00.000Z';
const copy = value => structuredClone(value);
let checks = 0;
const errors = [];
const passed = name => { checks++; console.log(`PASS ${name}`); };
const toolsCopy = Object.fromEntries(await Promise.all(['en', 'ar', 'de'].map(async locale => [locale,
  JSON.parse(await readFile(new URL(`../src/i18n/messages/${locale}/sessionTools.json`, import.meta.url), 'utf8'))])));
const profile = { id: 'profile-a', runnerRegistrationId: 'registration-a', runnerName: 'Fixture local Runner', runnerInstanceId: 'fixture-instance', runnerVersion: '0.1.0', key: 'local', label: 'Local browser', environmentKind: 'LOCAL', status: 'ONLINE', supportedRecipeVersions: [1], valueRefs: [], evidenceKinds: ['TEXT'], manifestHash: 'fixture-manifest', lastSeenAt: timestamp };
const assessment = { id: 'assessment-a', status: 'PASSED', summary: 'Reviewed fixture.', suggestions: [], createdAt: timestamp, completedAt: timestamp };
function detail(state = 'ready') {
  const items = [1, 2].map(index => ({ checklistItemId: `item-${index}`, ordinal: index, steps: [{ ref: `open-${index}`, action: 'navigate', path: '/login', waitUntil: 'domcontentloaded' }, { ref: `check-${index}`, action: 'expect', expectation: { kind: 'visible', locator: { by: 'role', role: 'heading', name: index === 1 ? 'Welcome back' : 'Missing marker' } } }] }));
  const result = {
    id: 'request-a', projectId: 'project-a', title: 'Login browser smoke test', objective: 'Check the public login page without signing in. The missing marker intentionally fails.', phase: ({ ready: 'READY_TO_RUN', running: 'RUNNING', review: 'READY_FOR_REVIEW', missing: 'EVIDENCE_NEEDED', approved: 'APPROVED' })[state], version: 4, createdAt: timestamp, updatedAt: timestamp, target: 'https://example.test/login', environment: 'Local', selectedArtifactId: 'artifact-a', contextSnapshots: [],
    artifacts: [{ id: 'artifact-a', requestId: 'request-a', revision: 1, origin: 'ODDPATH_GENERATED', title: 'Login checklist', lockedAt: timestamp, createdAt: timestamp, assessments: [copy(assessment)], items: [1, 2].map(index => ({ id: `item-${index}`, artifactId: 'artifact-a', ordinal: index, clientRef: `check-${index}`, title: index === 1 ? 'Welcome heading is visible' : 'Missing marker (intentional failure)', category: 'Smoke', priority: 'P1', preconditions: [], steps: ['Open the public login page.', 'Check heading visibility.'], expectedResult: index === 1 ? 'Welcome back is visible.' : 'Missing marker is visible.', createdAt: timestamp, evidenceRequirements: [{ id: `requirement-${index}`, checklistItemId: `item-${index}`, ordinal: 1, kind: 'TEXT', description: 'Record the observed visibility result.', required: true, createdAt: timestamp }] })) }],
    executionRecipes: [{ id: 'recipe-a', requestId: 'request-a', artifactId: 'artifact-a', revision: 1, origin: 'ODDPATH_GENERATED', title: 'Login browser Recipe', schemaVersion: 1, executorKey: 'playwright', recipeHash: 'recipe-a-immutable-hash', profileManifest: null, profileManifestHash: profile.manifestHash, supersedesRecipeId: null, items, bundle: { schemaVersion: 1, engine: 'playwright', items }, assessments: [copy(assessment)], createdAt: timestamp }],
    operations: [], runs: [], reviews: [], events: [{ id: 'event-a', sequence: 1, type: 'checklist_submitted', actorKind: 'SYSTEM', transport: 'SYSTEM', createdAt: timestamp }],
  };
  if (state !== 'ready') {
    result.runs = [{ id: 'run-a', requestId: result.id, artifactId: 'artifact-a', status: state === 'running' ? 'ACTIVE' : 'RESULTS_SUBMITTED', outcome: state === 'running' ? 'NOT_RUN' : 'FAIL', version: 3, sourceLabel: 'Fixture Playwright', startedAt: timestamp, submittedAt: state === 'running' ? null : timestamp, createdAt: timestamp, updatedAt: timestamp, executionMode: 'PLAYWRIGHT', executionJob: { id: 'job-a', runId: 'run-a', recipeId: 'recipe-a', runnerRegistrationId: profile.runnerRegistrationId, profileKey: profile.key, status: state === 'running' ? 'RUNNING' : 'SUCCEEDED', completedItems: state === 'running' ? 1 : 2, totalItems: 2, failureCode: null, failureMessage: null, createdAt: timestamp, updatedAt: timestamp, completedAt: state === 'running' ? null : timestamp }, results: [1, 2].map(index => ({ id: `result-${index}`, runId: 'run-a', checklistItemId: `item-${index}`, status: index === 1 ? 'PASS' : 'FAIL', observedResult: index === 1 ? 'Welcome heading observed.' : 'Marker absent, as intended.', notes: null, createdAt: timestamp, updatedAt: timestamp })), evidence: [1, 2].filter(index => state !== 'missing' || index === 1).map(index => ({ id: `evidence-${index}`, runId: 'run-a', checklistItemId: `item-${index}`, requirementId: `requirement-${index}`, actorKind: 'INTEGRATION', transport: 'REST', kind: 'TEXT', textContent: index === 1 ? 'Observed welcome heading.' : 'Observed absence of marker.', externalReference: null, metadata: null, assets: [], createdAt: timestamp })) }];
  }
  return result;
}
function session(request = null) {
  return { id: 'session-a', projectId: 'project-a', title: 'Login testing session', version: 3, archivedAt: null, createdAt: timestamp, updatedAt: timestamp, currentRequestId: request?.id || null, phase: request?.phase || 'DRAFT', requestIds: request ? [request.id] : [], requests: request ? [request] : [], messages: [{ id: 'message-user', timelinePosition: 1, role: 'user', content: 'Test the public login page, without signing in.', model: null, createdAt: timestamp }, { id: 'message-assistant', timelinePosition: 2, role: 'assistant', content: 'I will check the login controls and record the results. **Execution needs your approval.**\n\n| Check | Expected |\n| --- | --- |\n| Login | Visible |\n\n```js\nconst mode = "public";\n```', model: 'fixture', createdAt: timestamp }], events: request ? [{ ...request.events[0], timelinePosition: 3, requestId: request.id, title: request.title }] : [], pendingProposal: null, preparation: null, turnStatus: null };
}
async function setup({ state = 'ready', width = 1440, height = 900, locale = 'en', theme = 'light', interactive = false, profileStatus = 'ONLINE', profilesError = false, reviewStatus = 'PASSED', navigationFixtures = false, proposal = false, production = false, preparation = null, longHistory = false, currentRunning = false, previousPendingReview = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage(); page.setDefaultTimeout(12000);
  let request = state === 'draft' ? null : detail(state);
  if (request) request.executionRecipes[0].assessments[0].status = reviewStatus;
  let record = session(request);
  const earlierReview = previousPendingReview ? { ...detail('review'), id: 'earlier-review', title: 'Earlier pending login review' } : null;
  if (earlierReview) { record.requests.push(earlierReview); record.requestIds.push(earlierReview.id); }
  if (currentRunning) { record.currentRequestId = 'request-current'; record.requests.push({ ...detail('running'), id: 'request-current', title: 'Current run, not the displayed historical result' }); }
  record.preparation = preparation;
  if (proposal) record.pendingProposal = { id: 'proposal-a', title: 'Refine login smoke test', objective: 'Review a follow-up without rewriting the previous results.', target: 'https://example.test/login', environment: 'Local', sourceMessageIds: ['message-user'], ready: true };
  if (longHistory) { record.messages = Array.from({ length: 30 }, (_, index) => ({ ...record.messages[index % 2], timelinePosition: index + 1, id: `history-${index}`, content: `Message ${index}: ` + 'Preserve reading position and keep controls reachable. '.repeat(6) })); record.events.forEach((event, index) => { event.timelinePosition = record.messages.length + index + 1; }); }
  const nextPosition = () => Math.max(0, ...record.messages.map(item => item.timelinePosition || 0), ...record.events.map(item => item.timelinePosition || 0)) + 1;
  const qaEvent = type => record.events.push({ id: `event-${type}`, requestId: request.id, title: request.title, type, sequence: record.events.length + 1, timelinePosition: nextPosition(), createdAt: timestamp });
  let requestError = false;
  const writes = [], unexpected = [];
  const user = { id: 'fixture-user', name: 'QA Fixture', email: 'qa@example.test', locale, createdAt: timestamp, emailVerifiedAt: timestamp };
  const project = { id: 'project-a', name: 'Browser QA project', description: 'Isolated test fixture', role: 'OWNER', createdAt: timestamp, updatedAt: timestamp };
  const otherProject = { ...project, id: 'project-b', name: 'Shared knowledge / مشروع مشترك / Gemeinsamer Projektkontext' };
  const normalChat = { id: 'chat-b', projectId: 'project-b', title: 'Planning in Chat', mode: 'general', model: 'gemini-3.1-flash-lite', messages: [{ id: 'chat-message', role: 'user', content: 'Plan our shared project.', mode: 'general', model: 'gemini-3.1-flash-lite', createdAt: timestamp }], createdAt: timestamp, updatedAt: timestamp };
  let activated = false;
  const promoted = { ...session(null), managed: true, id: normalChat.id, projectId: normalChat.projectId, title: normalChat.title,
    messages: normalChat.messages.map((message, index) => ({ ...message, timelinePosition: index + 1, model: null })) };
  let indexFailure = false, invalidUsage = false, moveFailure = false;
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ locale, theme }) => { localStorage.setItem('ai_qa_assistant_locale', locale); localStorage.setItem('ai_qa_assistant_theme', theme); }, { locale, theme });
  await context.route('**/*', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname;
    if (!path.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (req.method() !== 'GET') {
      const body = req.postDataJSON(); writes.push({ path, method: req.method(), body });
      if (!interactive) return json({ error: 'Read-only fixture' }, 405);
      if (path === '/api/sessions/chat-b' && req.method() === 'PATCH') {
        assert.equal(body.projectId, 'project-a');
        assert.equal(body.expectedSessionVersion, promoted.version);
        assert.equal(body.expectedUpdatedAt, promoted.updatedAt);
        if (moveFailure) return json({ error: 'Fixture move rejected; refresh and retry.', code: 'STALE_VERSION' }, 409);
        promoted.projectId = body.projectId; promoted.version++;
        promoted.updatedAt = '2026-09-23T12:01:00.000Z';
        return json({ session: promoted });
      }
      if (path.endsWith('/test-sessions/activate')) {
        assert.equal(path.includes('/project-b/'), true);
        assert.deepEqual(body, { chatId: normalChat.id, expectedUpdatedAt: timestamp, expectedMessageCount: 1 });
        activated = true;
        return json({ session: promoted });
      }
      if (path.endsWith('/turns')) {
        record.version++;
        record.messages.push({ timelinePosition: nextPosition(), id: `followup-user-${record.version}`, role: 'user', content: body.content, createdAt: timestamp, model: null });
        if (body.content.startsWith('Test ')) record.pendingProposal = { id: 'proposal-a', title: 'Login smoke', objective: 'Verify login controls without signing in.', target: 'https://example.test/login', environment: 'Local', acceptanceNotes: 'No credentials', sourceMessageIds: [record.messages.at(-1).id], ready: true };
        else record.messages.push({ timelinePosition: nextPosition(), id: `report-${record.version}`, role: 'assistant', content: 'Report after QA: failed checks remain failed. No release approval was granted.', createdAt: timestamp, model: 'fixture' });
        return json({ session: record, turnId: 'turn-a' }, 202);
      }
      if (path.endsWith('/prepare')) { assert.equal(body.proposalId, 'proposal-a'); request = detail(); record = { ...record, version: record.version + 1, pendingProposal: null, currentRequestId: request.id, requests: [request], phase: request.phase, requestIds: [request.id] }; qaEvent('checklist_submitted'); return json({ session: record }); }
      if (path.endsWith('/runs')) { assert.equal(body.recipeHash, 'recipe-a-immutable-hash'); assert.equal(body.expectedRequestVersion, request.version); assert.equal(body.runnerRegistrationId, profile.runnerRegistrationId); request = detail('review'); record.requests = [request]; record.phase = request.phase; qaEvent('run_results_submitted'); return json({ request, runId: 'run-a' }); }
      if (path.endsWith('/reviews')) { assert.equal(body.expectedRunVersion, 3); assert.equal(body.decision, 'APPROVED'); request = detail('approved'); record.requests = [request]; record.phase = request.phase; qaEvent('HUMAN_REVIEW_RECORDED'); return json({ request }); }
      unexpected.push(`${req.method()} ${path}`); return json({ error: 'Unexpected mutation' }, 500);
    }
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/auth/csrf') return json({ csrfToken: 'fixture-csrf' });
    if (path === '/api/usage/summary') return json(invalidUsage ? {} : { limit: 100, remaining: 73, used: 27, unit: 'credits' });
    if (path === '/api/ai/models') return json({ models: [] });
    if (path === '/api/settings') return json({ settings: { defaultModel: 'gemini-3.1-flash-lite', language: locale, theme, updatedAt: timestamp } });
    if (path === '/api/projects') return json({ projects: navigationFixtures ? [project, otherProject] : [project] });
    if (path === '/api/chats') return json({ chats: navigationFixtures && !activated ? [normalChat] : [] });
    if (path === '/api/sessions') {
      if (indexFailure) return json({ error: 'Fixture index offline' }, 503);
      if (path.includes('/project-b/')) return json({ sessions: activated ? [promoted] : [], unlinkedRequests: [] });
      return json({ sessions: navigationFixtures ? [record, promoted, { ...record, id: 'session-archived', title: 'Archived login session', archivedAt: timestamp }] : [record], unlinkedRequests: navigationFixtures ? [{ ...detail('approved'), id: 'legacy-request', title: 'Legacy approved result' }] : [] });
    }
    if (path === '/api/sessions/session-a') return json({ session: record });
    if (path === '/api/sessions/chat-b') return json({ session: promoted });
    if (navigationFixtures && path === '/api/sessions/session-archived') return json({ session: { ...record, id: 'session-archived', title: 'Archived login session', archivedAt: timestamp } });
    if (navigationFixtures && path.endsWith('/qa/requests/legacy-request')) return json({ request: { ...detail('approved'), id: 'legacy-request', title: 'Legacy approved result' } });
    if (path.endsWith('/runner-profiles')) return profilesError ? json({ error: 'Fixture profile read failure' }, 503) : json({ profiles: profileStatus ? [{ ...profile, status: profileStatus, environmentKind: production ? 'PRODUCTION' : 'LOCAL' }] : [] });
    if (path.endsWith('/connections')) return json({ connections: [] });
    if (path.endsWith('/qa/requests/request-a')) return requestError ? json({ error: 'Fixture read failed' }, 503) : json({ request });
    if (earlierReview && path.endsWith('/qa/requests/earlier-review')) return json({ request: earlierReview });
    if (path.endsWith('/instructions')) return json({ instruction: { projectId: path.split('/')[3], content: 'Never submit real credentials.', updatedAt: timestamp } });
    if (path.endsWith('/memory')) return json({ memory: { projectId: path.split('/')[3], content: 'Public login smoke coverage.', source: 'USER', updatedAt: timestamp } });
    if (path.endsWith('/documents')) return json({ documents: [] });
    unexpected.push(`${req.method()} ${path}`); return json({ error: 'Unexpected read' }, 500);
  });
  await page.goto(`${origin}/#/tests?projectId=project-a&sessionId=session-a${request ? '&requestId=request-a' : ''}`);
  await page.waitForFunction(({ locale, theme }) => document.documentElement.lang === locale && document.documentElement.dataset.theme === theme, { locale, theme });
  await page.locator('.chat-message-turn').first().waitFor();
  assert.equal(await page.locator('.session-tools-panel').count(), 0, 'Session tools start closed; navigation alone opens no work surface');
  return { context, page, locale, width, writes, unexpected, setMoveFailure(value) { moveFailure = value; }, setIndexFailure(value) { indexFailure = value; }, setInvalidUsage(value) { invalidUsage = value; }, failRead(value) { requestError = value; }, changeRequestVersion() { request.version++; }, appendMessage() { record.messages.push({ ...record.messages[1], timelinePosition: nextPosition(), id: 'new-status-message', content: 'A later update must not move the reader.' }); } };
}
async function frame(f, name, readOnly = true) {
  await f.page.locator('.composer-send-btn').scrollIntoViewIfNeeded();
  const bounds = await f.page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, text: document.querySelector('.test-session .composer-textarea')?.getBoundingClientRect().toJSON(), send: document.querySelector('.test-session .composer-send-btn')?.getBoundingClientRect().toJSON() }));
  assert.ok(bounds.scrollWidth <= bounds.width + 1, `${name}: horizontal overflow ${JSON.stringify(bounds)}`);
  assert.ok(bounds.text?.width > 50, `${name}: writing surface reachable`);
  assert.ok(bounds.send?.top >= 0 && bounds.send?.bottom <= bounds.height + 1, `${name}: send button clipped ${JSON.stringify(bounds)}`);
  assert.ok(bounds.text?.top >= 0 && bounds.text?.bottom <= bounds.height + 1, `${name}: text entry clipped`);
  assert.deepEqual(f.unexpected, [], `${name}: unknown API request`);
  if (readOnly) assert.deepEqual(f.writes, [], `${name}: viewing must not mutate`);
  passed(name);
}
async function screenshot(f, name) { await f.page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); }
async function openDecision(f) {
  await f.page.waitForTimeout(120);
  const trigger = f.page.locator('.session-composer-dock__summary button');
  if (await trigger.isVisible() && await trigger.getAttribute('aria-expanded') !== 'true') await trigger.click();
}
function toolButton(f, tool) {
  return f.page.locator('.session-tools-buttons').getByRole('button', { name: toolsCopy[f.locale][`sessionTools.${tool}`], exact: true });
}
async function openTool(f, tool) {
  const button = toolButton(f, tool);
  if (await button.getAttribute('aria-expanded') !== 'true') await button.click();
  await f.page.locator('.session-tools-panel').waitFor();
  return button;
}
async function closeTool(f, opener) {
  await f.page.locator('.session-tools-panel__header button').focus();
  await f.page.keyboard.press('Escape');
  await f.page.locator('.session-tools-panel').waitFor({ state: 'detached' });
  assert.equal(await opener.evaluate(element => element === document.activeElement), true, 'Escape restores the tool opener');
}
async function refreshRequest(f) {
  const opener = await openTool(f, 'activity');
  const response = f.page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/qa/requests/request-a'));
  await f.page.locator('.session-tools-actions').getByRole('button', { name: 'Refresh', exact: true }).click();
  await response;
  await f.page.waitForFunction(() => document.querySelector('.session-activity')?.getAttribute('aria-busy') !== 'true');
  await closeTool(f, opener);
}
async function accountUsage(f) {
  if (f.width < 992) await f.page.locator('.sidebar-mobile-bar button').first().click();
  await f.page.locator('.sidebar-account-btn').click();
  const usage = f.page.locator('.workspace-navigation__usage');
  await usage.waitFor({ state: 'visible' });
  const value = await usage.innerText();
  await f.page.keyboard.press('Escape');
  if (f.width < 992) await f.page.keyboard.press('Escape');
  return value;
}
async function expandProject(f, name) {
  const group = f.page.locator('.sidebar-project-group').filter({ has: f.page.locator('.sidebar-project-toggle').filter({ hasText: name }) });
  const toggle = group.locator('.sidebar-project-actions button');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

try {
  const journey = await setup({ state: 'draft', interactive: true, navigationFixtures: true });
  const page = journey.page;
  const identity = new URL(page.url()).hash;
  assert.equal(await page.getByRole('button', { name: 'Start a test', exact: true }).count(), 0);
  await page.locator('.composer-textarea').fill('Test https://example.test/login on local without signing in');
  await page.waitForTimeout(100);
  await page.locator('.composer button[type=submit]').click();
  await openDecision(journey);
  await screenshot(journey, 'journey-after-turn');
  await page.getByRole('button', { name: 'Prepare this test', exact: true }).waitFor();
  assert.equal(journey.writes.length, 1, 'Discussion only queues a conversational turn');
  assert.equal(new URL(page.url()).hash.includes('sessionId=session-a'), true);
  await page.getByRole('button', { name: 'Prepare this test', exact: true }).click();
  await openDecision(journey);
  const approve = page.locator('.qa-run-approval__action button');
  await approve.waitFor();
  assert.equal(await approve.isEnabled(), false);
  await page.locator('.qa-run-approval__confirmation input').first().check();
  await approve.click();
  await page.locator('.test-session__review').waitFor();
  await page.getByRole('button', { name: 'Approve record', exact: true }).click();
  await page.locator('.test-session__review').waitFor({ state: 'detached' });
  assert.deepEqual(journey.writes.map(item => item.path.split('/').at(-1)), ['turns', 'prepare', 'runs', 'reviews']);
  assert.ok(page.url().includes('sessionId=session-a'), 'QA never changes conversation identity');
  assert.equal(identity.includes('sessionId=session-a'), true);
  assert.equal(await page.locator('.sidebar-account-credit').count(), 0, 'Credits are not permanently displayed outside the account menu');
  assert.match(await accountUsage(journey), /73/, 'Authoritative credits remain accessible in the account menu');
  await page.locator('.composer-textarea').fill('Write a report of these results');
  await page.locator('.composer button[type=submit]').click();
  await page.getByText('Report after QA:', { exact: false }).waitFor();
  assert.equal(await page.locator('.answer table').count(), 1, 'Shared Markdown tables survive QA');
  assert.equal(await page.locator('.answer pre code').count(), 1, 'Shared code rendering survives QA');
  const orderedText = await page.locator('.test-session__conversation').innerText();
  const reviewLabel = toolsCopy.en['sessionTools.events.humanReviewRecorded'];
  assert.ok(orderedText.indexOf(reviewLabel) >= 0 && orderedText.indexOf(reviewLabel) < orderedText.indexOf('Report after QA:'), 'Persisted QA review precedes the later assistant report, even with equal timestamps');
  assert.equal(journey.writes.filter(item => item.path.endsWith('/turns')).length, 2);
  await frame(journey, 'one session: message → preparation → exact approval → review', false);
  await screenshot(journey, 'unified-journey-approved');
  const journeyResults = await openTool(journey, 'results');
  await page.locator('.test-record__heading').waitFor();
  assert.match(await page.locator('.test-record__check').filter({ hasText: 'Missing marker (intentional failure)' }).innerText(), /FAIL/);
  await screenshot(journey, 'unified-journey-approved-results');
  await closeTool(journey, journeyResults);
  await journey.context.close();

  const nav = await setup({ navigationFixtures: true, state: 'approved', theme: 'dark' });
  await nav.page.locator('.composer-textarea').fill('QA unsent private draft');
  await nav.page.locator('.composer input[type=file]').setInputFiles({ name: 'private-draft.txt', mimeType: 'text/plain', buffer: Buffer.from('Draft, not execution evidence') });
  await nav.page.locator('.attachment-preview').waitFor();
  await nav.page.waitForTimeout(150);
  await nav.page.reload();
  await nav.page.waitForFunction(() => document.querySelector('.composer-textarea')?.value === 'QA unsent private draft');
  assert.match(await nav.page.locator('.attachment-preview').innerText(), /private-draft.txt/);
  await expandProject(nav, 'Shared knowledge');
  await nav.page.locator('#app-sidebar').getByRole('button', { name: /^Planning in Chat/ }).click();
  await nav.page.waitForURL('**/chat?sessionId=chat-b&projectId=project-b');
  await nav.page.locator('.chat-message-turn').filter({ hasText: 'Plan our shared project.' }).waitFor();
  await nav.page.locator('.composer-textarea').fill('Other project draft');
  await nav.page.locator('#app-sidebar').getByRole('button', { name: /^Login testing session/ }).click();
  await nav.page.waitForFunction(() => document.querySelector('.composer-textarea')?.value === 'QA unsent private draft');
  assert.match(await nav.page.locator('.attachment-preview').innerText(), /private-draft.txt/);
  assert.deepEqual(nav.writes, [], 'Navigation, legacy links, reload and attachments do not create QA work');
  assert.deepEqual(nav.unexpected, []);
  passed('same shared session canvas, owner/project drafts and attachment reload');
  await nav.context.close();

  const discussion = await setup({ interactive: true, state: 'ready', theme: 'dark' });
  await openDecision(discussion);
  const discussionConsent = discussion.page.locator('.qa-run-approval__confirmation input').first();
  await discussionConsent.check();
  discussion.setIndexFailure(true); discussion.setInvalidUsage(true);
  await discussion.page.locator('.composer-textarea').fill('Explain this plan without running it');
  await discussion.page.locator('.composer button[type=submit]').click();
  await discussion.page.getByText('Report after QA:', { exact: false }).waitFor();
  assert.ok(await discussionConsent.isChecked(), 'Ordinary discussion does not invalidate unchanged run consent');
  assert.match(await accountUsage(discussion), /73/, 'An incomplete usage response never clears the previous authoritative credit');
  assert.ok(await discussion.page.locator('#app-sidebar').getByRole('button', { name: /^Login testing session$/ }).isVisible(), 'Failed index refresh preserves this owner\'s session row');
  assert.equal(discussion.writes.length, 1, 'Discussion never authorizes QA');
  await screenshot(discussion, 'discussion-preserves-consent-and-credit');
  await discussion.context.close();
  passed('ordinary discussion preserves exact consent, credits and index on read failure');

  const running = await setup({ interactive: true, state: 'running' });
  await running.page.locator('.composer-textarea').fill('Explain the current progress');
  await running.page.locator('.composer button[type=submit]').click();
  await running.page.getByText('Report after QA:', { exact: false }).waitFor();
  assert.deepEqual(running.writes.map(item => item.path.split('/').at(-1)), ['turns'], 'Discuss while QA runs without restarting or cancelling it');
  await running.context.close(); passed('discussion remains available during active QA');

  const menus = await setup({ navigationFixtures: true });
  const menuTrigger = menus.page.locator('#app-sidebar .sidebar-session-row').first().getByRole('button', { name: /^Actions for/ });
  await menuTrigger.click();
  const popup = menus.page.locator('.sidebar-session-menu__body');
  await popup.getByRole('button', { name: 'Rename', exact: true }).click();
  assert.equal(await popup.locator('input').evaluate(element => element === document.activeElement), true);
  const popupBounds = await popup.boundingBox();
  assert.ok(popupBounds.x >= 0 && popupBounds.y >= 0 && popupBounds.x + popupBounds.width <= 1440 && popupBounds.y + popupBounds.height <= 900, 'Teleported menu stays inside the viewport');
  await screenshot(menus, 'session-menu-keyboard');
  await menus.page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached' });
  assert.equal(await menuTrigger.evaluate(element => element === document.activeElement), true, 'Escape restores the invoking menu button');
  assert.deepEqual(menus.writes, []); await menus.context.close(); passed('session menu remains visible and restores keyboard focus');

  const production = await setup({ production: true, theme: 'dark' });
  await openDecision(production);
  const consent = production.page.locator('.qa-run-approval__confirmation input').first();
  await consent.check();
  assert.equal(await production.page.locator('.qa-run-approval__action button').isEnabled(), false);
  await production.page.locator('.qa-run-approval__confirmation--production input').check();
  assert.equal(await production.page.locator('.qa-run-approval__action button').isEnabled(), true);
  await production.page.locator('.qa-run-approval__details-trigger').click();
  await screenshot(production, 'production-exact-approval');
  await production.page.keyboard.press('Escape');
  production.changeRequestVersion();
  await refreshRequest(production);
  await openDecision(production);
  assert.equal(await consent.isChecked(), false, 'Record version change invalidates explicit approval');
  production.failRead(true);
  await refreshRequest(production);
  await production.page.locator('.workspace-feedback--error').first().waitFor();
  assert.equal(await production.page.locator('.qa-run-approval__action button').isVisible(), false);
  await frame(production, 'production consent and stale/read-error safety');
  await production.context.close();

  const priorReview = await setup({ state: 'approved', proposal: true, previousPendingReview: true, theme: 'dark' });
  await priorReview.page.locator('.test-session__pending-review').filter({ hasText: 'Earlier pending login review' }).click();
  await priorReview.page.waitForURL('**/*requestId=earlier-review');
  await openDecision(priorReview);
  await priorReview.page.locator('.test-session__review').waitFor();
  assert.equal(await priorReview.page.locator('.test-session__proposal').count(), 0, 'Explicit review supersedes, but does not delete, the new proposal');
  const activityOpener = await openTool(priorReview, 'activity');
  for (let index = 0; index < 2; index++) {
    const refreshed = priorReview.page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname.endsWith('/qa/requests/earlier-review'));
    await priorReview.page.locator('.session-tools-actions').getByRole('button', { name: 'Refresh', exact: true }).click();
    await refreshed;
    await priorReview.page.waitForFunction(() => document.querySelector('.session-activity')?.getAttribute('aria-busy') !== 'true');
    await priorReview.page.locator('.test-session__review').waitFor();
    assert.equal(await priorReview.page.locator('.test-session__proposal').count(), 0, 'Repeated session DTO refresh preserves the selected review');
  }
  await closeTool(priorReview, activityOpener);
  await openDecision(priorReview);
  assert.equal(await priorReview.page.getByRole('button', { name: 'Approve record', exact: true }).isEnabled(), true);
  await screenshot(priorReview, 'earlier-review-keeps-selection-with-new-proposal');
  assert.deepEqual(priorReview.writes, [], 'Selecting and refreshing a review never approves or prepares anything');
  assert.deepEqual(priorReview.unexpected, []);
  await priorReview.context.close(); passed('earlier pending review persists alongside a new proposal through repeated refresh');

  const move = await setup({ interactive: true, state: 'approved', navigationFixtures: true });
  await move.page.goto(`${origin}/#/projects?projectId=project-a`);
  await move.page.locator('.project-detail__header h1').waitFor();
  await move.page.getByRole('button', { name: 'Add Chats', exact: true }).click();
  const addDialog = move.page.locator('.project-add-chats-modal');
  await addDialog.waitFor();
  assert.equal(await addDialog.locator('.project-add-chat-item').count(), 1, 'Unified index exposes only the eligible, unlinked session in another project');
  const selection = addDialog.getByRole('checkbox');
  await selection.check();
  move.setMoveFailure(true);
  await addDialog.getByRole('button', { name: 'Add selected', exact: true }).click();
  await addDialog.getByRole('alert').waitFor();
  assert.equal(await selection.isChecked(), true, 'A failed server move keeps the owner selection and dialog');
  assert.equal(await addDialog.getByRole('button', { name: 'Add selected', exact: true }).isEnabled(), true);
  await screenshot(move, 'project-add-session-retains-failed-selection');
  move.setMoveFailure(false);
  await addDialog.getByRole('button', { name: 'Add selected', exact: true }).click();
  await addDialog.waitFor({ state: 'detached' });
  await move.page.locator('.project-detail .project-chat-list .project-chat-item').filter({ hasText: 'Planning in Chat' }).waitFor();
  assert.deepEqual(move.writes.map(item => [item.method, item.path]), [
    ['PATCH', '/api/sessions/chat-b'], ['PATCH', '/api/sessions/chat-b'],
  ], 'Explicit retry only uses managed version-guarded moves, no legacy snapshot save or QA work');
  assert.deepEqual(move.unexpected, []);
  await screenshot(move, 'project-add-session-managed-move');
  await move.context.close(); passed('signed-in Add chats uses unified sessions and preserves failed selection for retry');

  const openMove = await setup({ interactive: true, state: 'draft', navigationFixtures: true });
  await openMove.page.goto(`${origin}/#/chat?projectId=project-b&sessionId=chat-b`);
  await openMove.page.locator('.chat-message-turn').first().waitFor();
  const unsentMoveText = 'Keep this unsent draft when its session changes project';
  await openMove.page.locator('.composer-textarea').fill(unsentMoveText);
  await openMove.page.locator('.composer input[type=file]').setInputFiles({
    name: 'move-context.txt', mimeType: 'text/plain', buffer: Buffer.from('Unsent local context, not execution evidence.'),
  });
  await openMove.page.locator('.attachment-preview-name').filter({ hasText: 'move-context.txt' }).waitFor();
  await expandProject(openMove, 'Shared knowledge / مشروع مشترك / Gemeinsamer Projektkontext');
  await openMove.page.locator('#app-sidebar .sidebar-session-row').filter({ hasText: 'Planning in Chat' })
    .getByRole('button', { name: /^Actions for/ }).click();
  await openMove.page.locator('.sidebar-session-menu__body select').selectOption('project-a');
  await openMove.page.waitForURL(url => url.hash.includes('sessionId=chat-b') && url.hash.includes('projectId=project-a'));
  assert.equal(await openMove.page.locator('.composer-textarea').inputValue(), unsentMoveText);
  await openMove.page.locator('.attachment-preview-name').filter({ hasText: 'move-context.txt' }).waitFor();
  await openMove.page.reload();
  await openMove.page.waitForFunction(text => document.querySelector('.composer-textarea')?.value === text, unsentMoveText);
  await openMove.page.locator('.attachment-preview-name').filter({ hasText: 'move-context.txt' }).waitFor();
  assert.deepEqual(openMove.writes.map(item => [item.method, item.path]), [['PATCH', '/api/sessions/chat-b']],
    'Moving and reloading the open session must not submit its draft, upload attachments or start QA');
  assert.deepEqual(openMove.unexpected, []);
  await screenshot(openMove, 'open-session-move-draft-and-attachment-restored');
  await openMove.context.close(); passed('sidebar move preserves open session identity, draft and attachment across reload');

  if (process.env.TEST_SESSION_SMOKE_BEHAVIOR_ONLY !== '1') for (const [width, height] of [[1440,900], [1024,900], [992,900], [991,900], [390,844], [320,740], [390,667], [320,568]]) {
    for (const locale of ['en','ar','de']) for (const theme of ['light','dark']) {
      if (process.env.TEST_SESSION_SMOKE_ONLY && process.env.TEST_SESSION_SMOKE_ONLY !== `${locale}-${theme}-${width}`) continue;
      const f = await setup({ state: 'review', width, height, locale, theme, navigationFixtures: true });
      await f.page.locator('.test-session__menu summary').click();
      await f.page.keyboard.press('Escape');
      assert.equal(await f.page.locator('.test-session__menu').evaluate(el => el.open), false);
      await f.page.locator('.composer-textarea').fill('An unsent follow-up draft');
      await frame(f, `${locale}/${theme} ${width}x${height}`);
      await screenshot(f, `${locale}-${theme}-${width}x${height}`);
      const resultsOpener = await openTool(f, 'results');
      await f.page.locator('.test-record__heading').waitFor();
      const panelBounds = await f.page.locator('.session-tools-panel__body').boundingBox();
      assert.ok(panelBounds?.height >= 160, 'Results reading area stays readable on short phones');
      await screenshot(f, `results-${locale}-${theme}-${width}x${height}`);
      await closeTool(f, resultsOpener);
      if (width < 992) {
        const opener = f.page.locator('.sidebar-mobile-bar button').first();
        await opener.click();
        await f.page.locator('#app-sidebar[role=dialog]').waitFor();
        await screenshot(f, `navigation-${locale}-${theme}-${width}x${height}`);
        await f.page.keyboard.press('Escape');
        assert.equal(await opener.evaluate(el => el === document.activeElement), true);
      }
      await f.page.goto(`${origin}/#/projects?projectId=project-b`);
      await f.page.locator('.project-detail__header h1').waitFor();
      await f.page.locator('.project-chat-list .project-chat-item').first().waitFor();
      assert.equal(await f.page.locator('.project-detail .session-composer-dock .composer-textarea').count(), 1, 'Existing session writer is portaled into the actual project page');
      assert.equal(await f.page.locator('.composer-textarea:visible').count(), 1, 'There is no duplicate writer/controller');
      assert.ok(await f.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
      assert.deepEqual(f.writes, [], 'Opening a shared project never starts work');
      await screenshot(f, `project-${locale}-${theme}-${width}x${height}`);
      await f.context.close();
    }
  }
  assert.deepEqual(errors, [], 'no browser runtime errors');
  console.log(`Completed ${checks} isolated browser scenarios.`);
} finally { await browser.close(); }
