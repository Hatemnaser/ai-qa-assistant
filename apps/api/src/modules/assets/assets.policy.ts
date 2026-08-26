import { DATA_LIMITS } from "../../config/data-limits.js";
import { AppError } from "../../lib/errors.js";

export const SUPPORTED_ASSET_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/json",
  "application/javascript",
  "application/typescript",
  "text/csv",
  "text/css",
  "text/html",
  "text/javascript",
  "text/markdown",
  "text/plain",
  "text/typescript",
  "video/mp2t",
]);

export function assertSupportedAsset(input: {
  maxImageBytes: number;
  maxTextBytes: number;
  mimeType: string;
  originalName: string;
  purpose: "CHAT_ATTACHMENT" | "PROJECT_DOCUMENT_SOURCE";
  sizeBytes: number;
}) {
  if (!SUPPORTED_ASSET_MIME_TYPES.has(input.mimeType)) {
    throw new AppError("Unsupported asset type.", 415, "ASSET_TYPE_UNSUPPORTED");
  }

  if (!hasMatchingExtension(input.originalName, input.mimeType)) {
    throw new AppError("File extension does not match its declared type.", 415, "ASSET_TYPE_UNSUPPORTED");
  }

  if (input.purpose === "PROJECT_DOCUMENT_SOURCE" && isImageMime(input.mimeType)) {
    throw new AppError("Project document assets must be text files.", 415, "ASSET_TYPE_UNSUPPORTED");
  }

  const maximum = isImageMime(input.mimeType)
    ? input.maxImageBytes
    : input.purpose === "PROJECT_DOCUMENT_SOURCE"
      ? Math.min(input.maxTextBytes, DATA_LIMITS.projectDocumentSourceBytes)
      : input.maxTextBytes;

  if (input.sizeBytes > maximum) {
    throw new AppError("Asset is too large.", 413, "ASSET_TOO_LARGE");
  }
}

export function detectAssetMime(bytes: Uint8Array, declaredMimeType: string) {
  if (hasPrefix(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return hasSafeImageDimensions(readPngDimensions(bytes)) ? "image/png" : null;
  }
  if (hasPrefix(bytes, [0xff, 0xd8, 0xff])) {
    return hasSafeImageDimensions(readJpegDimensions(bytes)) ? "image/jpeg" : null;
  }
  if (hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    return hasSafeImageDimensions(readWebpDimensions(bytes)) ? "image/webp" : null;
  }

  if (isImageMime(declaredMimeType)) return null;
  if (!isValidUtf8(bytes) || containsNul(bytes)) return null;
  if (declaredMimeType === "application/json" && !isValidJson(bytes)) return null;

  return declaredMimeType;
}

export function isImageMime(mimeType: string) {
  return mimeType.startsWith("image/");
}

function hasPrefix(bytes: Uint8Array, prefix: number[]) {
  return prefix.every((value, index) => bytes[index] === value);
}

function hasAscii(bytes: Uint8Array, offset: number, text: string) {
  return Array.from(text).every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function isValidUtf8(bytes: Uint8Array) {
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return true;
  } catch {
    return false;
  }
}

function containsNul(bytes: Uint8Array) {
  return bytes.includes(0);
}

function isValidJson(bytes: Uint8Array) {
  try {
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    return true;
  } catch {
    return false;
  }
}

const MIME_EXTENSIONS: Record<string, string[]> = {
  "application/json": ["json"],
  "application/javascript": ["js"],
  "application/typescript": ["ts"],
  "image/jpeg": ["jpeg", "jpg"],
  "image/png": ["png"],
  "image/webp": ["webp"],
  "text/csv": ["csv"],
  "text/css": ["css"],
  "text/html": ["html"],
  "text/javascript": ["js"],
  "text/markdown": ["md", "markdown"],
  "text/plain": ["css", "csv", "html", "js", "json", "log", "md", "markdown", "ts", "txt"],
  "text/typescript": ["ts"],
  "video/mp2t": ["ts"],
};
const MAX_IMAGE_DIMENSION = 8_192;
const MAX_IMAGE_PIXELS = 40_000_000;

function hasMatchingExtension(name: string, mimeType: string) {
  const extension = name.toLowerCase().split(".").pop();
  return Boolean(extension && MIME_EXTENSIONS[mimeType]?.includes(extension));
}

function hasSafeImageDimensions(dimensions: { height: number; width: number } | null) {
  return Boolean(
    dimensions &&
      dimensions.width > 0 &&
      dimensions.height > 0 &&
      dimensions.width <= MAX_IMAGE_DIMENSION &&
      dimensions.height <= MAX_IMAGE_DIMENSION &&
      dimensions.width * dimensions.height <= MAX_IMAGE_PIXELS
  );
}

function readPngDimensions(bytes: Uint8Array) {
  if (bytes.length < 24 || !hasAscii(bytes, 12, "IHDR")) return null;
  return { width: readUint32Be(bytes, 16), height: readUint32Be(bytes, 20) };
}

function readJpegDimensions(bytes: Uint8Array) {
  let offset = 2;
  const sofMarkers = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);

  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    const segmentLength = readUint16Be(bytes, offset + 2);
    if (segmentLength < 2 || offset + segmentLength + 2 > bytes.length) return null;
    if (sofMarkers.has(marker)) {
      return {
        height: readUint16Be(bytes, offset + 5),
        width: readUint16Be(bytes, offset + 7),
      };
    }
    offset += segmentLength + 2;
  }

  return null;
}

function readWebpDimensions(bytes: Uint8Array) {
  if (bytes.length < 30) return null;
  const chunk = new TextDecoder("ascii").decode(bytes.subarray(12, 16));
  if (chunk === "VP8X") {
    return {
      width: 1 + readUint24Le(bytes, 24),
      height: 1 + readUint24Le(bytes, 27),
    };
  }
  if (chunk === "VP8 " && hasPrefixAt(bytes, 23, [0x9d, 0x01, 0x2a])) {
    return {
      width: readUint16Le(bytes, 26) & 0x3fff,
      height: readUint16Le(bytes, 28) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes[20] === 0x2f && bytes.length >= 25) {
    return {
      width: 1 + ((bytes[21] || 0) | (((bytes[22] || 0) & 0x3f) << 8)),
      height: 1 + (((bytes[22] || 0) >> 6) | ((bytes[23] || 0) << 2) | (((bytes[24] || 0) & 0x0f) << 10)),
    };
  }
  return null;
}

function hasPrefixAt(bytes: Uint8Array, offset: number, prefix: number[]) {
  return prefix.every((value, index) => bytes[offset + index] === value);
}

function readUint16Be(bytes: Uint8Array, offset: number) {
  return ((bytes[offset] || 0) << 8) | (bytes[offset + 1] || 0);
}

function readUint16Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8);
}

function readUint24Le(bytes: Uint8Array, offset: number) {
  return (bytes[offset] || 0) | ((bytes[offset + 1] || 0) << 8) | ((bytes[offset + 2] || 0) << 16);
}

function readUint32Be(bytes: Uint8Array, offset: number) {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, false);
}
