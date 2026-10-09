import { onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from "vue";
import { getAssetDownloadUrl } from "../assets/assetsApi";
import { CHAT_ATTACHMENT_POLICY } from "../chat/chatAttachments";
import { safeSessionSourceUrl, sessionSourcePreviewKind, type SessionSource } from "./sessionSources";

export type SessionSourcePreviewStatus = "idle" | "loading" | "text" | "image" | "unavailable" | "error" | "too-large";
export interface SessionSourcePreviewDependencies {
  getDownloadUrl: (assetId: string) => Promise<string>;
  fetch: (url: string, options: RequestInit) => Promise<Response>;
  createObjectUrl: (blob: Blob) => string;
  revokeObjectUrl: (url: string) => void;
}
const dependencies: SessionSourcePreviewDependencies = {
  getDownloadUrl: getAssetDownloadUrl,
  fetch: (url, options) => fetch(url, options),
  createObjectUrl: blob => URL.createObjectURL(blob),
  revokeObjectUrl: url => URL.revokeObjectURL(url),
};

export function useSessionSourcePreview(options: {
  scopeKey: MaybeRefOrGetter<string>;
  source: MaybeRefOrGetter<SessionSource | null>;
  active?: MaybeRefOrGetter<boolean>;
}, deps: SessionSourcePreviewDependencies = dependencies) {
  const status = ref<SessionSourcePreviewStatus>("idle");
  const text = ref("");
  const imageUrl = ref("");
  const downloadUrl = ref("");
  let revision = 0;
  let abort: AbortController | null = null;
  const ownedUrls = new Set<string>();
  function reset() {
    revision += 1;
    abort?.abort(); abort = null;
    ownedUrls.forEach(url => deps.revokeObjectUrl(url)); ownedUrls.clear();
    status.value = "idle"; text.value = ""; imageUrl.value = ""; downloadUrl.value = "";
  }
  function own(blob: Blob) { const url = deps.createObjectUrl(blob); ownedUrls.add(url); return url; }
  async function load() {
    reset();
    const source = toValue(options.source);
    if (!source || options.active !== undefined && !toValue(options.active)) return;
    const current = revision;
    const scope = toValue(options.scopeKey);
    const valid = () => revision === current && scope === toValue(options.scopeKey);
    const kind = sessionSourcePreviewKind(source);
    const maxBytes = kind === "image" ? CHAT_ATTACHMENT_POLICY.maxImageBytes : CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes;
    status.value = "loading";
    abort = new AbortController();
    const signal = abort.signal;
    try {
      if (source.file) {
        if (!kind) { status.value = "unavailable"; downloadUrl.value = own(source.file); return; }
        if (source.file.size > maxBytes) { status.value = "too-large"; return; }
        if (kind === "text") {
          const value = await source.file.text();
          if (!valid()) return;
          text.value = value; downloadUrl.value = own(new Blob([source.file], { type: "text/plain" })); status.value = "text";
        } else {
          imageUrl.value = own(new Blob([source.file], { type: source.mimeType })); downloadUrl.value = imageUrl.value; status.value = "image";
        }
        return;
      }
      const url = safeSessionSourceUrl(source.assetId ? await deps.getDownloadUrl(source.assetId) : source.previewUrl);
      if (!valid()) return;
      if (!url) { status.value = "unavailable"; return; }
      downloadUrl.value = url;
      if (!kind) { status.value = "unavailable"; return; }
      const response = await deps.fetch(url, { signal, credentials: "omit" });
      if (!valid()) return;
      if (!response.ok) throw new Error("Attachment preview failed");
      const length = Number(response.headers.get("Content-Length"));
      if (Number.isFinite(length) && length > maxBytes) { status.value = "too-large"; abort?.abort(); return; }
      const blob = await boundedBlob(response, maxBytes, signal);
      if (!valid()) return;
      if (!blob) { status.value = "too-large"; return; }
      if (kind === "text") {
        const value = await blob.text();
        if (!valid()) return;
        text.value = value; status.value = "text";
      } else {
        // The attachment policy excludes SVG/HTML; no iframe or executable content.
        imageUrl.value = own(new Blob([blob], { type: source.mimeType })); status.value = "image";
      }
    } catch {
      if (valid()) status.value = "error";
    }
  }
  // Polling replaces DTO objects; compare each identity/content field rather
  // than the newly allocated source object or an array returned by a getter.
  watch([
    () => toValue(options.scopeKey), () => toValue(options.source)?.id,
    () => toValue(options.source)?.assetId, () => toValue(options.source)?.previewUrl,
    () => toValue(options.source)?.file, () => toValue(options.source)?.name,
    () => toValue(options.source)?.mimeType,
    () => options.active === undefined || toValue(options.active),
  ], () => { void load(); }, { immediate: true, flush: "sync" });
  onScopeDispose(reset);
  return { status, text, imageUrl, downloadUrl, retry: load, reset,
    imageFailed: () => { if (status.value === "image") { imageUrl.value = ""; status.value = "error"; } } };
}

async function boundedBlob(response: Response, maxBytes: number, signal: AbortSignal): Promise<Blob | null> {
  if (!response.body) { const blob = await response.blob(); return blob.size > maxBytes ? null : blob; }
  const reader = response.body.getReader();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) return new Blob(chunks);
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); return null; }
      chunks.push(new Uint8Array(value));
    }
    await reader.cancel(); return null;
  } finally { signal.removeEventListener("abort", cancel); reader.releaseLock(); }
}
