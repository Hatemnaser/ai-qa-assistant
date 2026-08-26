import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { ChatRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import { CHAT_ATTACHMENT_LIMITS } from "../chat/chat.attachments.js";
import {
  validatePortableBinaryAssets,
  type CollectedPortableBinaryAssets,
  type PortableBinaryAssetDescriptor,
  type ValidatedPortableBinaryAsset,
} from "./binary-assets.js";
import {
  PROJECT_EXPORT_FORMAT_VERSION,
  PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
  PROJECT_EXPORT_LIMITS,
  type ProjectExportChatRecord,
  type ProjectExportDocumentRecord,
  type ProjectExportFileManifestEntry,
  type ProjectExportFormatVersion,
  type ProjectExportManifest,
  type ProjectExportMessageRecord,
  type ProjectExportOptions,
  type ProjectExportPackage,
  type ProjectExportSourceRecord,
} from "./data-portability.types.js";

const CHAT_ATTACHMENT_WARNING =
  "Chat attachment metadata is included, but original attachment files are not included in this archive.";
const PARTIAL_CHAT_ATTACHMENT_WARNING =
  "Some chat attachment metadata is included without the corresponding original attachment file.";
const PRIVATE_ASSET_WARNING =
  "Private object-storage binaries are not included in this legacy version 1 archive. Export again with available private assets to create a version 2 archive.";

interface PortableAttachmentMetadata {
  type: "image" | "file";
  name: string;
  mimeType: string;
}

export function createProjectExportPackage(
  project: ProjectExportSourceRecord,
  options: ProjectExportOptions,
  exportedAt = new Date(),
  binaryAssets?: CollectedPortableBinaryAssets
): ProjectExportPackage {
  validateSourceSemantics(project, options);

  const entries = new Map<string, Uint8Array>();
  const formatVersion = binaryAssets
    ? PROJECT_EXPORT_FORMAT_VERSION
    : PROJECT_EXPORT_LEGACY_FORMAT_VERSION;
  const chats = options.includeChats ? project.chats : [];
  const assetDescriptors = binaryAssets
    ? validateBinaryAssetBundleForExport(project, chats, binaryAssets)
    : [];

  for (const asset of assetDescriptors) {
    entries.set(asset.file.path, binaryAssets!.entries.get(asset.file.path)!);
  }

  const documentReferences = project.documents.map((document, index) => {
    const path = createDocumentPath(document, index);

    entries.set(path, strToU8(document.content));

    return {
      sourceId: document.id,
      title: document.title,
      source: document.source,
      mimeType: document.mimeType,
      metadata: toPortableDocumentMetadata(document.metadata),
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      file: {
        path,
        encoding: "utf-8",
      },
    };
  });
  const chatReferences = chats.map((chat, index) => {
    const sequence = padSequence(index);
    const dataPath = `data/chats/chat-${sequence}.json`;
    const readablePath = `readable/chats/chat-${sequence}.md`;

    entries.set(
      dataPath,
      encodeJson(createPortableChat(project.id, chat, formatVersion))
    );
    entries.set(readablePath, strToU8(formatChatAsMarkdown(chat)));

    return {
      sourceId: chat.id,
      title: chat.title,
      dataPath,
      readablePath,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messageCount: chat.messages.length,
    };
  });

  const projectJson = {
    formatVersion,
    exportType: "project",
    project: {
      sourceId: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      instructions: project.instruction
        ? {
            content: project.instruction.content,
            createdAt: project.instruction.createdAt.toISOString(),
            updatedAt: project.instruction.updatedAt.toISOString(),
          }
        : null,
      memory: project.projectMemory
        ? {
            content: project.projectMemory.content,
            source: project.projectMemory.source,
            createdAt: project.projectMemory.createdAt.toISOString(),
            updatedAt: project.projectMemory.updatedAt.toISOString(),
          }
        : null,
      documents: documentReferences,
      chats: chatReferences,
    },
  };

  entries.set("data/project.json", encodeJson(projectJson));
  entries.set(
    "readable/project.md",
    strToU8(formatProjectAsMarkdown(project, documentReferences, chatReferences))
  );

  if (project.instruction) {
    entries.set("readable/instructions.md", strToU8(project.instruction.content));
  }

  if (project.projectMemory) {
    entries.set("readable/memory.md", strToU8(project.projectMemory.content));
  }

  const warnings = createExportWarnings(chats, binaryAssets, assetDescriptors);
  const files = createFileManifest(entries);
  const manifestCommon = {
    exportType: "project" as const,
    exportedAt: exportedAt.toISOString(),
    projectId: project.id,
    projectName: project.name,
    warnings,
    files,
  };
  const messageCount = chats.reduce(
    (total, chat) => total + chat.messages.length,
    0
  );
  const manifest: ProjectExportManifest = binaryAssets
    ? {
        ...manifestCommon,
        formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
        include: {
          assets: true,
          chats: options.includeChats,
          documents: true,
          readable: true,
        },
        counts: {
          assetBytes: binaryAssets.totalBytes,
          assets: assetDescriptors.length,
          documents: project.documents.length,
          chats: chats.length,
          messages: messageCount,
        },
        assets: assetDescriptors,
      }
    : {
        ...manifestCommon,
        formatVersion: PROJECT_EXPORT_LEGACY_FORMAT_VERSION,
        include: {
          chats: options.includeChats,
          documents: true,
          readable: true,
        },
        counts: {
          documents: project.documents.length,
          chats: chats.length,
          messages: messageCount,
        },
      };

  entries.set("manifest.json", encodeJson(manifest));

  validateEntries(entries);
  const archive = Buffer.from(zipSync(Object.fromEntries(entries), { level: 6 }));
  if (archive.byteLength > PROJECT_EXPORT_LIMITS.maxArchiveBytes) {
    throwExportTooLarge();
  }

  return {
    archive,
    downloadFilename: createDownloadFilename(project.name),
    manifest,
  };
}

function createPortableChat(
  projectId: string,
  chat: ProjectExportChatRecord,
  formatVersion: ProjectExportFormatVersion
) {
  return {
    formatVersion,
    exportType: "project_chat",
    projectId,
    chat: {
      sourceId: chat.id,
      title: chat.title,
      mode: chat.mode,
      model: chat.model,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messages: chat.messages.map(toPortableMessage),
    },
  };
}

function toPortableMessage(message: ProjectExportMessageRecord) {
  const attachments = normalizeAttachmentMetadata(message.attachment);

  return {
    sourceId: message.id,
    role: toPortableRole(message.role),
    content: message.content,
    mode: message.mode,
    model: message.model,
    createdAt: message.createdAt.toISOString(),
    ...(attachments.length > 0 ? { attachments } : {}),
    ...(hasErrorFlag(message.metadata) ? { isError: true } : {}),
  };
}

function createDocumentPath(document: ProjectExportDocumentRecord, index: number) {
  const metadata = toPortableDocumentMetadata(document.metadata);
  const preferredName = metadata?.originalName || document.title;
  const safeName = sanitizeArchiveFilename(preferredName);
  const extension =
    document.source === "USER_PROVIDED"
      ? safeName.toLowerCase().endsWith(".md")
        ? ""
        : ".md"
      : hasFileExtension(safeName)
        ? ""
        : getDocumentExtension(document.mimeType, document.source);

  return `documents/${padSequence(index)}-${safeName}${extension}`;
}

function createFileManifest(entries: Map<string, Uint8Array>): ProjectExportFileManifestEntry[] {
  return Array.from(entries.entries()).map(([path, content]) => ({
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  }));
}

function validateBinaryAssetBundleForExport(
  project: ProjectExportSourceRecord,
  chats: ProjectExportChatRecord[],
  bundle: CollectedPortableBinaryAssets
): PortableBinaryAssetDescriptor[] {
  try {
    const descriptorPaths = new Set(
      bundle.assets.map((asset) => asset.file.path)
    );
    if (
      descriptorPaths.size !== bundle.assets.length ||
      bundle.entries.size !== bundle.assets.length ||
      !Number.isSafeInteger(bundle.totalBytes) ||
      bundle.totalBytes < 0 ||
      Array.from(bundle.entries.keys()).some(
        (path) => !descriptorPaths.has(path)
      )
    ) {
      throw new Error("Binary asset bundle entries are inconsistent.");
    }

    const validated = validatePortableBinaryAssets(
      bundle.assets,
      Object.fromEntries(bundle.entries)
    );
    const totalBytes = validated.reduce(
      (total, asset) => total + asset.bytes.byteLength,
      0
    );
    if (totalBytes !== bundle.totalBytes) {
      throw new Error("Binary asset bundle size is inconsistent.");
    }

    validateBinaryAssetRelations(project, chats, validated);

    return validated.map(({ bytes: _bytes, ...descriptor }) => descriptor);
  } catch {
    throwInvalidExportAssets();
  }
}

function validateBinaryAssetRelations(
  project: ProjectExportSourceRecord,
  chats: ProjectExportChatRecord[],
  assets: ValidatedPortableBinaryAsset[]
) {
  const documentsById = new Map<string, ProjectExportDocumentRecord>();
  for (const document of project.documents) {
    if (documentsById.has(document.id)) {
      throw new Error("Duplicate source document ID.");
    }
    documentsById.set(document.id, document);
  }

  const chatIds = new Set<string>();
  const messagesById = new Map<
    string,
    { attachments: PortableAttachmentMetadata[] }
  >();
  for (const chat of chats) {
    if (chatIds.has(chat.id)) throw new Error("Duplicate source chat ID.");
    chatIds.add(chat.id);

    for (const message of chat.messages) {
      if (messagesById.has(message.id)) {
        throw new Error("Duplicate source message ID.");
      }
      messagesById.set(message.id, {
        attachments: normalizeAttachmentMetadata(message.attachment),
      });
    }
  }

  for (const asset of assets) {
    if (asset.sourceProjectId !== project.id) {
      throw new Error("Binary asset belongs to another project.");
    }

    if (asset.binding.kind === "project_document_source") {
      const document = documentsById.get(asset.binding.sourceDocumentId);
      const metadata = document
        ? toPortableDocumentMetadata(document.metadata)
        : null;
      const originalName = metadata?.originalName || document?.title;
      if (
        !document ||
        originalName !== asset.originalName ||
        document.mimeType !== asset.mimeType
      ) {
        throw new Error("Binary document binding is inconsistent.");
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
      throw new Error("Binary message binding is inconsistent.");
    }
  }
}

function createExportWarnings(
  chats: ProjectExportChatRecord[],
  binaryAssets: CollectedPortableBinaryAssets | undefined,
  assets: PortableBinaryAssetDescriptor[]
) {
  if (!binaryAssets) {
    const warnings = [PRIVATE_ASSET_WARNING];
    if (hasChatAttachmentMetadata(chats)) {
      warnings.unshift(CHAT_ATTACHMENT_WARNING);
    }
    return warnings;
  }

  return hasUnboundChatAttachmentMetadata(chats, assets)
    ? [PARTIAL_CHAT_ATTACHMENT_WARNING]
    : [];
}

function hasUnboundChatAttachmentMetadata(
  chats: ProjectExportChatRecord[],
  assets: PortableBinaryAssetDescriptor[]
) {
  const includedBindings = new Set(
    assets.flatMap((asset) =>
      asset.binding.kind === "message_attachment"
        ? [
            `${asset.binding.sourceMessageId}:${asset.binding.ordinal}`,
          ]
        : []
    )
  );

  return chats.some((chat) =>
    chat.messages.some((message) =>
      normalizeAttachmentMetadata(message.attachment).some(
        (_attachment, ordinal) =>
          !includedBindings.has(`${message.id}:${ordinal}`)
      )
    )
  );
}

function validateSourceSemantics(
  project: ProjectExportSourceRecord,
  options: ProjectExportOptions
) {
  const chats = options.includeChats ? project.chats : [];
  const messageCount = chats.reduce(
    (total, chat) => total + chat.messages.length,
    0
  );

  if (
    project.documents.length > PROJECT_EXPORT_LIMITS.maxDocuments ||
    chats.length > PROJECT_EXPORT_LIMITS.maxChats ||
    messageCount > PROJECT_EXPORT_LIMITS.maxMessages ||
    chats.some(
      (chat) => chat.messages.length > PROJECT_EXPORT_LIMITS.maxMessagesPerChat
    )
  ) {
    throwExportTooLarge();
  }

  let totalTextChars =
    project.name.length +
    (project.description?.length || 0) +
    (project.instruction?.content.length || 0) +
    (project.projectMemory?.content.length || 0);

  for (const document of project.documents) {
    if (
      Buffer.byteLength(document.content, "utf8") >
      DATA_LIMITS.projectDocumentSourceBytes
    ) {
      throwExportTooLarge();
    }
    totalTextChars += document.title.length + document.content.length;
  }

  for (const chat of chats) {
    const chatContentBytes = chat.messages.reduce(
      (total, message) => total + Buffer.byteLength(message.content, "utf8"),
      0
    );
    if (chatContentBytes > DATA_LIMITS.chatMessageContentBytesPerChat) {
      throwExportTooLarge();
    }
    totalTextChars += chat.title.length;
    for (const message of chat.messages) {
      const attachments = normalizeAttachmentMetadata(message.attachment);
      if (
        message.content.length > PROJECT_EXPORT_LIMITS.maxMessageChars ||
        attachments.length > CHAT_ATTACHMENT_LIMITS.maxAttachments ||
        attachments.some(
          (attachment) =>
            attachment.name.length > CHAT_ATTACHMENT_LIMITS.maxNameChars ||
            attachment.mimeType.length > 120
        )
      ) {
        throwExportTooLarge();
      }
      totalTextChars += message.content.length;
    }
  }

  if (totalTextChars > PROJECT_EXPORT_LIMITS.maxTotalTextChars) {
    throwExportTooLarge();
  }
}

function validateEntries(entries: Map<string, Uint8Array>) {
  if (entries.size > PROJECT_EXPORT_LIMITS.maxEntries) {
    throwExportTooLarge();
  }

  let totalBytes = 0;
  for (const content of entries.values()) {
    if (content.byteLength > PROJECT_EXPORT_LIMITS.maxEntryBytes) {
      throwExportTooLarge();
    }

    totalBytes += content.byteLength;
    if (totalBytes > PROJECT_EXPORT_LIMITS.maxTotalEntryBytes) {
      throwExportTooLarge();
    }
  }
}

function throwExportTooLarge(): never {
  throw new AppError(
    "Project export is too large to package safely.",
    413,
    "PROJECT_EXPORT_TOO_LARGE"
  );
}

function throwInvalidExportAssets(): never {
  throw new AppError(
    "Project asset export data is incomplete or inconsistent.",
    503,
    "PROJECT_EXPORT_ASSET_DATA_INVALID"
  );
}

function formatProjectAsMarkdown(
  project: ProjectExportSourceRecord,
  documents: Array<{ title: string; file: { path: string } }>,
  chats: Array<{ title: string; readablePath: string; messageCount: number }>
) {
  const lines = [
    `# ${project.name}`,
    "",
    project.description || "_No project description._",
    "",
    `- Source Project ID: ${project.id}`,
    `- Created At: ${project.createdAt.toISOString()}`,
    `- Updated At: ${project.updatedAt.toISOString()}`,
  ];

  if (project.instruction) {
    lines.push("", "## Project Instructions", "", project.instruction.content);
  }

  if (project.projectMemory) {
    lines.push("", "## Project Memory", "", project.projectMemory.content);
  }

  lines.push("", "## Documents", "");
  if (documents.length === 0) {
    lines.push("_No project documents._");
  } else {
    for (const document of documents) {
      lines.push(`- [${document.title}](../${document.file.path})`);
    }
  }

  lines.push("", "## Chats", "");
  if (chats.length === 0) {
    lines.push("_No chats included in this export._");
  } else {
    for (const chat of chats) {
      lines.push(`- [${chat.title}](${chat.readablePath.replace("readable/", "")}) (${chat.messageCount} messages)`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatChatAsMarkdown(chat: ProjectExportChatRecord) {
  const lines = [
    `# ${chat.title}`,
    "",
    `- Source Chat ID: ${chat.id}`,
    `- Mode: ${chat.mode}`,
    `- Model: ${chat.model}`,
    `- Created At: ${chat.createdAt.toISOString()}`,
    `- Updated At: ${chat.updatedAt.toISOString()}`,
  ];

  for (const [index, message] of chat.messages.entries()) {
    const attachments = normalizeAttachmentMetadata(message.attachment);

    lines.push("", `## ${index + 1}. ${formatRole(message.role)}`, "");
    lines.push(`- Mode: ${message.mode}`);
    lines.push(`- Model: ${message.model || ""}`);
    lines.push(`- Created At: ${message.createdAt.toISOString()}`);

    for (const attachment of attachments) {
      lines.push(`- Attachment: ${attachment.name} (${attachment.mimeType || attachment.type})`);
    }

    lines.push("", message.content);
  }

  return `${lines.join("\n").trim()}\n`;
}

function normalizeAttachmentMetadata(value: unknown): PortableAttachmentMetadata[] {
  const values = Array.isArray(value) ? value : value ? [value] : [];

  return values.filter(isRecord).map((attachment) => ({
    type: attachment.type === "image" ? "image" : "file",
    name:
      typeof attachment.name === "string" && attachment.name.trim()
        ? attachment.name
        : "Attachment",
    mimeType: typeof attachment.mimeType === "string" ? attachment.mimeType : "",
  }));
}

function hasChatAttachmentMetadata(chats: ProjectExportChatRecord[]) {
  return chats.some((chat) =>
    chat.messages.some((message) => normalizeAttachmentMetadata(message.attachment).length > 0)
  );
}

function toPortableDocumentMetadata(metadata: unknown) {
  if (!isRecord(metadata)) return null;

  const originalName =
    typeof metadata.originalName === "string" && metadata.originalName.trim()
      ? metadata.originalName
      : undefined;
  const sizeBytes =
    typeof metadata.sizeBytes === "number" && Number.isFinite(metadata.sizeBytes)
      ? metadata.sizeBytes
      : undefined;

  if (!originalName && sizeBytes === undefined) return null;

  return {
    ...(originalName ? { originalName } : {}),
    ...(sizeBytes !== undefined ? { sizeBytes } : {}),
  };
}

function hasErrorFlag(metadata: unknown) {
  return isRecord(metadata) && metadata.isError === true;
}

function toPortableRole(role: ProjectExportMessageRecord["role"]) {
  if (role === ChatRole.ASSISTANT) return "assistant";
  if (role === ChatRole.SYSTEM) return "system";

  return "user";
}

function formatRole(role: ProjectExportMessageRecord["role"]) {
  if (role === ChatRole.ASSISTANT) return "Assistant";
  if (role === ChatRole.SYSTEM) return "System";

  return "User";
}

function createDownloadFilename(projectName: string) {
  const slug = projectName
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 80);

  return `${slug || "project"}-export.zip`;
}

function sanitizeArchiveFilename(value: string) {
  const basename = value.split(/[\\/]/).at(-1) || "document";
  const normalized = basename
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/^\.+/, "")
    .replace(/-+/g, "-")
    .slice(0, 120);

  return normalized || "document";
}

function getDocumentExtension(mimeType: string | null, source: ProjectExportDocumentRecord["source"]) {
  const extensions: Record<string, string> = {
    "application/javascript": ".js",
    "application/json": ".json",
    "application/typescript": ".ts",
    "text/css": ".css",
    "text/csv": ".csv",
    "text/html": ".html",
    "text/javascript": ".js",
    "text/markdown": ".md",
    "text/typescript": ".ts",
  };

  return (mimeType && extensions[mimeType]) || (source === "USER_PROVIDED" ? ".md" : ".txt");
}

function hasFileExtension(value: string) {
  return /\.[a-z0-9]{1,12}$/i.test(value);
}

function padSequence(index: number) {
  return String(index + 1).padStart(3, "0");
}

function encodeJson(value: unknown) {
  return strToU8(`${JSON.stringify(value, null, 2)}\n`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
