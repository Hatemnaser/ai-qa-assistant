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
    if (path === '/api/chats') return json({ chats });
    if (path.startsWith('/api/chats/')) {
      if (method === 'DELETE') { chats = chats.filter(chat => chat.id !== path.split('/').at(-1)); return json({ ok: true }); }
      if (body?.chat) { chats = [...chats.filter(chat => chat.id !== body.chat.id), body.chat]; return json({ chat: body.chat }); }
    }
    if (path === '/api/chat') { sent.push(body); return json({ reply: 'Fixture response only.', mode: body.mode, model, usage: { limit: 100, used: 1, remaining: 99, unit: 'credits' } }); }
    if (path.endsWith('/instructions')) return json({ instruction: { projectId: path.split('/')[3], content: 'Check keyboard access and checkout errors.', createdAt: timestamp, updatedAt: timestamp } });
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
  await page.locator('.chat-home h1').waitFor();
  await page.waitForFunction(() => document.querySelector('.sidebar-account') || document.querySelector('.sidebar'));
}

async function assertFrame(page, name) {
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
    assert.ok(control.left >= 0 && control.right <= bounds.width + 1 && control.top >= 0 && control.bottom <= bounds.height + 1, `${name}: control outside viewport ${JSON.stringify(control)}`);
    assert.ok(control.uncovered, `${name}: control obscured ${JSON.stringify(control)}`);
    assert.ok(control.height >= 32 && control.width >= 32, `${name}: control target too small ${JSON.stringify(control)}`);
  }
}

async function assertWorkspaceSurface(page, { theme, projectContext = false }) {
  const surface = await page.locator('main').evaluate(element => {
    const style = getComputedStyle(element);
    const sidebar = document.querySelector('.sidebar');
    const context = document.querySelector('.project-context');
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
  const starters = await page.locator('.quick-actions').boundingBox();
  const composer = await page.locator('.composer').boundingBox();
  assert.ok(starters.y + starters.height <= composer.y + 1, 'Empty-state starters must sit above the composer');
  await page.locator('.composer-textarea').fill('Do not overwrite my home draft');
  await page.locator('.quick-actions button').first().click();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Do not overwrite my home draft');
  await assertFrame(page, 'desktop home');
  await assertWorkspaceSurface(page, { theme: 'light' });
  await capture(page, 'home-light');
  passed('home, all six modes, three non-destructive starters, anchored composer');

  await page.locator('.sidebar-project-toggle').filter({ hasText: 'Checkout app' }).click();
  await page.locator('.projects-page--detail').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), '');
  await page.locator('.composer-textarea').fill('New project draft');
  assert.equal(await page.locator('.project-context__section').count(), 3);
  await assertFrame(page, 'desktop project');
  await assertWorkspaceSurface(page, { theme: 'light', projectContext: true });
  await capture(page, 'project-light');
  passed('project opens on title, visible instructions/memory/files, independent draft');

  await page.locator('.project-document-card__open').first().click();
  await page.locator('.project-document-preview').waitFor();
  await assertScopedRoot(page.locator('.project-document-preview'), 'Project document preview');
  await capture(page, 'project-document-dialog-light');
  await page.keyboard.press('Escape');
  await page.locator('.project-document-preview').waitFor({ state: 'hidden' });
  await page.locator('.project-documents-section input[type=file]').setInputFiles({ name: 'project-input.txt', mimeType: 'text/plain', buffer: Buffer.from('project fixture') });
  await page.locator('.project-document-card').filter({ hasText: 'project-input.txt' }).waitFor();
  await page.locator('.project-documents-section').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['project drop'], 'project-drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await page.locator('.project-document-card').filter({ hasText: 'project-drop.txt' }).waitFor();
  assert.equal(await page.locator('.attachment-preview-card').count(), 0);
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'New project draft');
  await page.locator('.project-detail__actions [aria-haspopup=menu]').click();
  await assertScopedRoot(page.locator('[role=menu]'), 'Project detail menu');
  await capture(page, 'project-menu-light');
  await page.getByRole('menuitem', { name: /Export/ }).click();
  await page.locator('#project-export-include-chats').waitFor();
  await assertScopedRoot(page.locator('[role=dialog]'), 'Project export dialog');
  await capture(page, 'project-export-dialog-light');
  await page.locator('#project-export-include-chats').uncheck();
  await page.keyboard.press('Escape');
  passed('project file picker/drop/preview stay separate from chat; ZIP include-chats control preserved');

  await page.locator('.project-detail__content button').filter({ hasText: 'Checkout regression' }).first().click();
  await page.locator('.chat-topbar').waitFor();
  await page.locator('.composer-textarea').fill('Existing chat draft');
  await page.locator('.chat-form input[type=file]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('fixture attachment') });
  await page.locator('.attachment-preview-name').filter({ hasText: 'notes.txt' }).waitFor();
  await page.locator('.sidebar-brand-link').click();
  await page.locator('.chat-home').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Do not overwrite my home draft');
  assert.equal(await page.locator('.attachment-preview-card').count(), 0);
  await page.locator('.chat-home__recent').filter({ hasText: 'Checkout regression' }).click();
  await page.locator('.chat-topbar').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'Existing chat draft');
  assert.equal(await page.locator('.attachment-preview-name').innerText(), 'notes.txt');
  await assertFrame(page, 'desktop project chat');
  await assertWorkspaceSurface(page, { theme: 'light', projectContext: true });
  assert.equal(await page.locator('.message-content table').count(), 1);
  assert.equal(await page.locator('.message-content pre').count(), 1);
  await capture(page, 'chat-project-light');
  passed('chat/home/project drafts preserve text and files across navigation');

  await page.locator('.attachment-remove-btn').click();
  await capture(page, 'chat-filled-light');
  await page.locator('.composer-textarea').fill('');
  await page.locator('.composer').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['drop'], 'drop.txt', { type: 'text/plain' }));
    element.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
  });
  await page.locator('.attachment-preview-name').filter({ hasText: 'drop.txt' }).waitFor();
  await page.locator('.attachment-remove-btn').click();
  await page.locator('.composer').evaluate(element => {
    const data = new DataTransfer(); data.items.add(new File(['paste'], 'paste.txt', { type: 'text/plain' }));
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await page.locator('.attachment-preview-name').filter({ hasText: 'paste.txt' }).waitFor();
  assert.equal(await page.locator('.composer-send-btn').isEnabled(), true);
  passed('composer input/drop/paste and attachment-only send availability');
  await page.locator('.attachment-remove-btn').click();

  await page.locator('.topbar-breadcrumb__project').click();
  await page.locator('.projects-page--detail').waitFor();
  assert.equal(await page.locator('.composer-textarea').inputValue(), 'New project draft');
  await page.locator('.composer-send-btn').click();
  await page.locator('.chat-topbar').waitFor();
  await page.locator('.message-content').filter({ hasText: 'Fixture response only.' }).waitFor();
  assert.equal(fixture.sent.at(-1).projectId, 'project-a');
  passed('project composer submits to the same project through the original chat contract');

  await page.locator('.project-context__integrations').click();
  await page.locator('.project-integrations-dialog').waitFor();
  assert.equal(await page.locator('.project-integrations__group').count(), 2);
  await assertScopedRoot(page.locator('.project-integrations-dialog'), 'Integrations dialog');
  await capture(page, 'project-integrations-light');
  await page.keyboard.press('Escape');
  await page.locator('.project-integrations-dialog').waitFor({ state: 'hidden' });
  passed('integrations entry and separate saved credentials / Runner state');

  const chatMenuButton = page.locator('.sidebar-chat-row').filter({ hasText: 'Checkout regression' }).locator('[aria-haspopup=menu]');
  await chatMenuButton.click();
  await page.locator('#chat-actions-menu [aria-controls=chat-export-menu]').click();
  assert.equal(await page.locator('#chat-export-menu [role=menuitem]').count(), 4);
  await assertScopedRoot(page.locator('#chat-actions-menu'), 'Chat context menu');
  await assertScopedRoot(page.locator('#chat-export-menu'), 'Chat export submenu');
  await capture(page, 'chat-menu-light');
  const downloadPromise = page.waitForEvent('download');
  await page.locator('#chat-export-menu [role=menuitem]').last().click();
  assert.ok((await downloadPromise).suggestedFilename().endsWith('.json'));
  await chatMenuButton.click();
  await page.locator('#chat-actions-menu [aria-controls=chat-project-menu]').click();
  await page.locator('#chat-project-menu').getByRole('menuitem', { name: 'Mobile release', exact: true }).click();
  await page.locator('.sidebar-project-toggle').filter({ hasText: 'Mobile release' }).click();
  await page.locator('.project-detail__content').getByRole('button', { name: /Checkout regression/ }).waitFor();
  await page.locator('.sidebar-section-link').click();
  await page.locator('.projects-page--detail').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Import project', exact: true }).waitFor();
  await assertWorkspaceSurface(page, { theme: 'light' });
  await capture(page, 'projects-index-light');
  await page.locator('.sidebar-account input[type=file]').setInputFiles({ name: 'chat.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ type: 'qa-chat', chat: { title: 'Imported fixture', messages: [] } })) });
  await page.locator('.topbar-title').filter({ hasText: 'Imported fixture' }).waitFor();
  passed('chat export download, project reassignment, return to index and account JSON import');
  assert.deepEqual(fixture.unexpected, []);
  await fixture.context.close();

  // Representative cases exercise both themes, RTL, long translated controls and
  // both sides of the existing mobile breakpoint without a Cartesian matrix.
  for (const [width, locale, theme] of [[1440, 'en', 'dark'], [1024, 'ar', 'light'], [390, 'en', 'dark'], [320, 'ar', 'dark'], [991, 'de', 'light'], [992, 'en', 'light']]) {
    const f = await setup({ width, height: 900, locale, theme });
    await waitHome(f.page);
    await f.page.locator('.chat-home__recent').first().waitFor();
    await assertFrame(f.page, `${locale} home ${width}`);
    await assertWorkspaceSurface(f.page, { theme });
    await capture(f.page, `home-${locale}-${width}-${theme}`);
    if (width < 992) await f.page.locator('.sidebar-mobile-bar button').first().click();
    await f.page.locator('.sidebar-project-toggle').filter({ hasText: 'Checkout app' }).click();
    await f.page.locator('.projects-page--detail').waitFor();
    await assertFrame(f.page, `${locale} project ${width}`);
    await assertWorkspaceSurface(f.page, { theme, projectContext: true });
    await capture(f.page, `project-${locale}-${width}-${theme}`);
    if (width < 992) {
      assert.equal(await f.page.locator('.project-context__shortcuts button').count(), 3);
      await f.page.locator('[data-context-trigger="files"]').click();
      await f.page.locator('[data-section="files"].is-selected').waitFor();
      await assertFrame(f.page, `${locale} project ${width} with files open`);
      await f.page.keyboard.press('Escape');
      assert.equal(await f.page.locator('[data-context-trigger="files"]').getAttribute('aria-expanded'), 'false');
    }
    await f.page.locator('.project-detail__content button').first().click();
    await f.page.locator('.chat-topbar').waitFor();
    await assertFrame(f.page, `${locale} chat ${width}`);
    await assertWorkspaceSurface(f.page, { theme, projectContext: true });
    await capture(f.page, `chat-${locale}-${width}-${theme}`);
    await f.page.locator('.composer-textarea').fill('Review keyboard access and the checkout validation messages.');
    await f.page.locator('.chat-form input[type=file]').setInputFiles({ name: 'review-notes.txt', mimeType: 'text/plain', buffer: Buffer.from('isolated visual fixture') });
    await f.page.locator('.attachment-preview-name').filter({ hasText: 'review-notes.txt' }).waitFor();
    await assertFrame(f.page, `${locale} attachment draft ${width}`);
    await capture(f.page, `draft-${locale}-${width}-${theme}`);
    if (width < 992) await f.page.locator('.sidebar-mobile-bar button').first().click();
    const trigger = f.page.locator('.sidebar-chat-row').filter({ hasText: 'Checkout regression' }).locator('[aria-haspopup=menu]');
    await trigger.click();
    await f.page.locator('#chat-actions-menu [aria-controls=chat-export-menu]').click();
    await f.page.locator('#chat-export-menu').waitFor();
    const rect = await f.page.locator('#chat-export-menu').boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= width + 1, 'Export submenu must fit the viewport');
    await assertScopedRoot(f.page.locator('#chat-export-menu'), 'Responsive chat export submenu');
    await capture(f.page, `menu-${locale}-${width}-${theme}`);
    await f.page.keyboard.press('Escape');
    await f.page.locator('#chat-export-menu').waitFor({ state: 'hidden' });
    await f.page.keyboard.press('Escape');
    await f.page.locator('#chat-actions-menu').waitFor({ state: 'hidden' });
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true);
    if (width < 992) await f.page.keyboard.press('Escape');
    if (width === 1440) {
      await f.page.locator('.project-context__integrations').click();
      await f.page.locator('.project-integrations-dialog').waitFor();
      await assertScopedRoot(f.page.locator('.project-integrations-dialog'), 'Dark integrations dialog');
      await capture(f.page, 'project-integrations-dark');
      await f.page.keyboard.press('Escape');
      await f.page.locator('.sidebar-section-link').click();
      await f.page.getByRole('button', { name: 'Import project', exact: true }).waitFor();
      await assertWorkspaceSurface(f.page, { theme });
      await capture(f.page, 'projects-index-dark');
    }
    assert.deepEqual(f.unexpected, []);
    passed(`${locale}/${theme} ${width}px project context, navigation and fixed composer`);
    await f.context.close();
  }

  // Real phone heights must reserve composer space even when context and a
  // multiline attachment draft are open together, not only at 900px height.
  for (const [width, height] of [[390, 667], [320, 568]]) {
    const f = await setup({ width, height });
    await waitHome(f.page);
    await f.page.locator('.chat-home__recent').first().waitFor();
    await f.page.locator('.sidebar-mobile-bar button').first().click();
    await f.page.locator('.sidebar-project-toggle').filter({ hasText: 'Checkout app' }).click();
    await f.page.locator('.projects-page--detail').waitFor();
    await assertFrame(f.page, `short project ${width}x${height}`);
    await f.page.locator('[data-context-trigger="files"]').click();
    await assertFrame(f.page, `short project files ${width}x${height}`);
    // Context actions and project history remain reachable through scrolling.
    await f.page.locator('.project-document-card__open').first().click();
    await f.page.locator('.project-document-preview').waitFor();
    await f.page.keyboard.press('Escape');
    await f.page.locator('.composer-textarea').fill('Multiline project draft.\n'.repeat(12));
    await f.page.locator('.chat-form input[type=file]').setInputFiles({ name: 'short-project.txt', mimeType: 'text/plain', buffer: Buffer.from('isolated short viewport fixture') });
    await f.page.locator('.attachment-preview-name').filter({ hasText: 'short-project.txt' }).waitFor();
    await assertFrame(f.page, `short project multiline attachment with files ${width}x${height}`);
    await capture(f.page, `project-short-${width}-${height}`);
    await f.page.locator('.project-context__section.is-selected .project-context__close').click();
    await f.page.locator('.project-detail__content button').first().click();
    await f.page.locator('.chat-topbar').waitFor();
    await assertFrame(f.page, `short chat ${width}x${height}`);
    await f.page.locator('[data-context-trigger="files"]').click();
    await f.page.locator('.composer-textarea').fill('Multiline chat draft.\n'.repeat(12));
    await f.page.locator('.chat-form input[type=file]').setInputFiles({ name: 'short-chat.txt', mimeType: 'text/plain', buffer: Buffer.from('isolated short viewport fixture') });
    await f.page.locator('.attachment-preview-name').filter({ hasText: 'short-chat.txt' }).waitFor();
    // In the most constrained case, scroll between context and the composer;
    // neither region may collapse to zero or become permanently clipped.
    assert.ok((await f.page.locator('.chat-workspace > .project-context').boundingBox()).height >= 80);
    await f.page.locator('.chat-form').scrollIntoViewIfNeeded();
    await assertFrame(f.page, `short chat multiline attachment with files ${width}x${height}`);
    await capture(f.page, `chat-short-${width}-${height}`);
    await f.page.locator('[data-context-trigger="files"]').click();
    assert.equal(await f.page.locator('[data-context-trigger="files"]').getAttribute('aria-expanded'), 'false');
    await f.page.locator('[data-context-trigger="files"]').click();
    await f.page.locator('.project-document-card__open').first().click();
    await f.page.locator('.project-document-preview').waitFor();
    await f.page.keyboard.press('Escape');
    await f.page.locator('.chat-form').scrollIntoViewIfNeeded();
    await assertFrame(f.page, `short chat after file preview ${width}x${height}`);
    assert.deepEqual(f.unexpected, []);
    passed(`${width}x${height} short project/chat keep files, multiline draft and attachment controls reachable`);
    await f.context.close();
  }

  const empty = await setup({ empty: true });
  await waitHome(empty.page);
  await empty.page.locator('.sidebar-section-link').click();
  await empty.page.locator('.projects-page').waitFor();
  assert.equal(await empty.page.locator('[role=dialog]').count(), 0);
  passed('empty project account does not force a creation modal');
  await empty.context.close();

  const startup = await setup({ signedIn: false, delayAuth: true, seedActive: true });
  await waitHome(startup.page);
  await startup.page.locator('.composer-textarea').fill('Fresh home request');
  await startup.page.locator('.composer-send-btn').click();
  await startup.page.locator('.message-content').filter({ hasText: 'Fixture response only.' }).waitFor();
  assert.notEqual(startup.sent.at(-1).chatId, 'chat-a');
  startup.releaseAuth();
  passed('direct home reload cannot append into persisted active chat during authentication');
  await startup.context.close();

  const late = await setup({ delaySettings: true, seedActive: true });
  await waitHome(late.page);
  // Wait until owner-scoped chats have arrived and settings fetch has started.
  await late.settingsStarted;
  await late.page.locator('.composer-setting--model select').selectOption('gemini-2.5-flash');
  const settingsResponse = late.page.waitForResponse(response => new URL(response.url()).pathname === '/api/settings');
  late.releaseSettings();
  await settingsResponse;
  await late.page.locator('.composer-textarea').fill('Keep my model selection');
  await late.page.locator('.composer-send-btn').click();
  await late.page.locator('.message-content').filter({ hasText: 'Fixture response only.' }).waitFor();
  assert.equal(late.sent.at(-1).model, 'gemini-2.5-flash');
  passed('late account settings preserve a model changed in the current draft');
  await late.context.close();

  for (const theme of ['light', 'dark']) {
    const login = await setup({ signedIn: false, empty: true, theme });
    await login.page.goto(`${origin}/#/login`);
    await login.page.locator('#login-email').waitFor();
    await assertLegacySurface(login.page, '.auth-page', 'Login', theme);
    await capture(login.page, `legacy-login-${theme}`);
    await login.page.locator('#login-email').fill('qa@example.test');
    await login.page.locator('#login-password').fill('fixture-password-only');
    await login.page.locator('button[type=submit]').click();
    await login.page.locator('.chat-home').waitFor();
    assert.ok(login.page.url().endsWith('#/home'));
    await assertWorkspaceSurface(login.page, { theme });
    await login.page.locator('.sidebar-nav button').filter({ hasText: 'Tests' }).click();
    await login.page.getByRole('heading', { name: 'Workspace', exact: true }).waitFor();
    assert.ok(login.page.url().endsWith('#/'));
    await assertLegacySurface(login.page, 'main', 'Tests workspace', theme);
    await capture(login.page, `legacy-qa-${theme}`);
    await login.page.goto(`${origin}/#/settings`);
    await login.page.locator('.settings-form').waitFor();
    await assertLegacySurface(login.page, 'main', 'Settings', theme);
    await capture(login.page, `legacy-settings-${theme}`);
    assert.deepEqual(login.unexpected, []);
    passed(`${theme}: normal login opens home; QA/auth/settings keep legacy styling`);
    await login.context.close();
  }
  assert.deepEqual(errors, []);
  console.log(`UX smoke complete: ${checks} scenarios; no page errors. Screenshots: ${output}`);
} catch (error) {
  console.error('Page errors:', errors);
  for (const context of browser.contexts()) for (const page of context.pages()) {
    console.error('Current page:', page.url(), (await page.locator('body').innerText()).slice(0, 1800));
    await page.screenshot({ path: resolve(output, 'failure.png') });
  }
  throw error;
} finally { await browser.close(); }
