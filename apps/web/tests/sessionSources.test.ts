import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { buildSessionSources, safeSessionSourceUrl, sessionSourceCanOpenExternally, sessionSourcePreviewKind } from "../src/features/sessions/sessionSources";
import type { SelectedAttachment } from "../src/features/chat/types";

const attachment = (assetId?: string, name = "requirements.txt") => ({ type: "file" as const, name, mimeType: "text/plain", assetId });
const draft = (name: string): SelectedAttachment => ({ type: "file", name, mimeType: "text/plain", file: new File([name], name, { type: "text/plain", lastModified: 10 }) });
describe("conversation sources, not a fabricated retrieval manifest", () => {
  it("deduplicates stored assets while preserving different assets with the same name", () => {
    const sources = buildSessionSources([{ id: "m1", attachments: [attachment("one"), attachment("two")] }, { id: "m2", attachments: [attachment("one")] }]);
    assert.deepEqual(sources.map(source => source.id), ["asset:one", "asset:two"]);
    assert.equal(sources[0]!.messageId, "m1");
  });
  it("keeps metadata-only historical files separately and does not invent bytes", () => {
    const sources = buildSessionSources([{ id: "m1", attachments: [attachment()] }, { id: "m2", attachment: attachment() }]);
    assert.deepEqual(sources.map(source => source.id), ["message:m1:attachment:0", "message:m2:attachment:0"]);
    assert.equal(sources[0]!.file, undefined);
    assert.equal(sources[0]!.previewUrl, undefined);
  });
  it("keeps local drafts distinct from saved items without mutating either input", () => {
    const messages = [{ id: "m1", attachments: [attachment("a")] }];
    const drafts = [draft("same.txt"), draft("same.txt")];
    const sources = buildSessionSources(messages, drafts);
    assert.equal(new Set(sources.map(source => source.id)).size, 3);
    assert.equal(sources[1]!.origin, "draft");
    assert.equal(sources[1]!.file, drafts[0]!.file);
    assert.equal(messages[0]!.attachments.length, 1);
    assert.deepEqual(buildSessionSources(messages, drafts).map(source => source.id), sources.map(source => source.id));
  });
  it("draft IDs survive removal of an unrelated preceding attachment", () => {
    const drafts = [draft("first.txt"), draft("second.txt")];
    assert.equal(buildSessionSources([], drafts)[1]!.id, buildSessionSources([], drafts.slice(1))[0]!.id);
  });
  it("supports the current image/text policy and excludes executable or unsupported previews", () => {
    for (const mimeType of ["image/png", "image/jpeg", "image/webp"]) assert.equal(sessionSourcePreviewKind({ mimeType, name: "image" }), "image");
    for (const name of ["note.txt", "note.md", "note.log", "note.csv", "note.json"]) assert.equal(sessionSourcePreviewKind({ mimeType: "text/plain", name }), "text");
    for (const name of ["unsafe.html", "unsafe.svg", "video.mp4", "document.pdf", "source.js"]) assert.equal(sessionSourcePreviewKind({ mimeType: "application/octet-stream", name }), null);
    assert.equal(sessionSourceCanOpenExternally({ mimeType: "text/html", name: "note.txt" }), false);
    assert.equal(sessionSourceCanOpenExternally({ mimeType: "text/plain", name: "note.txt" }), true);
  });
  it("permits bounded local image data and valid URLs, never executable schemes or embedded credentials", () => {
    for (const value of ["javascript:alert(1)", "data:text/html,<script>x</script>", "data:image/svg+xml;base64,PHN2Zz4=", "file:///private", "https://user:secret@example.test", "/relative"]) assert.equal(safeSessionSourceUrl(value), null);
    assert.equal(safeSessionSourceUrl("data:image/png;base64,YQ=="), "data:image/png;base64,YQ==");
    assert.equal(safeSessionSourceUrl("blob:owned"), "blob:owned");
    assert.equal(safeSessionSourceUrl("https://example.test/image.png"), "https://example.test/image.png");
  });
  it("renders preview text as text and provides named fallback states rather than a dead click", async () => {
    const source = await readFile(new URL("../src/features/sessions/SessionSourcesPanel.vue", import.meta.url), "utf8");
    assert.match(source, /<pre[^>]*>{{ text }}<\/pre>/);
    assert.doesNotMatch(source, /v-html|<iframe|ProjectContext|QaEvidence/);
    for (const key of ["previewLoading", "previewUnavailable", "previewFailed", "previewTooLarge", "retryPreview", "download", "openExternal"]) assert.match(source, new RegExp(`sessionTools\\.${key}`));
    assert.match(source, /rel="noopener noreferrer"/);
  });
});
