import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

const composerUrl = new URL("../src/features/chat/components/ChatComposer.vue", import.meta.url);

describe("focused composer layout contracts", () => {
  it("keeps starters and image suggestions above the writing surface and disclosure below", async () => {
    const source = await readFile(composerUrl, "utf8");
    const template = source.slice(source.indexOf("<template>"));
    const writingSurface = template.indexOf('class="composer d-flex');
    for (const suggestion of ['v-if="showStarters && !hasImage"', 'v-if="variant !== \'test\' && hasImage && mode !== \'screenshot_review\'"']) {
      const position = template.indexOf(suggestion);
      assert.ok(position >= 0 && position < writingSurface, `${suggestion} must precede the composer`);
    }
    assert.ok(template.indexOf('class="composer-ai-notice') > writingSurface);
    assert.match(template, /class="composer-ai-notice[^"\n]*"[^>]*role="note"/);
  });

  it("gives text its own row and retains native labelled task and model controls in the toolbar", async () => {
    const source = await readFile(composerUrl, "utf8");
    const textRowStart = source.indexOf('class="composer-row');
    const toolbarStart = source.indexOf('class="composer-controls"');
    const textRow = source.slice(textRowStart, toolbarStart);
    const toolbar = source.slice(toolbarStart, source.indexOf('<small v-if="mode'));
    assert.match(textRow, /<textarea/);
    assert.doesNotMatch(textRow, /<button|<select/);
    assert.equal((toolbar.match(/<select\b/g) || []).length, 2);
    assert.equal((toolbar.match(/<label\b/g) || []).length, 2);
    assert.match(toolbar, /:aria-controls="attachmentInputId"/);
    assert.match(toolbar, /@click="attachmentInput\?\.click\(\)"/);
    assert.match(toolbar, /v-for="option in QA_MODES"/);
    assert.match(toolbar, /:disabled="isComposerDisabled \|\| mode === 'screenshot_review'"/);
    assert.match(toolbar, /<Icon name="paperclip"/);
    assert.match(toolbar, /<Icon name="arrow-up"/);
    assert.match(toolbar, /type="submit"/);
    assert.match(toolbar, /:aria-label="t\('chat\.composer\.send'\)"/);
    assert.match(toolbar, /:disabled="isSending \|\| isComposerDisabled \|\| \(!message\.trim\(\) && !selectedAttachments\.length\)"/);
  });

  it("preserves keyboard submission and attachment handling on the shared writing surface", async () => {
    const source = await readFile(composerUrl, "utf8");
    assert.match(source, /@submit\.prevent="requestSubmit"/);
    assert.match(source, /@keydown="handleKeydown"/);
    assert.match(source, /@drop\.prevent="handleDrop"/);
    assert.match(source, /@paste="handlePaste"/);
    assert.match(source, /ref="attachmentInput"/);
    assert.match(source, /:accept="ATTACHMENT_INPUT_ACCEPT"/);
    assert.match(source, /@change="handleAttachmentChange"/);
  });
});
