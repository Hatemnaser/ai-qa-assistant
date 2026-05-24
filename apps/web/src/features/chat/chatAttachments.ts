import type { ChatAttachment, RequestAttachment, SelectedAttachment } from "./types";

const MAX_IMAGE_SIZE_MB = 4;
const MAX_TEXT_ATTACHMENT_SIZE_MB = 1;
export const MAX_SELECTED_ATTACHMENTS = 4;
const SUPPORTED_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const SUPPORTED_TEXT_EXTENSIONS = ["txt", "md", "log", "csv", "json"] as const;
const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set(SUPPORTED_IMAGE_MIME_TYPES);
const SUPPORTED_TEXT_EXTENSION_SET: ReadonlySet<string> = new Set(SUPPORTED_TEXT_EXTENSIONS);
export const ATTACHMENT_INPUT_ACCEPT = [
  ...SUPPORTED_IMAGE_MIME_TYPES,
  ...SUPPORTED_TEXT_EXTENSIONS.map((extension) => `.${extension}`),
].join(",");
const IMAGE_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};
const TEXT_MIME_TYPES_BY_EXTENSION: Record<string, string> = {
  csv: "text/csv",
  json: "application/json",
  log: "text/plain",
  md: "text/markdown",
  txt: "text/plain",
};

export function getAttachmentFileError(file: File | undefined) {
  if (!file) return "";

  if (isSupportedImage(file)) {
    if (file.size > MAX_IMAGE_SIZE_MB * 1024 * 1024) {
      return `Image is too large. Please upload an image smaller than ${MAX_IMAGE_SIZE_MB}MB.`;
    }

    return "";
  }

  if (isSupportedTextAttachment(file)) {
    if (file.size > MAX_TEXT_ATTACHMENT_SIZE_MB * 1024 * 1024) {
      return `File is too large. Please upload a text or data file smaller than ${MAX_TEXT_ATTACHMENT_SIZE_MB}MB.`;
    }

    return "";
  }

  if (file.type.startsWith("video/") || getFileExtension(file.name) === "pdf") {
    return "Video/PDF support will be added in the next version using Gemini Files API.";
  }

  return "Please upload an image, text, markdown, log, CSV, or JSON file.";
}

export async function fileToSelectedAttachment(file: File): Promise<SelectedAttachment> {
  if (!isSupportedImage(file)) {
    return {
      type: "file",
      name: file.name,
      mimeType: getAttachmentMimeType(file),
      content: await file.text(),
    };
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      const result = String(reader.result || "");
      const base64Data = result.split(",")[1] || "";

      resolve({
        type: "image",
        name: file.name,
        mimeType: getAttachmentMimeType(file),
        data: base64Data,
        previewUrl: result,
      });
    };

    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createAttachment(attachment: SelectedAttachment): ChatAttachment {
  return {
    type: attachment.type,
    name: attachment.name,
    mimeType: attachment.mimeType,
    ...(attachment.previewUrl ? { previewUrl: attachment.previewUrl } : {}),
  };
}

export function createAttachments(attachments: SelectedAttachment[]): ChatAttachment[] {
  return attachments.map(createAttachment);
}

export function createRequestAttachment(attachment: SelectedAttachment): RequestAttachment {
  if (attachment.type === "image") {
    return {
      type: "image",
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: attachment.data,
    };
  }

  return {
    type: "file",
    name: attachment.name,
    mimeType: attachment.mimeType,
    content: attachment.content,
  };
}

export function createRequestAttachments(attachments: SelectedAttachment[]): RequestAttachment[] {
  return attachments.map(createRequestAttachment);
}

function isSupportedImage(file: File) {
  return SUPPORTED_IMAGE_TYPES.has(file.type) || Boolean(IMAGE_MIME_TYPES_BY_EXTENSION[getFileExtension(file.name)]);
}

function isSupportedTextAttachment(file: File) {
  return SUPPORTED_TEXT_EXTENSION_SET.has(getFileExtension(file.name));
}

function getAttachmentMimeType(file: File) {
  const extension = getFileExtension(file.name);

  return file.type || IMAGE_MIME_TYPES_BY_EXTENSION[extension] || TEXT_MIME_TYPES_BY_EXTENSION[extension] || "text/plain";
}

function getFileExtension(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() || "";
}
