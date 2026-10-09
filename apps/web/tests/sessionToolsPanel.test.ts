import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { sessionToolsUseDrawer } from "../src/features/sessions/sessionToolsLayout";
describe("on-demand session tool surface", () => {
  it("keeps the conversation at least 480px wide beside a 320px tool", () => {
    assert.equal(sessionToolsUseDrawer(800, 1440), false);
    assert.equal(sessionToolsUseDrawer(799, 1440), true);
    assert.equal(sessionToolsUseDrawer(1024, 1440), false);
    assert.equal(sessionToolsUseDrawer(700, 1024), true);
  });
  it("uses a mobile dialog at the preserved breakpoint and honours standalone previews", () => {
    assert.equal(sessionToolsUseDrawer(1400, 991), true);
    assert.equal(sessionToolsUseDrawer(1400, 992), false);
    assert.equal(sessionToolsUseDrawer(1440, 1440, true), true);
    assert.equal(sessionToolsUseDrawer(390, 390), true);
    assert.equal(sessionToolsUseDrawer(320, 320), true);
  });
  it("has one controlled surface, named tools and a stable header aria-controls target", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionToolsPanel.vue", import.meta.url), "utf8");
    assert.match(source, /v-if="lifecycleActive && currentTool"/);
    assert.match(source, /id="session-tools-panel"/);
    assert.match(source, /currentTool: SessionTool \| null/);
    for (const tool of ["sources", "activity", "results"]) assert.match(source, new RegExp(`currentTool === '${tool}'`));
    assert.doesNotMatch(source, /ProjectContext|ProjectMemory|ProjectDocuments|QaConnection|fetch\(/);
  });
  it("reuses modal accessibility and body locking while making background inert only for a drawer", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionToolsPanel.vue", import.meta.url), "utf8");
    assert.match(source, /useDialogAccessibility/);
    assert.match(source, /modalOpen = computed\(\(\) => Boolean\(lifecycleActive.value && props.currentTool && drawer.value\)\)/);
    assert.match(source, /isOpen: modalOpen/);
    assert.match(source, /<Teleport to="body" :disabled="!drawer">/);
    assert.match(source, /inertHost.inert = true/);
    assert.match(source, /inertHost.inert = previousInert/);
    assert.match(source, /opener\?\.isConnected/);
    assert.match(source, /@keydown="keydown"/);
    assert.doesNotMatch(source, /getFocusableElements|querySelectorAll<HTMLElement>/);
  });
  it("resets at session/owner boundaries and has full mobile sizing rather than a short context strip", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionToolsPanel.vue", import.meta.url), "utf8");
    assert.match(source, /watch\(\(\) => props.scopeKey/);
    assert.match(source, /@media \(max-width: 991px\)/);
    assert.match(source, /\.session-tools-shell--drawer \.session-tools-panel \{ width: 100%/);
    assert.match(source, /env\(safe-area-inset-bottom\)/);
    assert.doesNotMatch(source, /localStorage|26dvh|42dvh/);
  });
  it("releases body overlays when the cached session deactivates, without clearing its draft", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionToolsPanel.vue", import.meta.url), "utf8");
    const page = await readFile(new URL("../src/features/sessions/SessionPage.vue", import.meta.url), "utf8");
    assert.match(source, /onDeactivated\(\(\) => \{ lifecycleActive.value = false; releaseInert\(\); emit\('close'\)/);
    assert.match(page, /onDeactivated\(\(\) => \{ viewActive.value = false; closeTransientTools\(\)/);
    assert.match(page, /revision === transientRevision && scope === toolsScopeKey.value/);
    assert.match(page, /v-if="viewActive && connectionOpen && project"/);
    assert.match(page, /watch\(\(\) => props.active/);
    assert.match(page, /connectionOpen.value = false/);
    assert.doesNotMatch(page.slice(page.indexOf('function closeTransientTools'), page.indexOf('async function openConnections')), /message.value|selectedAttachments.value|clearDraft/);
  });
  it("keeps read recovery usable without unlocking stale request actions", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionActivityPanel.vue", import.meta.url), "utf8");
    const page = await readFile(new URL("../src/features/sessions/SessionPage.vue", import.meta.url), "utf8");
    assert.match(source, /:disabled="loading \|\| retryDisabled" @click="emit\('retry'\)"/);
    assert.match(source, /props.disabled \|\| activity.value.loading \|\| activity.value.readError/);
    assert.match(page, /:retry-disabled="busy \|\| loading \|\| isLoadingProjects"/);
    assert.match(page, /@retry="projectLoadError \? emit\('reload-projects'\) : state.refresh\(\)"/);
  });
});
