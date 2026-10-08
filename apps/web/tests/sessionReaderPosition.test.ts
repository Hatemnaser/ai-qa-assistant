import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { sessionReaderPosition } from "../src/features/chat/sessionReaderPosition";

describe("session reader position", () => {
  it("never reports newer content for an empty or non-overflowing transcript", () => {
    assert.deepEqual(sessionReaderPosition(0, 400, 0), { following: true, newerOutsideView: false });
    assert.deepEqual(sessionReaderPosition(300, 400, 0), { following: true, newerOutsideView: false });
  });
  it("keeps following within the bottom tolerance and handles elastic scrolling", () => {
    assert.equal(sessionReaderPosition(1000, 400, 600).newerOutsideView, false);
    assert.equal(sessionReaderPosition(1000, 400, 540).following, true);
    assert.equal(sessionReaderPosition(1000, 400, 630).following, true);
    assert.equal(sessionReaderPosition(1000, 400, -20).following, false);
  });
  it("reports only genuine offscreen newer content when reading older messages", () => {
    assert.deepEqual(sessionReaderPosition(1000, 400, 500), { following: false, newerOutsideView: true });
    assert.deepEqual(sessionReaderPosition(1100, 400, 600), { following: false, newerOutsideView: true });
  });
  it("ignores welcome content and dock padding even when an empty session overflows", () => {
    assert.deepEqual(sessionReaderPosition(1200, 400, 0, null), { following: true, newerOutsideView: false });
    assert.deepEqual(sessionReaderPosition(1200, 400, 0, 0), { following: true, newerOutsideView: false });
  });
  it("uses the final readable entry rather than extra trailing padding", () => {
    assert.deepEqual(sessionReaderPosition(1200, 400, 200, 600), { following: true, newerOutsideView: false });
    assert.deepEqual(sessionReaderPosition(1200, 400, 100, 600), { following: false, newerOutsideView: true });
    assert.equal(sessionReaderPosition(1200, 400, 129, 600).newerOutsideView, false);
    assert.equal(sessionReaderPosition(1200, 400, 128, 600).newerOutsideView, true);
  });
  it("clamps the semantic end to the native range", () => {
    assert.equal(sessionReaderPosition(600, 400, 200, 1200).newerOutsideView, false);
    assert.equal(sessionReaderPosition(600, 400, 0, -1).newerOutsideView, false);
  });
  it("gates the control on scroll geometry, not a blanket focus pause", async () => {
    const source = await readFile(new URL('../src/features/chat/components/SessionComposerDock.vue', import.meta.url), 'utf8');
    assert.match(source, /v-if="newerOutsideView"/);
    assert.match(source, /else updateReaderPosition\(false\)/);
    assert.match(source, /target.closest\('\[data-message-id\]/);
    assert.match(source, /readerContentBottom\(source\)/);
    assert.match(source, /const available = Math.max\(0, host.clientHeight - headerHeight\)/);
    assert.match(source, /if \(!rect.height \|\| !rect.width\) continue/);
    assert.doesNotMatch(source, /v-if="!following"/);
  });
  it("resets cached reading position on a real reader scope change, not a status update", async () => {
    const source = await readFile(new URL('../src/features/chat/components/SessionComposerDock.vue', import.meta.url), 'utf8');
    const page = await readFile(new URL('../src/features/sessions/SessionPage.vue', import.meta.url), 'utf8');
    assert.match(source, /watch\(\(\) => props.readerKey/);
    assert.match(source, /if \(scroll\) scroll.scrollTop = 0/);
    assert.match(page, /:reader-key="toolsScopeKey"/);
    assert.match(page, /const toolsScopeKey = computed\(\(\) => `\$\{props.currentUser\?\.id/);
  });
});
