export const CHAT_ATTACHMENT_LIMITS = Object.freeze({
  maxAttachments: 4,
  maxInlineImageBytes: 4 * 1024 * 1024,
  maxTextContentChars: 1_000_000,
  maxNameChars: 255,
});

export const CHAT_SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const CHAT_SUPPORTED_TEXT_EXTENSIONS = ["txt", "md", "log", "csv", "json"] as const;
export const CHAT_SUPPORTED_TEXT_MIME_TYPES = [
  "application/json",
  "text/csv",
  "text/markdown",
  "text/plain",
] as const;

export const MAX_INLINE_IMAGE_BASE64_CHARS = Math.ceil(CHAT_ATTACHMENT_LIMITS.maxInlineImageBytes / 3) * 4;

export function isSupportedImageMimeType(mimeType: string) {
  return CHAT_SUPPORTED_IMAGE_MIME_TYPES.includes(
    mimeType as (typeof CHAT_SUPPORTED_IMAGE_MIME_TYPES)[number]
  );
}

export function isSupportedTextAttachment(name = "", mimeType = "") {
  return isSupportedTextMimeType(mimeType) || isSupportedTextExtension(getAttachmentExtension(name));
}

export function isSupportedTextMimeType(mimeType: string) {
  return CHAT_SUPPORTED_TEXT_MIME_TYPES.includes(
    mimeType as (typeof CHAT_SUPPORTED_TEXT_MIME_TYPES)[number]
  );
}

export function isSupportedTextExtension(extension: string) {
  return CHAT_SUPPORTED_TEXT_EXTENSIONS.includes(
    extension as (typeof CHAT_SUPPORTED_TEXT_EXTENSIONS)[number]
  );
}

export function getAttachmentExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.at(-1) || "" : "";
}
