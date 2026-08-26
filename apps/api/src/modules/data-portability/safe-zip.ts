import { unzipSync } from "fflate";

import { AppError } from "../../lib/errors.js";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const MAX_END_RECORD_SEARCH_BYTES = 65_557;

export interface SafeZipLimits {
  maxCompressedBytes: number;
  maxEntries: number;
  maxEntryBytes: number;
  maxNestingDepth: number;
  maxPathChars: number;
  maxTotalUncompressedBytes: number;
}

export interface SafeZipError {
  code: string;
  message: string;
}

export interface SafeZipOptions {
  isPathAllowed?: (path: string) => boolean;
}

export interface SafeZipEntryMetadata {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export interface SafeZipArchive {
  entries: Record<string, Uint8Array>;
  metadata: SafeZipEntryMetadata[];
}

export function readSafeZip(
  archive: Buffer,
  limits: SafeZipLimits,
  error: SafeZipError,
  options: SafeZipOptions = {}
) {
  return readSafeZipArchive(archive, limits, error, options).entries;
}

export function readSafeZipArchive(
  archive: Buffer,
  limits: SafeZipLimits,
  error: SafeZipError,
  options: SafeZipOptions = {}
): SafeZipArchive {
  if (
    archive.byteLength === 0 ||
    archive.byteLength > limits.maxCompressedBytes
  ) {
    throwInvalidZip(error);
  }

  const metadata = inspectCentralDirectory(archive, limits, error, options);
  const entries = unzipArchive(archive, error);

  if (Object.keys(entries).length !== metadata.length) {
    throwInvalidZip(error);
  }

  let totalUncompressedBytes = 0;
  for (const entry of metadata) {
    const content = entries[entry.path];

    if (
      !content ||
      content.byteLength !== entry.uncompressedSize ||
      content.byteLength > limits.maxEntryBytes
    ) {
      throwInvalidZip(error);
    }

    totalUncompressedBytes += content.byteLength;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throwInvalidZip(error);
    }
  }

  return { entries, metadata };
}

export function decodeSafeUtf8(
  content: Uint8Array,
  error: SafeZipError
) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  } catch {
    throwInvalidZip(error);
  }
}

function inspectCentralDirectory(
  archive: Uint8Array,
  limits: SafeZipLimits,
  error: SafeZipError,
  options: SafeZipOptions
) {
  const view = new DataView(
    archive.buffer,
    archive.byteOffset,
    archive.byteLength
  );
  const endOffset = findEndOfCentralDirectory(view);

  if (endOffset < 0) {
    throwInvalidZip(error);
  }

  const diskNumber = view.getUint16(endOffset + 4, true);
  const centralDirectoryDisk = view.getUint16(endOffset + 6, true);
  const entriesOnDisk = view.getUint16(endOffset + 8, true);
  const entryCount = view.getUint16(endOffset + 10, true);
  const centralDirectorySize = view.getUint32(endOffset + 12, true);
  const centralDirectoryOffset = view.getUint32(endOffset + 16, true);

  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0 ||
    entryCount > limits.maxEntries ||
    centralDirectoryOffset + centralDirectorySize > endOffset
  ) {
    throwInvalidZip(error);
  }

  const entries: SafeZipEntryMetadata[] = [];
  const exactPaths = new Set<string>();
  const caseInsensitivePaths = new Set<string>();
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > archive.byteLength ||
      view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE
    ) {
      throwInvalidZip(error);
    }

    const versionMadeBy = view.getUint16(cursor + 4, true);
    const flags = view.getUint16(cursor + 8, true);
    const compression = view.getUint16(cursor + 10, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const fileNameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const entryEnd =
      cursor + 46 + fileNameLength + extraLength + commentLength;

    if (entryEnd > archive.byteLength || fileNameLength === 0) {
      throwInvalidZip(error);
    }

    if ((flags & 0x1) !== 0 || ![0, 8].includes(compression)) {
      throwInvalidZip(error);
    }

    const path = decodeZipPath(
      archive.subarray(cursor + 46, cursor + 46 + fileNameLength),
      error
    );
    const isDirectory = path.endsWith("/");

    validateSafeZipPath(path, limits, error, options);

    if (isUnsafeUnixEntry(versionMadeBy, externalAttributes, isDirectory)) {
      throwInvalidZip(error);
    }

    const lowercasePath = path.toLocaleLowerCase("en-US");
    if (exactPaths.has(path) || caseInsensitivePaths.has(lowercasePath)) {
      throwInvalidZip(error);
    }

    exactPaths.add(path);
    caseInsensitivePaths.add(lowercasePath);

    if (
      uncompressedSize > limits.maxEntryBytes ||
      compressedSize > limits.maxCompressedBytes
    ) {
      throwInvalidZip(error);
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > limits.maxTotalUncompressedBytes) {
      throwInvalidZip(error);
    }

    entries.push({
      path,
      compressedSize,
      uncompressedSize,
      isDirectory,
    });
    cursor = entryEnd;
  }

  if (cursor !== centralDirectoryOffset + centralDirectorySize) {
    throwInvalidZip(error);
  }

  return entries;
}

function unzipArchive(archive: Uint8Array, error: SafeZipError) {
  try {
    return unzipSync(archive);
  } catch {
    throwInvalidZip(error);
  }
}

function findEndOfCentralDirectory(view: DataView) {
  const minimumOffset = Math.max(
    0,
    view.byteLength - MAX_END_RECORD_SEARCH_BYTES
  );

  for (let offset = view.byteLength - 22; offset >= minimumOffset; offset -= 1) {
    if (view.getUint32(offset, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
      const commentLength = view.getUint16(offset + 20, true);
      if (offset + 22 + commentLength === view.byteLength) {
        return offset;
      }
    }
  }

  return -1;
}

function decodeZipPath(bytes: Uint8Array, error: SafeZipError) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throwInvalidZip(error);
  }
}

export function validateSafeZipPath(
  path: string,
  limits: SafeZipLimits,
  error: SafeZipError,
  options: SafeZipOptions = {}
) {
  const pathWithoutTrailingSlash = path.endsWith("/")
    ? path.slice(0, -1)
    : path;
  const segments = pathWithoutTrailingSlash.split("/");

  if (
    !path ||
    path !== path.normalize("NFKC") ||
    path.length > limits.maxPathChars ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    options.isPathAllowed?.(path) === false
  ) {
    throwInvalidZip(error);
  }

  if (
    segments.length === 0 ||
    segments.length > limits.maxNestingDepth ||
    segments.some((segment) => !segment || segment === ".." || segment === ".")
  ) {
    throwInvalidZip(error);
  }
}

function isUnsafeUnixEntry(
  versionMadeBy: number,
  externalAttributes: number,
  isDirectory: boolean
) {
  const creatorSystem = versionMadeBy >> 8;
  const unixMode = externalAttributes >>> 16;

  if (creatorSystem !== 3 || unixMode === 0) return false;

  const fileType = unixMode & 0xf000;
  if (fileType !== 0) {
    const expectedType = isDirectory ? 0x4000 : 0x8000;
    if (fileType !== expectedType) return true;
  }

  return !isDirectory && (unixMode & 0o111) !== 0;
}

function throwInvalidZip(error: SafeZipError): never {
  throw new AppError(error.message, 400, error.code);
}
