// Local, isolated UI regression: every API request is intercepted; no accounts,
// provider calls, credentials, QA records or project data are touched.
// Start Vite first, then: node apps/web/scripts/ux-navigation-smoke.mjs
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const origin = process.env.UX_SMOKE_URL || 'http://127.0.0.1:5182';
if (!['127.0.0.1', 'localhost'].includes(new URL(origin).hostname)) throw new Error('Local preview only');
const output = resolve('work/ux-validation');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
const timestamp = '2026-09-13T12:00:00.000Z';
const model = 'gemini-3.1-flash-lite';
const errors = [];
let checks = 0;
const passed = (name) => { checks++; console.log(`PASS ${name}`); };

async function setup({ width = 1440, height = 900, locale = 'en', theme = 'light', empty = false, signedIn = true, delayAuth = false, delaySettings = false, seedActive = false } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, acceptDownloads: true });
  const page = await context.newPage();
  page.setDefaultTimeout(15000);
  const user = { id: 'fixture-user', name: 'QA Fixture', email: 'qa@example.test', locale, createdAt: timestamp, emailVerifiedAt: timestamp };
  const project = { id: 'project-a', name: 'Checkout app', description: 'Requirements, memory and files stay with this project.', role: 'OWNER', createdAt: timestamp, updatedAt: timestamp };
  const projects = empty ? [] : [project, { ...project, id: 'project-b', name: 'Mobile release' }];
  let chats = empty ? [] : [
    { id: 'chat-a', title: 'Checkout regression', projectId: 'project-a', mode: 'general', model, createdAt: timestamp, updatedAt: timestamp, messages: [
      { id: 'question-a', role: 'user', content: 'Help me review the checkout flow without submitting a payment.', mode: 'general', model, createdAt: timestamp },
      { id: 'answer-a', role: 'assistant', content: 'Existing QA conversation.\n\n## A focused checkout review\n\nThe test record remains separate from this chat. We can prepare the checks here; execution still requires approval.\n\n| Check | Expected result |\n| --- | --- |\n| Required fields | Clear, accessible validation |\n| Cart total | Matches the selected items |\n\n```text\nReview → Approve → Execute → Inspect evidence\n```', mode: 'general', model, createdAt: timestamp },
    ] },
    { id: 'chat-b', title: 'Unassigned ideas', projectId: null, mode: 'general', model, createdAt: timestamp, updatedAt: timestamp, messages: [] },
  ];
  const unexpected = [];
  const sent = [];
  const asSession = chat => ({ ...chat, kind: 'SESSION', managed: true, version: chat.version || 1, archivedAt: chat.archivedAt || null, currentRequestId: null, phase: 'DRAFT', requests: [], requestIds: [], events: [], pendingProposal: null, preparation: null, turnStatus: null, messages: chat.messages.map((message, index) => ({ ...message, timelinePosition: index + 1 })) });
  let releaseAuth = () => {};
  let releaseSettings = () => {};
  let markSettingsStarted;
  const settingsStarted = new Promise(resolve => { markSettingsStarted = resolve; });
  const authGate = delayAuth ? new Promise(resolve => { releaseAuth = resolve; }) : Promise.resolve();
  const settingsGate = delaySettings ? new Promise(resolve => { releaseSettings = resolve; }) : Promise.resolve();
  page.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(({ locale, theme, seedActive, chats }) => {
    localStorage.setItem('ai_qa_assistant_locale', locale);
    localStorage.setItem('ai_qa_assistant_theme', theme);
    if (seedActive) for (const suffix of ['', ':user:fixture-user']) {
      localStorage.setItem(`ai_qa_assistant_chats${suffix}`, JSON.stringify(chats));
      localStorage.setItem(`ai_qa_assistant_active_chat_id${suffix}`, 'chat-a');
    }
  }, { locale, theme, seedActive, chats });
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (!url.pathname.startsWith('/api/')) {
      if (url.origin === origin) return route.continue();
      return route.abort();
    }
    const path = url.pathname;
    const method = request.method();
    const body = method === 'GET' ? null : request.postDataJSON();
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });
    if (path === '/api/auth/me') { await authGate; return signedIn ? json({ user }) : json({}, 401); }
    if (path === '/api/auth/csrf') return json({ csrfToken: 'fixture-only' });
    if (path === '/api/auth/login') { signedIn = true; return json({ user, session: { expiresAt: timestamp } }); }
    if (path === '/api/auth/logout') { signedIn = false; return json({ ok: true }); }
    if (path === '/api/ai/models') return json({ models: [] });
    if (path === '/api/settings') { markSettingsStarted(); await settingsGate; return json({ settings: { defaultModel: model, language: locale, theme, updatedAt: timestamp } }); }
    if (path === '/api/memories') return json({ memories: [] });
    if (path === '/api/projects') return json({ projects });
    if (path === '/api/usage/summary') return json({ limit: 100, used: 1, remaining: 99, unit: 'credits' });
    if (path === '/api/sessions') {
      if (method === 'GET') return json({ sessions: chats.map(asSession), unlinkedRequests: [] });
      if (method === 'POST') {
        const chat = { id: body.clientSessionId, projectId: body.projectId || null, title: body.title || 'New QA Chat', mode: 'general', model, createdAt: timestamp, updatedAt: timestamp, messages: [] };
        chats.push(chat); return json({ session: asSession(chat) }, 201);
      }
    }
    if (path.startsWith('/api/sessions/')) {
      const id = path.split('/')[3], chat = chats.find(item => item.id === id);
      if (!chat) return json({ error: 'Session not found' }, 404);
      if (method === 'POST' && path.endsWith('/turns')) {
        sent.push({ ...body, chatId: id, projectId: chat.projectId });
        chat.version = (chat.version || 1) + 1;
        chat.messages.push({ id: `user-${chat.version}`, role: 'user', content: body.content, mode: body.mode, model: body.model, createdAt: timestamp }, { id: `answer-${chat.version}`, role: 'assistant', content: 'Fixture response only.', mode: body.mode, model: body.model, createdAt: timestamp });
        return json({ session: asSession(chat), turnId: `turn-${chat.version}` }, 202);
      }
      if (method === 'PATCH') { Object.assign(chat, body); return json({ session: asSession(chat) }); }
      if (method === 'DELETE') { chats = chats.filter(item => item.id !== id); return route.fulfill({ status: 204 }); }
      if (method === 'GET') return json({ session: asSession(chat) });
    }
    if (path === '/api/chats') return json({ chats });
    if (path.startsWith('/api/chats/')) {
      if (method === 'DELETE') { chats = chats.filter(chat => chat.id !== path.split('/').at(-1)); return json({ ok: true }); }
      if (body?.chat) { chats = [...chats.filter(chat => chat.id !== body.chat.id), body.chat]; return json({ chat: body.chat }); }
    }
    if (path === '/api/chat') { sent.push(body); return json({ reply: 'Fixture response only.', mode: body.mode, model, usage: { limit: 100, used: 1, remaining: 99, unit: 'credits' } }); }
    if (path.endsWith('/instructions')) return json({ instruction: { projectId: path.split('/')[3], content: 'Check keyboard access and checkout errors.', createdAt: timestamp, updatedAt: timestamp } });
    if (path.endsWith('/test-sessions')) return json({ sessions: [], unlinkedRequests: [] });
    if (path.endsWith('/memory')) return json({ memory: { projectId: path.split('/')[3], content: 'Guest checkout is supported.', source: 'USER', createdAt: timestamp, updatedAt: timestamp } });
    if (path.endsWith('/documents')) return json({ documents: [{ id: 'doc-a', projectId: 'project-a', title: 'Requirements.md', content: '# Requirements\nKeep existing upload and export.', source: 'USER_PROVIDED', mimeType: 'text/markdown', metadata: null, createdAt: timestamp, updatedAt: timestamp }] });
    if (path.endsWith('/documents/import')) return json({ documents: body.files.map((file, index) => ({ id: `imported-${file.name}-${index}`, projectId: path.split('/')[3], title: file.name, content: file.content, source: 'IMPORTED', mimeType: file.mimeType, metadata: null, createdAt: timestamp, updatedAt: timestamp })) });
    if (path.endsWith('/connections')) return json({ connections: [] });
    if (path.endsWith('/runner-profiles')) return json({ profiles: [] });
    if (path.endsWith('/requests')) return json({ requests: [] });
    if (path === '/api/assets/initiate') return json({ error: 'Storage unavailable in fixture', code: 'ASSET_STORAGE_DISABLED' }, 503);
    unexpected.push(`${method} ${path}`);
    return json({ error: 'Unexpected fixture request' }, 500);
  });
  return { context, page, unexpected, sent, releaseAuth, releaseSettings, settingsStarted };
}

async function waitHome(page) {
  await page.goto(`${origin}/#/home`);
  await page.locator('.chat-home h1, .test-session__welcome h2').first().waitFor();
  await page.waitForFunction(() => document.querySelector('.sidebar-account') || document.querySelector('.sidebar'));
}

async function assertFrame(page, name) {
  // Wait for ResizeObserver's measured dock before inspecting layout; in the
  // short-height flow fallback the controls are reached through its scroller.
  await page.locator('.composer-send-btn').scrollIntoViewIfNeeded();
  await page.waitForTimeout(100);
  const bounds = await page.evaluate(() => {
    const composer = document.querySelector('.chat-form')?.getBoundingClientRect();
    const controls = [...document.querySelectorAll('.composer-send-btn, .composer-icon-btn, .composer-setting select')]
      .filter(element => element.getClientRects().length)
      .map(element => {
        const rect = element.getBoundingClientRect();
        const target = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2);
        return { className: element.className, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height, uncovered: target === element || element.contains(target) };
      });
    return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth, bottom: composer?.bottom, top: composer?.top, controls };
  });
  assert.ok(bounds.scrollWidth <= bounds.width + 1, `${name}: horizontal overflow ${JSON.stringify(bounds)}`);
  assert.ok(bounds.bottom <= bounds.height + 1 && bounds.top >= 0, `${name}: composer outside viewport ${JSON.stringify(bounds)}`);
  assert.equal(bounds.controls.length, 4, `${name}: attachment, send and native mode/model controls must remain visible`);
  for (const control of bounds.controls) {
    if (!control.uncovered) console.error('Composer overlap diagnostics', name, await page.evaluate(() => {
      const panel = document.querySelector('.workspace-work-panel');
      const content = panel?.querySelector('.workspace-work-panel__content');
      const composer = document.querySelector('.chat-form');
      return { viewport: [innerWidth, innerHeight], panel: panel?.getBoundingClientRect().toJSON(), panelZ: panel && getComputedStyle(panel).zIndex,
        content: content?.getBoundingClientRect().toJSON(), contentMax: content && getComputedStyle(content).maxHeight,
        composer: composer?.getBoundingClientRect().toJSON() };
    }));
    assert.ok(control.left >= 0 && control.right <= bounds.width + 1 && control.top >= 0 && control.bottom <= bounds.height + 1, `${name}: control outside viewport ${JSON.stringify(control)}`);
    assert.ok(control.uncovered, `${name}: control obscured ${JSON.stringify(control)}`);
    assert.ok(control.height >= 32 && control.width >= 32, `${name}: control target too small ${JSON.stringify(control)}`);
  }
}

async function assertWorkspaceSurface(page, { theme, projectContext = false }) {
  const surface = await page.locator('main:visible').evaluate(element => {
    const style = getComputedStyle(element);
    const sidebar = document.querySelector('.sidebar');
    const context = document.querySelector('.workspace-work-panel');
    return {
      marked: element.classList.contains('workspace-surface'),
      background: style.backgroundColor,
      font: style.fontFamily,
      sidebarMarked: Boolean(sidebar?.closest('.workspace-surface')),
      sidebarWidth: sidebar?.getBoundingClientRect().width,
      contextWidth: context?.getBoundingClientRect().width,
      desktop: innerWidth >= 992,
    };
  });
  assert.equal(surface.marked, true, 'Core page must opt into the workspace surface');
  assert.equal(surface.background, theme === 'dark' ? 'rgb(25, 25, 24)' : 'rgb(255, 255, 255)');
  assert.ok(!surface.font.startsWith('Arial'), `Core surface must use system typography: ${surface.font}`);
  assert.equal(surface.sidebarMarked, true, 'Shared navigation must opt into the workspace surface');
  if (surface.desktop) {
    assert.ok(Math.abs(surface.sidebarWidth - 248) <= 1, `Expected 248px sidebar, got ${surface.sidebarWidth}`);
    if (projectContext) assert.ok(Math.abs(surface.contextWidth - 288) <= 1, `Expected 288px project context, got ${surface.contextWidth}`);
  }
}

async function assertScopedRoot(locator, name) {
  assert.equal(await locator.evaluate(element => Boolean(element.closest('.workspace-surface'))), true, `${name}: teleported content must explicitly inherit workspace styling`);
}

async function assertLegacySurface(page, selector, name, theme) {
  const surface = await page.locator(selector).evaluate(element => ({
    marked: Boolean(element.closest('.workspace-surface')),
    token: getComputedStyle(element).getPropertyValue('--surface-app').trim(),
    rootToken: getComputedStyle(document.documentElement).getPropertyValue('--surface-app').trim(),
    font: getComputedStyle(element).fontFamily,
  }));
  assert.equal(surface.marked, false, `${name}: legacy main content must not opt into workspace styling`);
  assert.equal(surface.token, surface.rootToken, `${name}: workspace tokens leaked into legacy content`);
  assert.equal(surface.token.toLowerCase(), theme === 'dark' ? '#0b0b0a' : '#f7f3ea', `${name}: legacy app color changed`);
  assert.ok(surface.font.startsWith('Arial'), `${name}: legacy typography changed`);
}

async function capture(page, name) {
  await page.screenshot({ path: resolve(output, `${name}.png`), animations: 'disabled' });
}

try {
  const fixture = await setup();
  const { page } = fixture;
  await waitHome(page);
  await page.getByRole('button', { name: 'Checkout regression', exact: false }).first().waitFor();
  assert.equal(await page.locator('.composer-setting select').first().locator('option').count(), 6);
  assert.equal(await page.locator('.quick-actions button').count(), 3);
  const starters = await page.locator('.quick-actions').boundingBox(), composer = await page.locator('.composer').boundingBox();
  assert.ok(starters.y + starters.height <= composer.y + 1);
  await page.locator('.composer-textarea').fill('Do not overwrite my home draft');
  await page.locator('.quick-actions button').first().click();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Do not overwrite my home draft');
  await assertFrame(page, 'home'); await assertWorkspaceSurface(page, { theme: 'light' }); await capture(page, 'home-light');
  passed('all six tasks, model controls and non-destructive starters');

  await page.locator('.sidebar-project-toggle').filter({ hasText: 'Checkout app' }).click();
  await page.waitForURL('**/projects?projectId=project-a');
  await page.locator('.topbar-breadcrumb__project').filter({ hasText: 'Checkout app' }).waitFor();
  await page.locator('.test-session__welcome').waitFor();
  await page.locator('.composer-textarea').fill('New project draft');
  await page.getByText('Guest checkout is supported.', { exact: false }).waitFor();
  await assertFrame(page, 'project'); await assertWorkspaceSurface(page, { theme: 'light', projectContext: true }); await capture(page, 'project-light');
  await page.locator('.workspace-work-panel__tabs button').nth(1).click();
  await page.locator('.project-document-card__open').first().click();
  await page.locator('.project-document-preview').waitFor();
  await assertScopedRoot(page.locator('.project-document-preview'), 'Document preview');
  await page.keyboard.press('Escape');
  await page.locator('.project-documents-section input[type=file]').setInputFiles({ name: 'project-input.txt', mimeType: 'text/plain', buffer: Buffer.from('project fixture') });
  await page.locator('.project-document-card').filter({ hasText: 'project-input.txt' }).waitFor();
  await page.locator('.project-documents-section').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['project drop'], 'project-drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await page.locator('.project-document-card').filter({ hasText: 'project-drop.txt' }).waitFor();
  assert.equal(await page.locator('.attachment-preview-card').count(), 0);
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'New project draft');
  passed('shared project memory, separate document upload/drop/preview and draft');

  await page.locator('.project-chat-list .project-chat-item').filter({ hasText: 'Checkout regression' }).click();
  await page.locator('.message-content table').waitFor();
  assert.equal(await page.locator('.message-content pre').count(), 1);
  await page.locator('.composer-textarea').fill('Existing chat draft');
  await page.locator('.chat-form input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('attachment') });
  await page.locator('.attachment-preview-name').filter({ hasText: 'notes.txt' }).waitFor();
  await page.locator('.sidebar-brand-link').click();
  await page.locator('.test-session__welcome').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Do not overwrite my home draft');
  assert.equal(await page.locator('.attachment-preview-card').count(), 0);
  await page.locator('.project-chat-list .project-chat-item').filter({ hasText: 'Checkout regression' }).click();
  await page.locator('.message-content table').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Existing chat draft');
  assert.equal(await page.locator('.attachment-preview-name').innerText(), 'notes.txt');
  await page.locator('.attachment-remove-btn').click();
  for (const kind of ['drop', 'paste']) {
    await page.locator('.composer').evaluate((element, kind) => {
      const data = new DataTransfer(); data.items.add(new File([kind], kind + '.txt', { type: 'text/plain' }));
      element.dispatchEvent(kind === 'drop' ? new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }) : new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
    }, kind);
    await page.locator('.attachment-preview-name').filter({ hasText: kind + '.txt' }).waitFor();
    assert.equal(await page.locator('.composer-send-btn').isEnabled(), true);
    await page.locator('.attachment-remove-btn').click();
  }
  passed('shared Markdown and home/project/session drafts; composer picker/drop/paste');
  await page.locator('.topbar-breadcrumb__project').click();
  await page.locator('.test-session__welcome').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'New project draft');
  await page.locator('.composer-send-btn').click();
  await page.getByText('Fixture response only.', { exact: false }).waitFor();
  assert.equal(fixture.sent.at(-1).projectId, 'project-a');
  await page.locator('.project-context__integrations').click();
  await page.locator('.project-integrations-dialog').waitFor();
  assert.equal(await page.locator('.project-integrations__group').count(), 2);
  await assertScopedRoot(page.locator('.project-integrations-dialog'), 'Integrations'); await capture(page, 'project-integrations-light');
  await page.keyboard.press('Escape');
  passed('server-managed project turn and preserved Integrations');

  const trigger = page.locator('.sidebar-session-row').filter({ hasText: 'Checkout regression' }).getByRole('button', { name: /^Actions for/ });
  await trigger.click();
  const popup = page.locator('.sidebar-session-menu__body');
  await popup.getByRole('button', { name: 'Export conversation · JSON', exact: true }).waitFor();
  assert.equal(await popup.getByRole('button', { name: /^Export conversation ·/ }).count(), 4);
  await assertScopedRoot(popup, 'Session actions');
  const download = page.waitForEvent('download');
  await popup.getByRole('button', { name: 'Export conversation · JSON', exact: true }).click();
  assert.ok((await download).suggestedFilename().endsWith('.json'));
  await trigger.click(); await popup.locator('select').selectOption('project-b');
  await popup.waitFor({ state: 'detached' });
  await page.locator('.sidebar-project-toggle').filter({ hasText: 'Mobile release' }).click();
  await page.locator('.project-chat-list .project-chat-item').filter({ hasText: 'Checkout regression' }).waitFor();
  await page.locator('.sidebar-section-link').click();
  await page.locator('.projects-page').waitFor();
  await page.locator('.project-card').filter({ hasText: 'Checkout app' }).locator('[aria-haspopup=menu]').click();
  await assertScopedRoot(page.locator('[role=menu]'), 'Project menu');
  await page.getByRole('menuitem', { name: /Export/ }).click();
  await page.locator('#project-export-include-chats').waitFor();
  await page.locator('#project-export-include-chats').uncheck();
  await assertScopedRoot(page.locator('[role=dialog]'), 'Project ZIP export'); await capture(page, 'project-export-dialog-light');
  await page.keyboard.press('Escape');
  await page.locator('.sidebar-account input[type=file]').setInputFiles({ name: 'chat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'qa-chat', chat: { title: 'Imported fixture', messages: [] } })) });
  await page.locator('.topbar-title').filter({ hasText: 'Imported fixture' }).waitFor();
  passed('four transcript exports/download, guarded move, project ZIP options and ordinary JSON import');
  assert.deepEqual(fixture.unexpected, []); await fixture.context.close();

  for (const [width, height, locale, theme] of [[1440,900,'en','dark'],[1024,900,'ar','light'],[992,900,'en','light'],[991,900,'de','light'],[390,667,'en','dark'],[320,568,'ar','dark']]) {
    const f = await setup({ width, height, locale, theme });
    await waitHome(f.page); await assertFrame(f.page, locale + ' home');
    if (width < 992) await f.page.locator('.sidebar-mobile-bar button').first().click();
    await f.page.locator('.sidebar-project-toggle').filter({ hasText: 'Checkout app' }).click();
    await f.page.waitForURL('**/projects?projectId=project-a');
    await f.page.locator('.topbar-breadcrumb__project').filter({ hasText: 'Checkout app' }).waitFor();
    await f.page.locator('.test-session__welcome').waitFor();
    if (width < 992) await f.page.locator('.workspace-work-panel__mobile-toggle').click();
    await f.page.locator('.workspace-work-panel__tabs button').nth(1).click();
    await f.page.locator('.project-document-card__open').first().click(); await f.page.locator('.project-document-preview').waitFor();
    await f.page.keyboard.press('Escape');
    if (width < 992) { await f.page.locator('.workspace-work-panel__tabs button').nth(1).focus(); await f.page.keyboard.press('Escape'); }
    await f.page.locator('.project-chat-list .project-chat-item').first().click(); await f.page.locator('.message-content table').waitFor();
    await f.page.locator('.composer-textarea').fill('Long private draft\n'.repeat(8));
    await f.page.locator('.composer input[type=file]').setInputFiles({ name: 'draft.txt', mimeType: 'text/plain', buffer: Buffer.from('private draft') });
    await f.page.locator('.attachment-preview-name').waitFor(); await assertFrame(f.page, locale + ' draft');
    await capture(f.page, 'common-' + locale + '-' + theme + '-' + width + 'x' + height);
    if (width < 992) await f.page.locator('.sidebar-mobile-bar button').first().click();
    const button = f.page.locator('.sidebar-session-row').filter({ hasText: 'Checkout regression' }).locator('[aria-haspopup=dialog]');
    await button.click(); const body = f.page.locator('.sidebar-session-menu__body'); await body.waitFor();
    const rect = await body.boundingBox(); assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.width <= width + 1 && rect.y + rect.height <= height + 1);
    await f.page.keyboard.press('Escape'); assert.equal(await button.evaluate(element => element === document.activeElement), true);
    if (width < 992) await f.page.keyboard.press('Escape');
    assert.deepEqual(f.unexpected, []); passed(locale + '/' + theme + ' ' + width + 'x' + height + ' shared context/files/menu/draft');
    await f.context.close();
  }

  const startup = await setup({ signedIn: false, delayAuth: true, seedActive: true });
  await waitHome(startup.page); await startup.page.locator('.composer-textarea').fill('Fresh home request');
  await startup.page.locator('.composer-send-btn').click(); await startup.page.getByText('Fixture response only.', { exact: false }).waitFor();
  assert.notEqual(startup.sent.at(-1).chatId, 'chat-a'); startup.releaseAuth();
  passed('guest direct-home reload cannot append to cached active chat'); await startup.context.close();
  const late = await setup({ delaySettings: true, seedActive: true });
  await waitHome(late.page); await late.settingsStarted;
  await late.page.locator('.composer-setting--model select').selectOption('gemini-2.5-flash');
  const settings = late.page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings'); late.releaseSettings(); await settings;
  await late.page.locator('.composer-textarea').fill('Keep my model selection'); await late.page.locator('.composer-send-btn').click();
  await late.page.getByText('Fixture response only.', { exact: false }).waitFor(); assert.equal(late.sent.at(-1).model, 'gemini-2.5-flash');
  passed('late account settings preserve draft model choice'); await late.context.close();
  for (const theme of ['light','dark']) {
    const f = await setup({ signedIn: false, empty: true, theme });
    await f.page.goto(origin + '/#/login'); await f.page.locator('#login-email').waitFor();
    await assertLegacySurface(f.page, '.auth-page', 'Login', theme);
    await f.page.locator('#login-email').fill('qa@example.test'); await f.page.locator('#login-password').fill('fixture-password-only');
    await f.page.locator('button[type=submit]').click(); await f.page.locator('.test-session__welcome').waitFor();
    assert.ok(f.page.url().endsWith('#/home')); assert.equal(await f.page.locator('.workspace-switcher select').count(), 0);
    await f.page.getByRole('button', { name: 'New session', exact: true }).click(); assert.ok(f.page.url().endsWith('#/chat'));
    await f.page.goto(origin + '/#/tests'); await f.page.locator('.sidebar-account-credit').waitFor(); await f.page.locator('.test-session').waitFor(); await f.page.locator('.qa-workspace-page').waitFor({ state: 'detached' });
    assert.equal(await f.page.locator('.qa-workspace-page').count(), 0);
    await f.page.goto(origin + '/#/settings'); await f.page.locator('.settings-form').waitFor();
    await assertLegacySurface(f.page, 'main:visible', 'Settings', theme); await capture(f.page, 'legacy-settings-' + theme);
    assert.deepEqual(f.unexpected, []); passed(theme + ' login/new session/legacy link/settings'); await f.context.close();
  }
  assert.deepEqual(errors, []);
  console.log('UX smoke complete: ' + checks + ' scenarios; no page errors. Screenshots: ' + output);
} catch (error) {
  console.error('Page errors:', errors);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('Current page:', page.url(), (await page.locator('body').innerText()).slice(0, 1800));
    await page.screenshot({ path: resolve(output, 'failure.png') });
  }
  throw error;
} finally { await browser.close(); }
