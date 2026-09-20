import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { pastedFiles, shouldSubmitComposerKey } from "../src/features/chat/composerInteractions";

describe("bottom composer interactions", () => {
  it("sends plain Enter but preserves newlines, modifiers and IME confirmation", () => {
    const enter = { key: "Enter", shiftKey: false, ctrlKey: false, altKey: false, metaKey: false, isComposing: false, keyCode: 13 };
    assert.equal(shouldSubmitComposerKey(enter), true);
    for (const modifier of ["shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing"]) {
      assert.equal(shouldSubmitComposerKey({ ...enter, [modifier]: true }), false);
    }
    assert.equal(shouldSubmitComposerKey({ ...enter, keyCode: 229 }), false);
    assert.equal(shouldSubmitComposerKey({ ...enter, key: "a" }), false);
  });
  it("uses clipboard files once, supports item fallback, and leaves text paste alone", () => {
    const file = new File(["hello"], "notes.txt", { type: "text/plain" });
    const fallback = { kind: "file", getAsFile: () => file };
    const data = { files: [file], items: [fallback] } as unknown as DataTransfer;
    assert.deepEqual(pastedFiles(data), [file]);
    assert.deepEqual(pastedFiles({ files: [], items: [fallback] } as unknown as DataTransfer), [file]);
    assert.deepEqual(pastedFiles(null), []);
  });
});
