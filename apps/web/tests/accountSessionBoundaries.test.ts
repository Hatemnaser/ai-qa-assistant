import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

describe("account-scoped page boundaries", () => {
  it("clears Usage data and invalidates requests when the identity changes", async () => {
    const source = await readSource("src/features/usage/UsagePage.vue");
    const identityWatch = source.match(/watch\([\s\S]*?\{ immediate: true \}\n\);/)?.[0] || "";
    const currentRequestCheck = source.match(/function isCurrentRequest[\s\S]*?\n}/)?.[0] || "";

    assert.match(source, /identityKey: string/);
    assert.match(identityWatch, /\(\) => props\.identityKey/);
    assert.match(identityWatch, /summary\.value = null/);
    assert.match(identityWatch, /loadRevision \+= 1/);
    assert.match(currentRequestCheck, /props\.identityKey === identityKey/);
    assert.match(currentRequestCheck, /loadRevision === requestRevision/);
  });

  it("keeps projects in App as the single account-level owner", async () => {
    const [appSource, pageSource] = await Promise.all([
      readSource("src/App.vue"),
      readSource("src/features/projects/ProjectsPage.vue"),
    ]);

    assert.match(appSource, /:projects="accountProjects"/);
    assert.match(appSource, /:refresh-projects="loadAccountProjects"/);
    assert.match(pageSource, /projects: Project\[\]/);
    assert.match(pageSource, /const projects = computed\(\(\) => props\.projects\)/);
    assert.doesNotMatch(pageSource, /\bfetchProjects\b/);
  });

  it("guards Settings responses with both identity and request revisions", async () => {
    const source = await readSource("src/features/settings/SettingsPage.vue");

    assert.match(source, /isCurrentSettingsRequest\(userId, requestRevision\)/);
    assert.match(source, /isCurrentMemoryRequest\(userId, requestRevision\)/);
    assert.match(source, /isCurrentIdentity\(identity\)/);
    assert.match(source, /resetAccountScopedState\(\)/);
  });
});

function readSource(relativePath: string) {
  return readFile(new URL(`../${relativePath}`, import.meta.url), "utf8");
}
