import type {
  ChatAttachment,
  RequestAttachment,
  RequestImageAttachment,
  SelectedAttachment,
} from "./types";

export const CHAT_ATTACHMENT_POLICY = {
  maxAttachments: 4,
  maxImageBytes: 4 * 1024 * 1024,
  maxTextAttachmentBytes: 1_000_000,
  supportedImageMimeTypes: ["image/png", "image/jpeg", "image/webp"],
  supportedTextExtensions: ["txt", "md", "log", "csv", "json"],
} as const;

export const MAX_SELECTED_ATTACHMENTS = CHAT_ATTACHMENT_POLICY.maxAttachments;
export type AttachmentFileError =
  | { code: "IMAGE_TOO_LARGE"; maxBytes: number }
  | { code: "TEXT_FILE_TOO_LARGE"; maxBytes: number }
  | { code: "FUTURE_FILE_TYPE" }
  | { code: "UNSUPPORTED_FILE_TYPE" };
const SUPPORTED_IMAGE_TYPES: ReadonlySet<string> = new Set(CHAT_ATTACHMENT_POLICY.supportedImageMimeTypes);
const SUPPORTED_TEXT_EXTENSION_SET: ReadonlySet<string> = new Set(CHAT_ATTACHMENT_POLICY.supportedTextExtensions);
export const ATTACHMENT_INPUT_ACCEPT = [
  ...CHAT_ATTACHMENT_POLICY.supportedImageMimeTypes,
  ...CHAT_ATTACHMENT_POLICY.supportedTextExtensions.map((extension) => `.${extension}`),
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

export function getAttachmentFileError(file: File | undefined): AttachmentFileError | null {
  if (!file) return null;

  if (isSupportedImage(file)) {
    if (file.size > CHAT_ATTACHMENT_POLICY.maxImageBytes) {
      return {
        code: "IMAGE_TOO_LARGE",
        maxBytes: CHAT_ATTACHMENT_POLICY.maxImageBytes,
      };
    }

    return null;
  }

  if (isSupportedTextAttachment(file)) {
    if (file.size > CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes) {
      return {
        code: "TEXT_FILE_TOO_LARGE",
        maxBytes: CHAT_ATTACHMENT_POLICY.maxTextAttachmentBytes,
      };
    }

    return null;
  }

  if (file.type.startsWith("video/") || getFileExtension(file.name) === "pdf") {
    return { code: "FUTURE_FILE_TYPE" };
  }

  return { code: "UNSUPPORTED_FILE_TYPE" };
}

export function formatAttachmentByteLimit(bytes: number) {
  const megaBytes = bytes / (1024 * 1024);

  return `${Number.isInteger(megaBytes) ? megaBytes : megaBytes.toFixed(1)} MB`;
}

export async function fileToSelectedAttachment(file: File): Promise<SelectedAttachment> {
  const type = isSupportedImage(file) ? "image" : "file";

  return {
    file,
    type,
    name: file.name,
    mimeType: getAttachmentMimeType(file),
    ...(type === "image" ? { previewUrl: createLocalObjectUrl(file) } : {}),
  };
}

export function createAttachment(
  attachment: SelectedAttachment,
  options: { assetId?: string; previewUrl?: string } = {}
): ChatAttachment {
  return {
    ...(options.assetId ? { assetId: options.assetId } : {}),
    type: attachment.type,
    name: attachment.name,
    mimeType: attachment.mimeType,
    ...(options.previewUrl ? { previewUrl: options.previewUrl } : {}),
  };
}

export async function createLegacyRequestAttachment(attachment: SelectedAttachment): Promise<RequestAttachment> {
  if (attachment.type === "image") {
    return {
      type: "image",
      name: attachment.name,
      mimeType: attachment.mimeType,
      data: await blobToBase64(attachment.file),
    };
  }

  return {
    type: "file",
    name: attachment.name,
    mimeType: attachment.mimeType,
    content: await attachment.file.text(),
  };
}

export async function createLegacyRequestAttachments(attachments: SelectedAttachment[]): Promise<RequestAttachment[]> {
  return Promise.all(attachments.map(createLegacyRequestAttachment));
}

export function createLegacyDisplayAttachments(
  attachments: SelectedAttachment[],
  requests: RequestAttachment[]
): ChatAttachment[] {
  return attachments.map((attachment, index) => {
    const request = requests[index];
    const previewUrl = isInlineImageRequest(request)
      ? `data:${request.mimeType};base64,${request.data}`
      : undefined;

    return createAttachment(attachment, { previewUrl });
  });
}

export function releaseSelectedAttachment(attachment: SelectedAttachment | undefined) {
  if (attachment?.previewUrl?.startsWith("blob:")) {
    URL.revokeObjectURL(attachment.previewUrl);
  }
}

function isSupportedImage(file: File) {
  return SUPPORTED_IMAGE_TYPES.has(file.type) || Boolean(IMAGE_MIME_TYPES_BY_EXTENSION[getFileExtension(file.name)]);
}

function isSupportedTextAttachment(file: File) {
  return SUPPORTED_TEXT_EXTENSION_SET.has(getFileExtension(file.name));
}

export function getAttachmentMimeType(file: File) {
  const extension = getFileExtension(file.name);

  return IMAGE_MIME_TYPES_BY_EXTENSION[extension]
    || TEXT_MIME_TYPES_BY_EXTENSION[extension]
    || file.type
    || "text/plain";
}

async function blobToBase64(blob: Blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }

  return globalThis.btoa(binary);
}

function createLocalObjectUrl(file: File) {
  return typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "";
}

function isInlineImageRequest(request: RequestAttachment | undefined): request is RequestImageAttachment {
  return Boolean(request && "type" in request && request.type === "image");
}

function getFileExtension(fileName: string) {
  const parts = fileName.toLowerCase().split(".");

  return parts.length > 1 ? parts.at(-1) || "" : "";
}
