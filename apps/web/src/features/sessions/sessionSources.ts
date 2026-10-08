import { CHAT_ATTACHMENT_POLICY } from "../chat/chatAttachments";
import type { ChatAttachment, SelectedAttachment } from "../chat/types";

export interface SessionSource {
  id: string;
  origin: "saved" | "draft";
  name: string;
  mimeType: string;
  type: "image" | "file";
  assetId?: string;
  previewUrl?: string;
  file?: File;
  messageId?: string;
}

export interface SourceMessage {
  id: string;
  attachment?: ChatAttachment;
  attachments?: ChatAttachment[];
}

/** Conversation attachments are references, not proof of retrieval or QA evidence. */
export function buildSessionSources(messages: readonly SourceMessage[] = [], drafts: readonly SelectedAttachment[] = []): SessionSource[] {
  const seen = new Set<string>();
  const sources: SessionSource[] = [];
  for (const message of messages) {
    const attachments = [...(message.attachment ? [message.attachment] : []), ...(message.attachments || [])];
    attachments.forEach((attachment, index) => {
      const id = attachment.assetId ? `asset:${attachment.assetId}` : `message:${message.id}:attachment:${index}`;
      if (seen.has(id)) return;
      seen.add(id);
      sources.push({ id, origin: "saved", name: attachment.name, mimeType: attachment.mimeType,
        type: attachment.type, assetId: attachment.assetId, previewUrl: attachment.previewUrl, messageId: message.id });
    });
  }
  const occurrences = new Map<string, number>();
  for (const attachment of drafts) {
    const fingerprint = JSON.stringify([attachment.name, attachment.mimeType, attachment.file.size, attachment.file.lastModified]);
    const occurrence = occurrences.get(fingerprint) || 0;
    occurrences.set(fingerprint, occurrence + 1);
    sources.push({ id: `draft:${fingerprint}:${occurrence}`, origin: "draft", name: attachment.name,
      mimeType: attachment.mimeType, type: attachment.type, file: attachment.file, previewUrl: attachment.previewUrl });
  }
  return sources;
}

export function sessionSourcePreviewKind(source: Pick<SessionSource, "mimeType" | "name">): "image" | "text" | null {
  const mime = source.mimeType.toLowerCase().split(";")[0]!.trim();
  if ((CHAT_ATTACHMENT_POLICY.supportedImageMimeTypes as readonly string[]).includes(mime)) return "image";
  const extension = source.name.toLowerCase().split(".").at(-1) || "";
  return (CHAT_ATTACHMENT_POLICY.supportedTextExtensions as readonly string[]).includes(extension) ? "text" : null;
}

export function sessionSourceCanOpenExternally(source: Pick<SessionSource, "mimeType" | "name">): boolean {
  const mime = source.mimeType.toLowerCase().split(";")[0]!.trim();
  return (CHAT_ATTACHMENT_POLICY.supportedImageMimeTypes as readonly string[]).includes(mime)
    || sessionSourcePreviewKind(source) === "text" && ["text/plain", "text/markdown", "text/csv", "application/json"].includes(mime);
}

/** Never navigate to executable URLs supplied by historical attachment metadata. */
export function safeSessionSourceUrl(value: string | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("blob:")) return value;
  if (/^data:image\/(?:png|jpeg|webp);base64,[a-z\d+/=\s]+$/i.test(value)) return value;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
