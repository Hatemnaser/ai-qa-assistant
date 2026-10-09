// Isolated, read-only focused Tests UI coverage. All API requests are intercepted;
// external traffic is blocked. No real account, QA record, provider or DB is used.
// Start local Vite, then: node apps/web/scripts/qa-focus-smoke.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.UX_SMOKE_URL || 'http://127.0.0.1:5182';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local preview only');
const output = resolve('work/qa-focus-validation', new Date().toISOString().replaceAll(/[:.]/g, '-'));
await mkdir(output, { recursive: true });
console.log(`Screenshots: ${output}`);
const browser = await chromium.launch({ headless: true });
const timestamp = '2026-09-20T12:00:00.000Z';
const errors = [];
let checks = 0;
const passed = name => { checks++; console.log(`PASS ${name}`); };
const copy = value => structuredClone(value);

function profile(status = 'ONLINE') {
  return { id: 'profile-a', runnerRegistrationId: 'registration-a', runnerName: 'Fixture local Runner', runnerInstanceId: 'fixture-instance', runnerVersion: '0.1.0', key: 'local', label: 'Local browser', environmentKind: 'LOCAL', status, supportedRecipeVersions: [1], valueRefs: [], evidenceKinds: ['TEXT'], manifestHash: 'fixture-manifest', lastSeenAt: timestamp };
}
function assessment(id, status = 'PASSED') {
  return { id, status, summary: status === 'PASSED' ? 'Fixture review completed.' : 'Fixture review needs attention.', suggestions: [], createdAt: timestamp, completedAt: status === 'PENDING' ? null : timestamp };
}
function recipe(id = 'recipe-a', revision = 1, review = 'PASSED', hash = 'fixture-manifest') {
  const items = [1, 2].map(index => ({ checklistItemId: `item-${index}`, ordinal: index, steps: [
    { ref: `open-${index}`, action: 'navigate', path: '/login', waitUntil: 'domcontentloaded' },
    { ref: `check-${index}`, action: 'expect', expectation: { kind: 'visible', locator: { by: 'role', role: 'heading', name: index === 1 ? 'Welcome back' : 'Intentional missing marker' } } },
  ] }));
  return { id, requestId: 'request-a', artifactId: 'artifact-a', revision, origin: 'ODDPATH_GENERATED', title: `Login browser recipe ${revision}`, schemaVersion: 1, executorKey: 'playwright', recipeHash: `${id}-immutable-hash`, profileManifest: null, profileManifestHash: hash, supersedesRecipeId: null, items, bundle: { schemaVersion: 1, engine: 'playwright', items }, assessments: [assessment(`assessment-${id}`, review)], createdAt: timestamp };
}
function detail(state = 'ready') {
  const phases = { ready: 'READY_TO_RUN', sample: 'READY_TO_RUN', review: 'READY_FOR_REVIEW', missing: 'EVIDENCE_NEEDED', approved: 'APPROVED', running: 'RUNNING', failed: 'READY_FOR_REVIEW' };
  const result = {
    id: state === 'sample' ? 'sample-a' : 'request-a', projectId: 'project-a', title: 'Login page browser smoke test', objective: 'Verify the public login controls without signing in. The missing marker is an intentional failed check.', phase: phases[state], version: 4, createdAt: timestamp, updatedAt: timestamp, sample: state === 'sample', target: 'https://example.test/login', environment: 'Local', acceptanceNotes: 'Do not submit credentials.', selectedArtifactId: 'artifact-a', contextSnapshots: [],
    artifacts: [{ id: 'artifact-a', requestId: 'request-a', revision: 1, origin: 'ODDPATH_GENERATED', title: 'Login smoke checklist', lockedAt: timestamp, createdAt: timestamp, assessments: [assessment('checklist-assessment')], items: [1, 2].map(index => ({ id: `item-${index}`, artifactId: 'artifact-a', ordinal: index, clientRef: `check-${index}`, title: index === 1 ? 'Welcome heading is visible' : 'Intentional missing marker', category: 'Smoke', priority: 'P1', preconditions: ['Use a fresh browser context.'], steps: ['Open the public login page.', 'Check heading visibility.'], expectedResult: index === 1 ? 'Welcome back is visible.' : 'Intentional missing marker is visible.', createdAt: timestamp, evidenceRequirements: [{ id: `requirement-${index}`, checklistItemId: `item-${index}`, ordinal: 1, kind: 'TEXT', description: 'Record the observed visibility result.', required: true, createdAt: timestamp }] })) }],
    executionRecipes: [recipe()], operations: [], runs: [], reviews: [], events: [{ id: 'event-a', sequence: 1, type: 'checklist_submitted', actorKind: 'SYSTEM', transport: 'SYSTEM', metadata: null, createdAt: timestamp }],
  };
  if (!['ready', 'sample'].includes(state)) {
    const evidence = [1, 2].filter(index => state !== 'missing' || index !== 2).map(index => ({ id: `evidence-${index}`, runId: 'run-a', checklistItemId: `item-${index}`, requirementId: `requirement-${index}`, actorKind: 'INTEGRATION', transport: 'REST', kind: 'TEXT', textContent: index === 1 ? 'Observed Welcome back heading.' : 'Observed missing marker; intentional check failure.', externalReference: null, metadata: null, createdAt: timestamp, assets: [] }));
    evidence.push({ id: 'evidence-general', runId: 'run-a', checklistItemId: null, requirementId: null, actorKind: 'INTEGRATION', transport: 'REST', kind: 'TEXT', textContent: 'General execution context evidence.', externalReference: null, metadata: null, createdAt: timestamp, assets: [] });
    result.runs = [{ id: 'run-a', requestId: 'request-a', artifactId: 'artifact-a', status: state === 'running' ? 'ACTIVE' : 'RESULTS_SUBMITTED', outcome: state === 'running' ? 'NOT_RUN' : 'FAIL', version: 3, sourceLabel: 'Fixture Playwright', externalRunRef: null, commitSha: null, startedAt: timestamp, submittedAt: state === 'running' ? null : timestamp, createdAt: timestamp, updatedAt: timestamp, executionMode: 'PLAYWRIGHT', executionJob: { id: 'job-a', runId: 'run-a', recipeId: 'recipe-a', runnerRegistrationId: 'registration-a', profileKey: 'local', status: state === 'running' ? 'RUNNING' : state === 'failed' ? 'FAILED' : 'SUCCEEDED', completedItems: state === 'running' ? 1 : 2, totalItems: 2, failureCode: state === 'failed' ? 'RUNNER_FAILED' : null, failureMessage: state === 'failed' ? 'Fixture Runner stopped before finishing.' : null, completedAt: state === 'running' ? null : timestamp, createdAt: timestamp, updatedAt: timestamp }, results: [1, 2].filter(index => state !== 'running' || index === 1).map(index => ({ id: `result-${index}`, runId: 'run-a', checklistItemId: `item-${index}`, status: index === 1 ? 'PASS' : 'FAIL', observedResult: index === 1 ? 'Heading is visible.' : 'The marker is not present.', notes: null, createdAt: timestamp, updatedAt: timestamp })), evidence }];
    if (state === 'approved') result.reviews = [{ id: 'review-a', runId: 'run-a', artifactId: 'artifact-a', decision: 'APPROVED', comment: 'Intentional failure accurately recorded.', runVersion: 3, createdAt: timestamp }];
  }
  return result;
}

async function setup({ state = 'ready', request = detail(state), profiles = [profile()], width = 1440, height = 900, locale = 'en', theme = 'light', secondRequest = false, responseStatuses = {}, waitForChecklist = true, noProjects = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const unexpected = [];
  const writes = [];
  const user = { id: 'fixture-user', name: 'QA Fixture', email: 'qa@example.test', locale, createdAt: timestamp, emailVerifiedAt: timestamp };
  const project = { id: 'project-a', name: 'Browser QA project', description: 'Isolated UI validation fixture.', role: 'OWNER', createdAt: timestamp, updatedAt: timestamp };
  const alternate = { ...copy(request), id: 'request-b', title: 'Second test request' };
  const requests = request.sample ? [] : [request, ...(secondRequest ? [alternate] : [])];
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ locale, theme }) => {
    localStorage.setItem('ai_qa_assistant_locale', locale);
    localStorage.setItem('ai_qa_assistant_theme', theme);
  }, { locale, theme });
  await context.route('**/*', async route => {
    const req = route.request();
    const url = new URL(req.url());
    if (!url.pathname.startsWith('/api/')) return url.origin === origin ? route.continue() : route.abort();
    const path = url.pathname;
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (req.method() !== 'GET') { writes.push(`${req.method()} ${path}`); return json({ error: 'Read-only smoke fixture' }, 405); }
    if (path === '/api/auth/me') return json({ user });
    if (path === '/api/ai/models') return json({ models: [] });
    if (path === '/api/settings') return json({ settings: { defaultModel: 'gemini-3.1-flash-lite', language: locale, theme, updatedAt: timestamp } });
    if (path === '/api/projects') return responseStatuses.projects ? json({ error: 'Fixture project read failure' }, responseStatuses.projects) : json({ projects: noProjects ? [] : [project] });
    if (path === '/api/chats') return json({ chats: [] });
    if (path.endsWith('/connections')) return json({ connections: [] });
    if (path.endsWith('/runner-profiles')) return responseStatuses.profiles ? json({ error: 'Fixture profile read failure' }, responseStatuses.profiles) : json({ profiles });
    if (path.endsWith('/qa/requests')) return json({ requests });
    if (path.endsWith('/qa/sample')) return json({ request });
    if (path.endsWith('/qa/requests/request-b')) return json({ request: alternate });
    if (path.endsWith('/qa/requests/request-a')) return responseStatuses.request ? json({ error: 'Fixture test read failure' }, responseStatuses.request) : json({ request });
    if (path.includes('/qa/operations/')) return json({ operation: request.operations.find(item => path.endsWith(item.operationId)) });
    unexpected.push(`${req.method()} ${path}`);
    return json({ error: 'Unexpected fixture request' }, 500);
  });
  await page.goto(`${origin}/#/`);
  await page.locator('.qa-focused-workspace').waitFor();
  if (waitForChecklist) await page.locator('.qa-check-details').first().waitFor();
  return { context, page, unexpected, writes };
}
async function checkFrame(page, name) {
  const bounds = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth, marked: document.querySelector('.qa-focused-workspace')?.classList.contains('workspace-surface') }));
  assert.equal(bounds.marked, true, `${name}: explicit focused surface`);
  assert.ok(bounds.scrollWidth <= bounds.width + 1, `${name}: horizontal overflow ${JSON.stringify(bounds)}`);
}
async function finish(fixture, name) {
  await checkFrame(fixture.page, name);
  assert.deepEqual(fixture.writes, [], `${name}: opening/reviewing must not write`);
  assert.deepEqual(fixture.unexpected, [], `${name}: all API reads must be fixture-owned`);
  passed(name);
  await fixture.context.close();
}
async function screenshot(page, name) { await page.screenshot({ path: resolve(output, `${name}.png`), fullPage: true }); }
async function openRun(fixture) {
  await fixture.page.locator('.qa-next-action button').click();
  await fixture.page.locator('#qa-playwright-run-title').waitFor();
  const approve = fixture.page.getByRole('button', { name: 'Approve & queue run', exact: true });
  assert.equal(await approve.isEnabled(), false, 'Opening the modal must not pre-approve execution');
  return approve;
}

try {
  const sample = await setup({ state: 'sample' });
  assert.equal(await sample.page.getByRole('button', { name: 'Prepare run', exact: true }).count(), 0, 'Sample cannot start execution');
  assert.equal(await sample.page.getByRole('button', { name: 'Approve QA record', exact: true }).count(), 0, 'Sample cannot approve its record');
  await sample.page.locator('.qa-next-action button').click();
  await sample.page.locator('#qa-request-form-title').waitFor();
  assert.equal(await sample.page.locator('.qa-request-dialog button[type=submit]').isEnabled(), false, 'An untouched create form cannot submit');
  await sample.page.keyboard.press('Escape');
  await sample.page.locator('#qa-request-form-title').waitFor({ state: 'hidden' });
  await screenshot(sample.page, 'sample-light');
  await finish(sample, 'read-only sample can open an empty create form without execution or writes');

  for (const [name, status, review, hash, noRecipes] of [
    ['ready', 'ONLINE', 'PASSED', 'fixture-manifest', false],
    ['no-runner', null, 'PASSED', 'fixture-manifest', false],
    ['offline', 'OFFLINE', 'PASSED', 'fixture-manifest', false],
    ['incompatible', 'INCOMPATIBLE', 'PASSED', 'fixture-manifest', false],
    ['manifest-mismatch', 'ONLINE', 'PASSED', 'other-manifest', false],
    ['review-pending', 'ONLINE', 'PENDING', 'fixture-manifest', false],
    ['review-failed', 'ONLINE', 'FAILED', 'fixture-manifest', false],
    ['recipe-missing', 'ONLINE', 'PASSED', 'fixture-manifest', true],
  ]) {
    const request = detail();
    request.executionRecipes = noRecipes ? [] : [recipe('recipe-a', 1, review, hash)];
    const f = await setup({ request, profiles: status ? [profile(status)] : [] });
    const approve = await openRun(f);
    if (name === 'ready') {
      await f.page.locator('.qa-confirmation input').first().check();
      assert.equal(await approve.isEnabled(), true, 'Reviewed matching profile permits explicit approval');
    } else assert.equal(await approve.isEnabled(), false);
    if (name === 'review-failed') assert.equal(await f.page.getByRole('button', { name: 'Retry review', exact: true }).isEnabled(), true);
    await screenshot(f.page, `run-${name}`);
    await f.page.keyboard.press('Escape');
    await f.page.locator('#qa-playwright-run-title').waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('.qa-next-action button').evaluate(element => element === document.activeElement), true, 'Modal restores primary action focus');
    await finish(f, `${name}: preparation preserves unchanged approval gates`);
  }

  const multiRequest = detail();
  multiRequest.executionRecipes = [recipe('recipe-new', 2, 'FAILED'), recipe('recipe-old', 1)];
  const multi = await setup({ request: multiRequest });
  const approve = await openRun(multi);
  await multi.page.getByRole('combobox', { name: /^Recipe revision/ }).selectOption('recipe-old');
  await multi.page.locator('.qa-confirmation input').first().check();
  assert.equal(await approve.isEnabled(), true);
  await multi.page.getByRole('combobox', { name: /^Recipe revision/ }).selectOption('recipe-new');
  assert.equal(await multi.page.locator('.qa-confirmation input').first().isChecked(), false, 'Revision change clears approval');
  assert.equal(await approve.isEnabled(), false);
  await finish(multi, 'multiple Recipe revisions retain selection and exact-approval reset');

  for (const state of ['running', 'review', 'missing', 'approved', 'failed']) {
    const f = await setup({ state });
    if (state === 'review') {
      await f.page.locator('.qa-next-action button').click();
      assert.equal(await f.page.locator('#qa-human-review').evaluate(element => element === document.activeElement || element.contains(document.activeElement)), true);
      assert.equal(await f.page.getByRole('button', { name: 'Approve QA record', exact: true }).isEnabled(), true);
      assert.ok((await f.page.locator('.qa-focused-workspace').innerText()).includes('FAIL'));
    }
    if (state === 'missing') {
      await f.page.locator('.qa-next-action button').click();
      assert.equal(await f.page.locator('#qa-item-item-2 .qa-check-details').evaluate(element => element.open), true);
      assert.equal(await f.page.locator('#qa-item-item-2').evaluate(element => element === document.activeElement), true, 'Missing evidence focus lands on its checklist item');
      assert.equal(await f.page.getByRole('button', { name: 'Approve QA record', exact: true }).count(), 0);
    }
    if (state === 'approved') assert.equal(await f.page.getByRole('button', { name: 'Approve QA record', exact: true }).count(), 0);
    if (state === 'running') {
      const progress = f.page.getByRole('progressbar');
      assert.equal(await progress.getAttribute('aria-valuenow'), '1');
      assert.equal(await progress.getAttribute('aria-valuemax'), '2');
      assert.ok((await f.page.locator('.qa-focused-workspace').innerText()).includes('1 of 2 checks completed'));
    }
    if (state === 'failed') assert.ok((await f.page.locator('.qa-focused-workspace').innerText()).includes('Fixture Runner stopped'));
    await f.page.locator('.qa-record-details > summary').click();
    await f.page.locator('.qa-record-history > summary').click();
    await f.page.locator('.qa-general-evidence').waitFor();
    await screenshot(f.page, `record-${state}`);
    await finish(f, `${state}: focused state, evidence and record history remain accessible`);
  }

  for (const [width, height] of [[1440, 900], [1024, 900], [992, 900], [991, 900], [390, 667], [320, 568]]) for (const locale of ['en', 'ar', 'de']) for (const theme of ['light', 'dark']) {
    const f = await setup({ state: 'review', width, height, locale, theme, secondRequest: true });
    if (width < 992) {
      await f.page.locator('.qa-list-toggle').click();
      await f.page.locator('.qa-request-list--open').waitFor();
      await f.page.locator('.qa-request-list').getByRole('button', { name: /Second test request/ }).click();
      await f.page.locator('.qa-request-list--open').waitFor({ state: 'hidden' });
      assert.ok((await f.page.locator('.qa-focused-workspace').innerText()).includes('Second test request'));
    }
    await f.page.locator('.qa-next-action button').click();
    await f.page.locator('#qa-human-review').waitFor();
    await screenshot(f.page, `${locale}-${theme}-${width}x${height}`);
    await finish(f, `${locale}/${theme} ${width}x${height}: responsive list and review focus`);
  }
  for (const kind of ['projects', 'request']) {
    const responseStatuses = { [kind]: 500 };
    const f = await setup({ responseStatuses, waitForChecklist: false });
    await f.page.locator('.workspace-feedback--error').waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Prepare run', exact: true }).count(), 0);
    responseStatuses[kind] = 0;
    await f.page.locator('.workspace-feedback--error button').click();
    await f.page.locator('.qa-check-details').first().waitFor();
    assert.equal(await f.page.getByRole('button', { name: 'Prepare run', exact: true }).isEnabled(), true);
    await finish(f, `${kind} read failure offers a real read-only retry`);
  }
  const unavailableProfiles = { profiles: 500 };
  const discovery = await setup({ responseStatuses: unavailableProfiles });
  const discoveryApproval = await openRun(discovery);
  const dialog = discovery.page.getByRole('dialog');
  await dialog.getByRole('alert').waitFor();
  assert.equal(await dialog.getByText('No Runner profile discovered', { exact: true }).count(), 0);
  assert.equal(await discoveryApproval.isEnabled(), false);
  await screenshot(discovery.page, 'profile-discovery-error');
  unavailableProfiles.profiles = 0;
  await dialog.getByRole('button', { name: 'Refresh status', exact: true }).click();
  await dialog.getByRole('combobox', { name: /^Runner profile/ }).waitFor();
  await dialog.locator('.qa-confirmation input').first().check();
  assert.equal(await discoveryApproval.isEnabled(), true);
  await finish(discovery, 'profile discovery error is not an empty Runner list and retry recovers');

  const empty = await setup({ noProjects: true, waitForChecklist: false });
  await empty.page.getByRole('button', { name: 'Create project', exact: true }).waitFor();
  assert.equal(await empty.page.getByRole('button', { name: 'Prepare run', exact: true }).count(), 0);
  await finish(empty, 'no project offers explicit project creation');

  const uncertain = detail('running');
  uncertain.runs[0].executionJob.totalItems = 0;
  uncertain.runs[0].executionJob.completedItems = 0;
  const indeterminate = await setup({ request: uncertain });
  const meter = indeterminate.page.getByRole('progressbar');
  assert.equal(await meter.getAttribute('aria-valuenow'), null);
  assert.equal(await meter.getAttribute('aria-valuemax'), null);
  assert.equal(await meter.locator('span').getAttribute('style'), null);
  await screenshot(indeterminate.page, 'progress-indeterminate');
  await finish(indeterminate, 'unknown progress stays indeterminate, without a guessed percentage');

  for (const [width, height] of [[390, 667], [320, 568]]) for (const locale of ['en', 'ar', 'de']) for (const theme of ['light', 'dark']) {
    const f = await setup({ width, height, locale, theme });
    await f.page.locator('.qa-next-action button').click();
    await f.page.locator('#qa-playwright-run-title').waitFor();
    const dialog = f.page.getByRole('dialog');
    const footer = dialog.locator('.modal-footer');
    const closeButton = dialog.locator('.btn-close');
    const box = await closeButton.boundingBox();
    assert.ok(box && box.y >= 0 && box.y + box.height <= height && box.x >= 0 && box.x + box.width <= width, 'Close target stays within phone');
    await footer.locator('button').last().scrollIntoViewIfNeeded();
    const action = await footer.locator('button').last().boundingBox();
    assert.ok(action && action.y >= 0 && action.y + action.height <= height && action.x >= 0 && action.x + action.width <= width, 'Approval stays reachable on short phone');
    await screenshot(f.page, `modal-${locale}-${theme}-${width}x${height}`);
    await f.page.keyboard.press('Escape');
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await f.page.locator('.qa-next-action button').evaluate(element => element === document.activeElement), true);
    await finish(f, `${locale}/${theme} ${width}x${height}: short-phone modal, Escape and focus`);
  }
  assert.deepEqual(errors, [], 'No browser runtime errors');
  console.log(`Focused QA smoke complete: ${checks} scenarios; zero API writes and page errors. Screenshots: ${output}`);
} catch (error) {
  console.error('Scenario failure:', error);
  console.error('Page errors:', errors);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('Current page:', page.url(), (await page.locator('body').innerText()).slice(0, 2200));
    await page.screenshot({ path: resolve(output, 'failure.png'), fullPage: true }).catch(captureError => console.error('Failure capture:', captureError.message));
  }
  throw error;
} finally { await browser.close(); }
