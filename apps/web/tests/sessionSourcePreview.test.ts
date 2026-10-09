import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { afterEach, describe, it } from "node:test";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import * as vue from "vue";
import * as sources from "../src/features/sessions/sessionSources";
import * as attachmentPolicy from "../src/features/chat/chatAttachments";
import type { SessionSource } from "../src/features/sessions/sessionSources";
import type { useSessionSourcePreview, SessionSourcePreviewDependencies } from "../src/features/sessions/useSessionSourcePreview";

const source = await readFile(new URL("../src/features/sessions/useSessionSourcePreview.ts", import.meta.url), "utf8");
const compiled = transpileModule(source, { compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} as { useSessionSourcePreview: typeof useSessionSourcePreview } };
const imports: Record<string, unknown> = { vue, "./sessionSources": sources, "../chat/chatAttachments": attachmentPolicy, "../assets/assetsApi": { getAssetDownloadUrl: () => assert.fail("Tests must not read actual assets") } };
new Function("require", "exports", compiled)((id: string) => { assert.ok(id in imports, `Unexpected dependency ${id}`); return imports[id]; }, module.exports);
const scopes: vue.EffectScope[] = [];
afterEach(() => scopes.splice(0).forEach(scope => scope.stop()));
const settle = async () => { for (let i = 0; i < 20; i += 1) await vue.nextTick(); await new Promise(resolve => setImmediate(resolve)); };
const file = (content = "<script>untrusted</script>") => new File([content], "requirements.txt", { type: "text/plain" });
const saved = (id = "asset:a"): SessionSource => ({ id, name: "requirements.txt", origin: "saved", type: "file", mimeType: "text/plain", assetId: id.slice(6) });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mount(initial: SessionSource | null = saved(), overrides: Partial<SessionSourcePreviewDependencies> = {}) {
  const input = vue.reactive({ scopeKey: "owner:session", source: initial, active: true });
  const calls: string[] = [], revoked: string[] = [], blobs: Blob[] = [];
  const deps: SessionSourcePreviewDependencies = {
    getDownloadUrl: async id => { calls.push(`url:${id}`); return `https://storage.example.test/${id}`; },
    fetch: async (_url, options) => { calls.push(`fetch:${options.credentials}`); return new Response("safe content"); },
    createObjectUrl: blob => { blobs.push(blob); return `blob:preview:${blobs.length}`; },
    revokeObjectUrl: url => revoked.push(url), ...overrides,
  };
  const scope = vue.effectScope(); scopes.push(scope);
  const state = scope.run(() => module.exports.useSessionSourcePreview({ scopeKey: () => input.scopeKey, source: () => input.source, active: () => input.active }, deps))!;
  return { state, input, calls, revoked, blobs, stop: () => scope.stop() };
}
describe("bounded, account-scoped session source preview", () => {
  it("reads a local text File as plain text without asset requests and leaves composer URLs alone", async () => {
    const local = file();
    const app = mount({ ...saved(), assetId: undefined, origin: "draft", file: local, previewUrl: "blob:composer-owned" });
    await settle();
    assert.equal(app.state.status.value, "text");
    assert.equal(app.state.text.value, "<script>untrusted</script>");
    assert.deepEqual(app.calls, []);
    app.stop();
    assert.deepEqual(app.revoked, ["blob:preview:1"]);
    assert.ok(!app.revoked.includes("blob:composer-owned"));
  });
  it("reuses the private signed-URL service and does not send cookies to storage", async () => {
    const app = mount(); await settle();
    assert.equal(app.state.status.value, "text");
    assert.equal(app.state.text.value, "safe content");
    assert.deepEqual(app.calls, ["url:a", "fetch:omit"]);
    assert.equal(app.state.downloadUrl.value, "https://storage.example.test/a");
  });
  it("does not refetch when polling merely replaces an equivalent source DTO", async () => {
    const app = mount(); await settle();
    app.input.source = saved(); await settle();
    assert.deepEqual(app.calls, ["url:a", "fetch:omit"]);
  });
  it("shows unavailable for metadata-only history without any request or fabricated content", async () => {
    const app = mount({ ...saved(), assetId: undefined }); await settle();
    assert.equal(app.state.status.value, "unavailable");
    assert.equal(app.state.text.value, "");
    assert.equal(app.state.downloadUrl.value, "");
    assert.deepEqual(app.calls, []);
  });
  it("retains an authorized fallback URL on a blocked preview fetch and supports explicit retry", async () => {
    let count = 0;
    const app = mount(saved(), { fetch: async () => { if (!count++) throw new Error("CORS blocked"); return new Response("retried"); } });
    await settle(); assert.equal(app.state.status.value, "error");
    assert.equal(app.state.downloadUrl.value, "https://storage.example.test/a");
    await app.state.retry(); assert.equal(app.state.status.value, "text"); assert.equal(app.state.text.value, "retried");
  });
  it("never accepts a late signed URL from another owner or session", async () => {
    const pending = deferred<string>();
    const app = mount(saved(), { getDownloadUrl: () => pending.promise });
    app.input.scopeKey = "another-owner:another-session"; app.input.source = null;
    pending.resolve("https://private.example.test/old-owner"); await settle();
    assert.equal(app.state.status.value, "idle"); assert.equal(app.state.downloadUrl.value, ""); assert.deepEqual(app.calls, []);
  });
  it("does not replace a new selection with late bytes or a late local File read", async () => {
    const pending = deferred<Response>();
    const app = mount(saved(), { fetch: async url => url.endsWith("/a") ? pending.promise : new Response("new source") });
    await settle(); app.input.source = saved("asset:b"); await settle();
    assert.equal(app.state.text.value, "new source");
    pending.resolve(new Response("old source")); await settle();
    assert.equal(app.state.text.value, "new source");
    const localRead = deferred<string>();
    const local = file(); Object.defineProperty(local, "text", { value: () => localRead.promise });
    app.input.source = { ...saved("asset:local"), assetId: undefined, file: local };
    app.input.source = null; localRead.resolve("old local content"); await settle();
    assert.equal(app.state.status.value, "idle"); assert.equal(app.state.text.value, "");
  });
  it("cancels the current request and rejects late content when the panel closes", async () => {
    const pending = deferred<Response>(); let signal: AbortSignal | undefined;
    const app = mount(saved(), { fetch: async (_url, options) => { signal = options.signal as AbortSignal; return pending.promise; } });
    await settle(); app.input.active = false;
    assert.equal(signal?.aborted, true);
    pending.resolve(new Response("late")); await settle();
    assert.equal(app.state.status.value, "idle"); assert.equal(app.state.text.value, "");
  });
  it("rejects oversized local and remote data before assigning preview contents", async () => {
    const size = attachmentPolicy.CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes + 1;
    const local = mount({ ...saved(), assetId: undefined, file: file("a".repeat(size)) }); await settle();
    assert.equal(local.state.status.value, "too-large"); assert.equal(local.blobs.length, 0);
    const remote = mount(saved(), { fetch: async () => new Response("small", { headers: { "Content-Length": String(size) } }) }); await settle();
    assert.equal(remote.state.status.value, "too-large"); assert.equal(remote.state.text.value, "");
  });
  it("enforces the stream limit even without a trustworthy Content-Length", async () => {
    const app = mount(saved(), { fetch: async () => new Response("a".repeat(attachmentPolicy.CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes + 1)) }); await settle();
    assert.equal(app.state.status.value, "too-large"); assert.equal(app.state.text.value, "");
  });
  it("creates and releases only its own local image preview URL", async () => {
    const app = mount({ ...saved(), type: "image", mimeType: "image/png", name: "image.png", assetId: undefined, file: new File(["bytes"], "image.png", { type: "image/png" }) }); await settle();
    assert.equal(app.state.status.value, "image"); assert.equal(app.state.imageUrl.value, "blob:preview:1");
    app.input.source = null; assert.deepEqual(app.revoked, ["blob:preview:1"]); app.stop(); assert.deepEqual(app.revoked, ["blob:preview:1"]);
  });
  it("preserves fallback access if an image cannot be decoded", async () => {
    const app = mount({ ...saved(), type: "image", mimeType: "image/png", name: "image.png" }); await settle();
    assert.equal(app.state.status.value, "image"); app.state.imageFailed();
    assert.equal(app.state.status.value, "error"); assert.equal(app.state.imageUrl.value, ""); assert.equal(app.state.downloadUrl.value, "https://storage.example.test/a");
  });
  it("does not fetch unsupported file types or unsafe historical URLs", async () => {
    const unsupported = mount({ ...saved(), name: "unsafe.html", mimeType: "text/html" }); await settle();
    assert.equal(unsupported.state.status.value, "unavailable"); assert.deepEqual(unsupported.calls, ["url:a"]);
    const unsafe = mount({ ...saved(), assetId: undefined, previewUrl: "javascript:alert(1)" }); await settle();
    assert.equal(unsafe.state.status.value, "unavailable"); assert.deepEqual(unsafe.calls, []);
  });
});
