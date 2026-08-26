import { createHash } from "node:crypto";

import { z } from "zod";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { AppError } from "../../lib/errors.js";
import {
  PROJECT_DOCUMENT_IMPORT_POLICY,
  isSupportedProjectDocumentFile,
} from "../project-documents/project-document-files.js";
import {
  validatePortableBinaryAssets,
  type ValidatedPortableBinaryAsset,
} from "./binary-assets.js";
import {
  portableProjectChatSchema,
  portableProjectSchema,
  projectExportManifestSchema,
} from "./data-portability.schema.js";
import {
  PROJECT_EXPORT_FORMAT_VERSION,
  PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
  PROJECT_IMPORT_LIMITS,
  type ProjectImportChat,
  type ProjectImportDocument,
  type ProjectImportPreview,
  type ValidatedProjectImportPackage,
} from "./data-portability.types.js";
import {
  decodeSafeUtf8,
  readSafeZipArchive,
  validateSafeZipPath,
  type SafeZipOptions,
} from "./safe-zip.js";

const INVALID_PACKAGE = {
  message: "Project import package is invalid or unsupported.",
  code: "PROJECT_IMPORT_PACKAGE_INVALID",
} as const;
const PROJECT_ZIP_OPTIONS = {
  isPathAllowed: (path: string) => !isProhibitedArchivePath(path),
} satisfies SafeZipOptions;

export function previewProjectImportPackage(archive: Buffer): ProjectImportPreview {
  const packageData = validateProjectImportPackage(archive);

  return {
    compatible: true,
    formatVersion: packageData.formatVersion,
    exportType: "project",
    packageDigest: packageData.packageDigest,
    suggestedProjectName: `${packageData.project.name} (Imported)`,
    sourceProjectName: packageData.project.name,
    counts: {
      documents: packageData.project.documents.length,
      chats: packageData.project.chats.length,
      messages: packageData.project.chats.reduce(
        (total, chat) => total + chat.messages.length,
        0
      ),
      ...(packageData.formatVersion === PROJECT_EXPORT_FORMAT_VERSION
        ? {
            assets: packageData.project.binaryAssets.length,
            assetBytes: packageData.project.binaryAssets.reduce(
              (total, asset) => total + asset.sizeBytes,
              0
            ),
          }
        : {}),
    },
    warnings: packageData.warnings,
    unsupported: packageData.unsupported,
  };
}

export function validateProjectImportPackage(
  archive: Buffer
): ValidatedProjectImportPackage {
  const { entries, metadata: entryMetadata } = readSafeZipArchive(
    archive,
    PROJECT_IMPORT_LIMITS,
    INVALID_PACKAGE,
    PROJECT_ZIP_OPTIONS
  );
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
  const documents = validateDocumentReferences(
    parsedProject.project.documents,
    entries,
    declaredPaths
  );
  const chats = validateChatReferences(parsedProject, entries, declaredPaths);
  const binaryAssets = validateProjectBinaryAssets({
    chats,
    documents,
    entries,
    entryPaths: entryMetadata
      .filter((entry) => !entry.isDirectory)
      .map((entry) => entry.path),
    manifest: parsedManifest,
    projectId: parsedProject.project.sourceId,
  });
  const messageCount = chats.reduce(
    (total, chat) => total + chat.messages.length,
    0
  );

  if (
    parsedManifest.counts.documents !== parsedProject.project.documents.length ||
    parsedManifest.counts.chats !== parsedProject.project.chats.length ||
    parsedManifest.counts.messages !== messageCount ||
    parsedProject.project.documents.length > PROJECT_IMPORT_LIMITS.maxDocuments ||
    parsedProject.project.chats.length > PROJECT_IMPORT_LIMITS.maxChats ||
    messageCount > PROJECT_IMPORT_LIMITS.maxMessages
  ) {
    throwInvalidPackage();
  }

  validateSemanticTextSize(parsedProject, documents, chats);

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
    formatVersion: parsedManifest.formatVersion,
    packageDigest: createHash("sha256").update(archive).digest("hex"),
    project: {
      sourceId: parsedProject.project.sourceId,
      name: parsedProject.project.name,
      description: parsedProject.project.description,
      instructions: parsedProject.project.instructions
        ? {
            content: parsedProject.project.instructions.content,
          }
        : null,
      memory: parsedProject.project.memory
        ? {
            content: parsedProject.project.memory.content,
          }
        : null,
      documents,
      chats,
      binaryAssets,
    },
    warnings: [...parsedManifest.warnings],
    unsupported,
  };
}

function parseJsonEntry(entries: Record<string, Uint8Array>, path: string) {
  const entry = entries[path];

  if (!entry) {
    throwInvalidPackage();
  }

  try {
    return JSON.parse(decodeSafeUtf8(entry, INVALID_PACKAGE)) as unknown;
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
    validateProjectZipPath(file.path);

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
  const importedDocuments: ProjectImportDocument[] = [];

  for (const document of documents) {
    validateProjectZipPath(document.file.path);

    if (!document.file.path.startsWith("documents/") || paths.has(document.file.path)) {
      throwInvalidPackage();
    }

    paths.add(document.file.path);

    const contentBytes = entries[document.file.path];
    if (!contentBytes || !declaredPaths.has(document.file.path)) {
      throwInvalidPackage();
    }

    const archiveName = document.file.path.split("/").at(-1);
    if (!archiveName) throwInvalidPackage();
    const portableName = archiveName.replace(/^\d{3}-/, "") || archiveName;

    const originalName =
      document.source === "IMPORTED"
        ? document.metadata?.originalName
        : portableName;

    if (
      !originalName ||
      originalName.length > PROJECT_DOCUMENT_IMPORT_POLICY.maxNameChars ||
      contentBytes.byteLength === 0 ||
      contentBytes.byteLength > PROJECT_DOCUMENT_IMPORT_POLICY.maxFileBytes ||
      !isSupportedProjectDocumentFile(originalName, document.mimeType || "")
    ) {
      throwInvalidPackage();
    }

    importedDocuments.push({
      sourceId: document.sourceId,
      title: document.title,
      content: decodeSafeUtf8(contentBytes, INVALID_PACKAGE),
      mimeType: document.mimeType,
      metadata: {
        originalName,
        sizeBytes: contentBytes.byteLength,
      },
      createdAt: new Date(document.createdAt),
      updatedAt: new Date(document.updatedAt),
    });
  }

  return importedDocuments;
}

function validateChatReferences(
  project: z.infer<typeof portableProjectSchema>,
  entries: Record<string, Uint8Array>,
  declaredPaths: Set<string>
) {
  const dataPaths = new Set<string>();
  const readablePaths = new Set<string>();
  const importedChats: ProjectImportChat[] = [];

  for (const chatReference of project.project.chats) {
    validateProjectZipPath(chatReference.dataPath);
    validateProjectZipPath(chatReference.readablePath);

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
      chatResult.data.formatVersion !== project.formatVersion ||
      chatResult.data.projectId !== project.project.sourceId ||
      chatResult.data.chat.sourceId !== chatReference.sourceId ||
      chatResult.data.chat.title !== chatReference.title ||
      chatResult.data.chat.messages.length !== chatReference.messageCount
    ) {
      throwInvalidPackage();
    }

    importedChats.push({
      sourceId: chatResult.data.chat.sourceId,
      title: chatResult.data.chat.title,
      mode: chatResult.data.chat.mode,
      model: chatResult.data.chat.model,
      createdAt: new Date(chatResult.data.chat.createdAt),
      updatedAt: new Date(chatResult.data.chat.updatedAt),
      messages: chatResult.data.chat.messages.map((message) => ({
        sourceId: message.sourceId,
        role: message.role,
        content: message.content,
        mode: message.mode,
        model: message.model,
        attachments: message.attachments ? [...message.attachments] : [],
        isError: message.isError === true,
        createdAt: new Date(message.createdAt),
      })),
    });
  }

  return importedChats;
}

function validateProjectBinaryAssets(input: {
  chats: ProjectImportChat[];
  documents: ProjectImportDocument[];
  entries: Record<string, Uint8Array>;
  entryPaths: string[];
  manifest: z.infer<typeof projectExportManifestSchema>;
  projectId: string;
}): ValidatedPortableBinaryAsset[] {
  const archiveAssetPaths = input.entryPaths.filter((path) =>
    path.startsWith("assets/")
  );

  if (input.manifest.formatVersion === PROJECT_EXPORT_LEGACY_FORMAT_VERSION) {
    if (archiveAssetPaths.length > 0) throwInvalidPackage();
    return [];
  }

  let assets: ValidatedPortableBinaryAsset[];
  try {
    assets = validatePortableBinaryAssets(input.manifest.assets, input.entries);
  } catch {
    throwInvalidPackage();
  }

  const assetPaths = new Set(assets.map((asset) => asset.file.path));
  const declaredFiles = new Map(
    input.manifest.files.map((file) => [file.path, file])
  );
  const assetBytes = assets.reduce(
    (total, asset) => total + asset.sizeBytes,
    0
  );

  if (
    input.manifest.counts.assets !== assets.length ||
    input.manifest.counts.assetBytes !== assetBytes ||
    archiveAssetPaths.length !== assetPaths.size ||
    archiveAssetPaths.some((path) => !assetPaths.has(path))
  ) {
    throwInvalidPackage();
  }

  for (const asset of assets) {
    const declared = declaredFiles.get(asset.file.path);
    if (
      !declared ||
      declared.sha256 !== asset.file.sha256 ||
      declared.sizeBytes !== asset.file.sizeBytes
    ) {
      throwInvalidPackage();
    }
  }

  validateImportedBinaryAssetRelations(input, assets);
  return assets;
}

function validateImportedBinaryAssetRelations(
  input: {
    chats: ProjectImportChat[];
    documents: ProjectImportDocument[];
    projectId: string;
  },
  assets: ValidatedPortableBinaryAsset[]
) {
  const documentsById = new Map<string, ProjectImportDocument>();
  for (const document of input.documents) {
    if (documentsById.has(document.sourceId)) throwInvalidPackage();
    documentsById.set(document.sourceId, document);
  }

  const chatIds = new Set<string>();
  const messagesById = new Map<string, ProjectImportChat["messages"][number]>();
  for (const chat of input.chats) {
    if (chatIds.has(chat.sourceId)) throwInvalidPackage();
    chatIds.add(chat.sourceId);

    for (const message of chat.messages) {
      if (messagesById.has(message.sourceId)) throwInvalidPackage();
      messagesById.set(message.sourceId, message);
    }
  }

  for (const asset of assets) {
    if (asset.sourceProjectId !== input.projectId) throwInvalidPackage();

    if (asset.binding.kind === "project_document_source") {
      const document = documentsById.get(asset.binding.sourceDocumentId);
      if (
        !document ||
        document.metadata.originalName !== asset.originalName ||
        document.mimeType !== asset.mimeType
      ) {
        throwInvalidPackage();
      }
      continue;
    }

    const message = messagesById.get(asset.binding.sourceMessageId);
    const attachment = message?.attachments[asset.binding.ordinal];
    if (
      !attachment ||
      attachment.name !== asset.originalName ||
      attachment.mimeType !== asset.mimeType ||
      attachment.type !== (asset.mimeType.startsWith("image/") ? "image" : "file")
    ) {
      throwInvalidPackage();
    }
  }
}

function validateSemanticTextSize(
  project: z.infer<typeof portableProjectSchema>,
  documents: ProjectImportDocument[],
  chats: ProjectImportChat[]
) {
  let totalChars =
    project.project.name.length +
    (project.project.description?.length || 0) +
    (project.project.instructions?.content.length || 0) +
    (project.project.memory?.content.length || 0);

  totalChars += documents.reduce(
    (total, document) => total + document.title.length + document.content.length,
    0
  );
  totalChars += chats.reduce(
    (chatTotal, chat) =>
      chatTotal +
      chat.title.length +
      chat.messages.reduce(
        (messageTotal, message) => messageTotal + message.content.length,
        0
      ),
    0
  );

  if (
    chats.some(
      (chat) =>
        chat.messages.reduce(
          (total, message) =>
            total + Buffer.byteLength(message.content, "utf8"),
          0
        ) > DATA_LIMITS.chatMessageContentBytesPerChat
    )
  ) {
    throwInvalidPackage();
  }

  if (totalChars > PROJECT_IMPORT_LIMITS.maxTotalTextChars) {
    throwInvalidPackage();
  }
}

function validateProjectZipPath(path: string) {
  validateSafeZipPath(
    path,
    PROJECT_IMPORT_LIMITS,
    INVALID_PACKAGE,
    PROJECT_ZIP_OPTIONS
  );
}

function isProhibitedArchivePath(path: string) {
  return /\.(?:apk|app|bat|cmd|com|dll|exe|gz|jar|msi|ps1|rar|scr|sh|tar|tgz|zip|7z)$/i.test(
    path
  );
}

function throwInvalidPackage(): never {
  throw new AppError(INVALID_PACKAGE.message, 400, INVALID_PACKAGE.code);
}
