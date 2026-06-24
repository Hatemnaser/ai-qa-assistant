import { createHash } from "node:crypto";

import { strFromU8, unzipSync } from "fflate";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { isSupportedProjectDocumentFile } from "../project-documents/project-document-files.js";
import {
  portableProjectChatSchema,
  portableProjectSchema,
  projectExportManifestSchema,
} from "./data-portability.schema.js";
import {
  PROJECT_EXPORT_FORMAT_VERSION,
  PROJECT_IMPORT_LIMITS,
  type ProjectImportPreview,
} from "./data-portability.types.js";

const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY_SIGNATURE = 0x02014b50;
const MAX_END_RECORD_SEARCH_BYTES = 65_557;
const INVALID_PACKAGE_MESSAGE = "Project import package is invalid or unsupported.";
const INVALID_PACKAGE_CODE = "PROJECT_IMPORT_PACKAGE_INVALID";

interface ZipEntryMetadata {
  path: string;
  compressedSize: number;
  uncompressedSize: number;
  isDirectory: boolean;
}

export function previewProjectImportPackage(archive: Buffer): ProjectImportPreview {
  if (archive.byteLength === 0 || archive.byteLength > PROJECT_IMPORT_LIMITS.maxCompressedBytes) {
    throwInvalidPackage();
  }

  const entryMetadata = inspectZipCentralDirectory(archive);
  const entries = unzipPackage(archive);
  validateUnzippedEntries(entryMetadata, entries);
  const manifest = parseJsonEntry(entries, "manifest.json");
  const projectJson = parseJsonEntry(entries, "data/project.json");
  const manifestResult = projectExportManifestSchema.safeParse(manifest);
  const projectResult = portableProjectSchema.safeParse(projectJson);

  if (!manifestResult.success || !projectResult.success) {
    throwInvalidPackage();
  }

  const parsedManifest = manifestResult.data;
  const parsedProject = projectResult.data;

  validatePackageIdentity(parsedManifest, parsedProject);
  const declaredPaths = validateManifestFiles(parsedManifest.files, entries);
  validateDocumentReferences(parsedProject.project.documents, entries, declaredPaths);

  const messageCount = validateChatReferences(parsedProject, entries, declaredPaths);

  if (
    parsedManifest.counts.documents !== parsedProject.project.documents.length ||
    parsedManifest.counts.chats !== parsedProject.project.chats.length ||
    parsedManifest.counts.messages !== messageCount
  ) {
    throwInvalidPackage();
  }

  if (!parsedManifest.include.chats && parsedProject.project.chats.length > 0) {
    throwInvalidPackage();
  }

  const unsupported = entryMetadata
    .filter((entry) => !entry.isDirectory)
    .map((entry) => entry.path)
    .filter(
      (path) =>
        path !== "manifest.json" &&
        path !== "data/project.json" &&
        !declaredPaths.has(path)
    )
    .map((path) => `Unrecognized ZIP entry: ${path}`);

  return {
    compatible: true,
    formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
    exportType: "project",
    packageDigest: createHash("sha256").update(archive).digest("hex"),
    suggestedProjectName: `${parsedProject.project.name} (Imported)`,
    sourceProjectName: parsedProject.project.name,
    counts: {
      documents: parsedProject.project.documents.length,
      chats: parsedProject.project.chats.length,
      messages: messageCount,
    },
    warnings: [...parsedManifest.warnings],
    unsupported,
  };
}

function inspectZipCentralDirectory(archive: Uint8Array): ZipEntryMetadata[] {
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  const endOffset = findEndOfCentralDirectory(view);

  if (endOffset < 0) {
    throwInvalidPackage();
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
    entryCount > PROJECT_IMPORT_LIMITS.maxEntries ||
    centralDirectoryOffset + centralDirectorySize > endOffset
  ) {
    throwInvalidPackage();
  }

  const entries: ZipEntryMetadata[] = [];
  const exactPaths = new Set<string>();
  const caseInsensitivePaths = new Set<string>();
  let cursor = centralDirectoryOffset;
  let totalUncompressedBytes = 0;

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > archive.byteLength) {
      throwInvalidPackage();
    }

    if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_ENTRY_SIGNATURE) {
      throwInvalidPackage();
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
    const entryEnd = cursor + 46 + fileNameLength + extraLength + commentLength;

    if (entryEnd > archive.byteLength || fileNameLength === 0) {
      throwInvalidPackage();
    }

    if ((flags & 0x1) !== 0 || ![0, 8].includes(compression)) {
      throwInvalidPackage();
    }

    const path = decodeZipPath(archive.subarray(cursor + 46, cursor + 46 + fileNameLength));
    const isDirectory = path.endsWith("/");

    validateZipPath(path);

    if (isUnsafeUnixEntry(versionMadeBy, externalAttributes, isDirectory)) {
      throwInvalidPackage();
    }

    if (exactPaths.has(path) || caseInsensitivePaths.has(path.toLocaleLowerCase("en-US"))) {
      throwInvalidPackage();
    }

    exactPaths.add(path);
    caseInsensitivePaths.add(path.toLocaleLowerCase("en-US"));

    if (
      uncompressedSize > PROJECT_IMPORT_LIMITS.maxEntryBytes ||
      compressedSize > PROJECT_IMPORT_LIMITS.maxCompressedBytes
    ) {
      throwInvalidPackage();
    }

    totalUncompressedBytes += uncompressedSize;
    if (totalUncompressedBytes > PROJECT_IMPORT_LIMITS.maxTotalUncompressedBytes) {
      throwInvalidPackage();
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
    throwInvalidPackage();
  }

  return entries;
}

function unzipPackage(archive: Uint8Array) {
  try {
    return unzipSync(archive);
  } catch {
    throwInvalidPackage();
  }
}

function validateUnzippedEntries(
  metadata: ZipEntryMetadata[],
  entries: Record<string, Uint8Array>
) {
  if (Object.keys(entries).length !== metadata.length) {
    throwInvalidPackage();
  }

  let totalUncompressedBytes = 0;

  for (const entry of metadata) {
    const content = entries[entry.path];

    if (
      !content ||
      content.byteLength !== entry.uncompressedSize ||
      content.byteLength > PROJECT_IMPORT_LIMITS.maxEntryBytes
    ) {
      throwInvalidPackage();
    }

    totalUncompressedBytes += content.byteLength;

    if (totalUncompressedBytes > PROJECT_IMPORT_LIMITS.maxTotalUncompressedBytes) {
      throwInvalidPackage();
    }
  }
}

function parseJsonEntry(entries: Record<string, Uint8Array>, path: string) {
  const entry = entries[path];

  if (!entry) {
    throwInvalidPackage();
  }

  try {
    return JSON.parse(strFromU8(entry)) as unknown;
  } catch {
    throwInvalidPackage();
  }
}

function validatePackageIdentity(
  manifest: z.infer<typeof projectExportManifestSchema>,
  project: z.infer<typeof portableProjectSchema>
) {
  if (
    manifest.formatVersion !== project.formatVersion ||
    manifest.exportType !== project.exportType ||
    manifest.projectId !== project.project.sourceId ||
    manifest.projectName !== project.project.name
  ) {
    throwInvalidPackage();
  }
}

function validateManifestFiles(
  files: z.infer<typeof projectExportManifestSchema>["files"],
  entries: Record<string, Uint8Array>
) {
  const paths = new Set<string>();
  const caseInsensitivePaths = new Set<string>();

  for (const file of files) {
    validateZipPath(file.path);

    const lowercasePath = file.path.toLocaleLowerCase("en-US");
    if (paths.has(file.path) || caseInsensitivePaths.has(lowercasePath)) {
      throwInvalidPackage();
    }

    paths.add(file.path);
    caseInsensitivePaths.add(lowercasePath);

    const content = entries[file.path];
    if (!content || content.byteLength !== file.sizeBytes) {
      throwInvalidPackage();
    }

    const digest = createHash("sha256").update(content).digest("hex");
    if (digest !== file.sha256) {
      throwInvalidPackage();
    }
  }

  if (!paths.has("data/project.json") || !paths.has("readable/project.md")) {
    throwInvalidPackage();
  }

  return paths;
}

function validateDocumentReferences(
  documents: z.infer<typeof portableProjectSchema>["project"]["documents"],
  entries: Record<string, Uint8Array>,
  declaredPaths: Set<string>
) {
  const paths = new Set<string>();

  for (const document of documents) {
    validateZipPath(document.file.path);

    if (!document.file.path.startsWith("documents/") || paths.has(document.file.path)) {
      throwInvalidPackage();
    }

    paths.add(document.file.path);

    if (!entries[document.file.path] || !declaredPaths.has(document.file.path)) {
      throwInvalidPackage();
    }

    if (
      document.source === "IMPORTED" &&
      (!document.metadata?.originalName ||
        !isSupportedProjectDocumentFile(
          document.metadata.originalName,
          document.mimeType || ""
        ))
    ) {
      throwInvalidPackage();
    }
  }
}

function validateChatReferences(
  project: z.infer<typeof portableProjectSchema>,
  entries: Record<string, Uint8Array>,
  declaredPaths: Set<string>
) {
  let messageCount = 0;
  const dataPaths = new Set<string>();
  const readablePaths = new Set<string>();

  for (const chatReference of project.project.chats) {
    validateZipPath(chatReference.dataPath);
    validateZipPath(chatReference.readablePath);

    if (
      !chatReference.dataPath.startsWith("data/chats/") ||
      !chatReference.readablePath.startsWith("readable/chats/") ||
      dataPaths.has(chatReference.dataPath) ||
      readablePaths.has(chatReference.readablePath) ||
      !entries[chatReference.readablePath] ||
      !declaredPaths.has(chatReference.dataPath) ||
      !declaredPaths.has(chatReference.readablePath)
    ) {
      throwInvalidPackage();
    }

    dataPaths.add(chatReference.dataPath);
    readablePaths.add(chatReference.readablePath);

    const chatResult = portableProjectChatSchema.safeParse(
      parseJsonEntry(entries, chatReference.dataPath)
    );

    if (
      !chatResult.success ||
      chatResult.data.projectId !== project.project.sourceId ||
      chatResult.data.chat.sourceId !== chatReference.sourceId ||
      chatResult.data.chat.title !== chatReference.title ||
      chatResult.data.chat.messages.length !== chatReference.messageCount
    ) {
      throwInvalidPackage();
    }

    messageCount += chatResult.data.chat.messages.length;
  }

  return messageCount;
}

function findEndOfCentralDirectory(view: DataView) {
  const minimumOffset = Math.max(0, view.byteLength - MAX_END_RECORD_SEARCH_BYTES);

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

function decodeZipPath(bytes: Uint8Array) {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throwInvalidPackage();
  }
}

function validateZipPath(path: string) {
  const pathWithoutTrailingSlash = path.endsWith("/") ? path.slice(0, -1) : path;
  const segments = pathWithoutTrailingSlash.split("/");

  if (
    !path ||
    path !== path.normalize("NFKC") ||
    path.length > PROJECT_IMPORT_LIMITS.maxPathChars ||
    /[\u0000-\u001f\u007f]/.test(path) ||
    path.includes("\\") ||
    path.startsWith("/") ||
    /^[a-z]:/i.test(path) ||
    isProhibitedArchivePath(path)
  ) {
    throwInvalidPackage();
  }

  if (
    segments.length === 0 ||
    segments.length > PROJECT_IMPORT_LIMITS.maxNestingDepth ||
    segments.some((segment) => !segment || segment === ".." || segment === ".")
  ) {
    throwInvalidPackage();
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

function isProhibitedArchivePath(path: string) {
  return /\.(?:apk|app|bat|cmd|com|dll|exe|gz|jar|msi|ps1|rar|scr|sh|tar|tgz|zip|7z)$/i.test(
    path
  );
}

function throwInvalidPackage(): never {
  throw new AppError(INVALID_PACKAGE_MESSAGE, 400, INVALID_PACKAGE_CODE);
}
