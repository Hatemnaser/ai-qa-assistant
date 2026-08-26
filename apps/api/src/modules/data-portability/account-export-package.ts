import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";

import { DATA_LIMITS } from "../../config/data-limits.js";
import { AppError } from "../../lib/errors.js";
import { ChatRole } from "../../generated/prisma/enums.js";
import { CHAT_ATTACHMENT_LIMITS } from "../chat/chat.attachments.js";
import {
  ACCOUNT_EXPORT_BINARY_FORMAT_VERSION,
  ACCOUNT_EXPORT_FORMAT_VERSION,
  ACCOUNT_EXPORT_LIMITS,
  type AccountExportFormatVersion,
  type AccountExportChatRecord,
  type AccountExportDocumentRecord,
  type AccountExportManifest,
  type AccountExportMessageRecord,
  type AccountExportPackage,
  type AccountExportProjectRecord,
  type AccountExportSourceRecord,
} from "./account-data-portability.types.js";
import {
  validatePortableBinaryAssets,
  type CollectedPortableBinaryAssets,
  type PortableBinaryAssetDescriptor,
} from "./binary-assets.js";

const ATTACHMENT_WARNING =
  "Chat attachment metadata is included, but original attachment files are not included in this archive.";
const PRIVATE_ASSET_WARNING =
  "Private object-storage binaries are not included in this export. They require a version 2 archive and an importer with atomic binary-asset restore support.";
const BINARY_ASSET_WARNING =
  "Private binary files are included in this archive. They can only be restored by an importer that supports the version 2 atomic binary-asset restore contract.";
const MIGRATION_WARNING =
  "The migration/conversations.json file is a provider-neutral reference file. External AI services may accept it as chat context, but it does not guarantee restoration of their native chat history or account settings.";

export function createAccountExportPackage(
  account: AccountExportSourceRecord,
  exportedAt = new Date(),
  binaryAssets?: CollectedPortableBinaryAssets
): AccountExportPackage {
  validateSourceSemantics(account);

  const formatVersion: AccountExportFormatVersion = binaryAssets
    ? ACCOUNT_EXPORT_BINARY_FORMAT_VERSION
    : ACCOUNT_EXPORT_FORMAT_VERSION;
  const portableBinaryAssets = binaryAssets
    ? validateExportBinaryAssets(account, binaryAssets)
    : [];

  const entries = new Map<string, Uint8Array>();
  const projectReferences = account.projects.map((project, index) =>
    addProjectEntries(entries, project, index, account.chats, formatVersion)
  );
  const chatReferences = account.chats.map((chat, index) =>
    addChatEntries(entries, chat, index, formatVersion)
  );

  const accountDocument = {
    formatVersion,
    exportType: "account",
    account: {
      sourceId: account.id,
      acceptedTermsAt: account.acceptedTermsAt?.toISOString() || null,
      acceptedTermsVersion: account.acceptedTermsVersion,
      email: account.email,
      name: account.name,
      locale: account.locale,
      createdAt: account.createdAt.toISOString(),
      updatedAt: account.updatedAt.toISOString(),
    },
    settings: account.settings
      ? {
          language: account.settings.language,
          theme: account.settings.theme,
          defaultModel: account.settings.defaultModel,
          createdAt: account.settings.createdAt.toISOString(),
          updatedAt: account.settings.updatedAt.toISOString(),
        }
      : null,
    accountMemories: account.memories.map((memory) => ({
      sourceId: memory.id,
      content: memory.content,
      source: memory.source,
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
    })),
    projects: projectReferences,
    chats: chatReferences,
    ...(binaryAssets ? { binaryAssets: portableBinaryAssets } : {}),
  };

  if (binaryAssets) {
    for (const [path, content] of binaryAssets.entries) {
      if (entries.has(path)) throwInvalidBinaryAssets();
      entries.set(path, content);
    }
  }

  entries.set("data/account.json", encodeJson(accountDocument));
  entries.set(
    "readable/account.md",
    strToU8(formatAccountAsMarkdown(account, projectReferences, chatReferences))
  );
  entries.set(
    "readable/account-memory.md",
    strToU8(formatMemoryAsMarkdown(account))
  );
  entries.set(
    "migration/conversations.json",
    encodeJson(createMigrationConversations(account.chats, formatVersion))
  );
  entries.set(
    "migration/account-memory.md",
    strToU8(formatMemoryForMigration(account))
  );
  entries.set("migration/README.md", strToU8(formatMigrationReadme()));

  validateEntries(entries);

  const warnings = [
    portableBinaryAssets.length > 0
      ? BINARY_ASSET_WARNING
      : PRIVATE_ASSET_WARNING,
    MIGRATION_WARNING,
  ];
  if (hasUnpackagedAttachmentMetadata(account.chats, portableBinaryAssets)) {
    warnings.unshift(ATTACHMENT_WARNING);
  }

  const manifest: AccountExportManifest = {
    formatVersion,
    exportType: "account",
    exportedAt: exportedAt.toISOString(),
    accountId: account.id,
    counts: {
      projects: account.projects.length,
      documents: account.projects.reduce(
        (total, project) => total + project.documents.length,
        0
      ),
      chats: account.chats.length,
      messages: account.chats.reduce(
        (total, chat) => total + chat.messages.length,
        0
      ),
      accountMemories: account.memories.length,
      ...(binaryAssets ? { binaryAssets: portableBinaryAssets.length } : {}),
    },
    contains: {
      canonicalJson: true,
      readableMarkdown: true,
      migrationReference: true,
      attachmentFiles: portableBinaryAssets.some(
        (asset) => asset.binding.kind === "message_attachment"
      ),
      ...(binaryAssets
        ? { privateAssetFiles: portableBinaryAssets.length > 0 }
        : {}),
      derivedData: false,
      secrets: false,
    },
    warnings,
    files: createFileManifest(entries),
  };

  entries.set("manifest.json", encodeJson(manifest));
  validateEntries(entries);

  const archive = Buffer.from(
    zipSync(Object.fromEntries(entries), {
      level: 6,
    })
  );

  if (archive.byteLength > ACCOUNT_EXPORT_LIMITS.maxArchiveBytes) {
    throwExportTooLarge();
  }

  return {
    archive,
    downloadFilename: "account-data-export.zip",
    manifest,
  };
}

function addProjectEntries(
  entries: Map<string, Uint8Array>,
  project: AccountExportProjectRecord,
  projectIndex: number,
  chats: AccountExportChatRecord[],
  formatVersion: AccountExportFormatVersion
) {
  const sequence = padSequence(projectIndex);
  const documentReferences = project.documents.map((document, documentIndex) => {
    const path = createDocumentPath(document, projectIndex, documentIndex);

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
  const projectChats = chats
    .filter((chat) => chat.projectId === project.id)
    .map((chat) => chat.id);
  const dataPath = `data/projects/project-${sequence}.json`;
  const readablePath = `readable/projects/project-${sequence}.md`;

  entries.set(
    dataPath,
    encodeJson({
      formatVersion,
      exportType: "account_project",
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
        chatSourceIds: projectChats,
      },
    })
  );
  entries.set(
    readablePath,
    strToU8(formatProjectAsMarkdown(project, documentReferences, projectChats.length))
  );

  return {
    sourceId: project.id,
    name: project.name,
    dataPath,
    readablePath,
    documentCount: project.documents.length,
    chatCount: projectChats.length,
  };
}

function addChatEntries(
  entries: Map<string, Uint8Array>,
  chat: AccountExportChatRecord,
  index: number,
  formatVersion: AccountExportFormatVersion
) {
  const sequence = padSequence(index);
  const dataPath = `data/chats/chat-${sequence}.json`;
  const readablePath = `readable/chats/chat-${sequence}.md`;

  entries.set(
    dataPath,
    encodeJson({
      formatVersion,
      exportType: "account_chat",
      chat: {
        sourceId: chat.id,
        sourceProjectId: chat.projectId,
        title: chat.title,
        mode: chat.mode,
        model: chat.model,
        createdAt: chat.createdAt.toISOString(),
        updatedAt: chat.updatedAt.toISOString(),
        messages: chat.messages.map(toPortableMessage),
      },
    })
  );
  entries.set(readablePath, strToU8(formatChatAsMarkdown(chat)));

  return {
    sourceId: chat.id,
    sourceProjectId: chat.projectId,
    title: chat.title,
    dataPath,
    readablePath,
    messageCount: chat.messages.length,
  };
}

function toPortableMessage(message: AccountExportMessageRecord) {
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

function createMigrationConversations(
  chats: AccountExportChatRecord[],
  formatVersion: AccountExportFormatVersion
) {
  return {
    formatVersion,
    exportType: "conversation_reference",
    conversations: chats.map((chat) => ({
      title: chat.title,
      createdAt: chat.createdAt.toISOString(),
      updatedAt: chat.updatedAt.toISOString(),
      messages: chat.messages.map((message) => ({
        role: toPortableRole(message.role),
        content: message.content,
        createdAt: message.createdAt.toISOString(),
      })),
    })),
  };
}

function formatAccountAsMarkdown(
  account: AccountExportSourceRecord,
  projects: Array<{
    name: string;
    readablePath: string;
    documentCount: number;
    chatCount: number;
  }>,
  chats: Array<{
    title: string;
    readablePath: string;
    messageCount: number;
  }>
) {
  const lines = [
    "# Account Data Export",
    "",
    `- Name: ${account.name || ""}`,
    `- Email: ${account.email}`,
    `- Locale: ${account.locale}`,
    `- Accepted Terms Version: ${account.acceptedTermsVersion || ""}`,
    `- Accepted Terms At: ${account.acceptedTermsAt?.toISOString() || ""}`,
    `- Created At: ${account.createdAt.toISOString()}`,
    `- Projects: ${projects.length}`,
    `- Chats: ${chats.length}`,
    `- Account Memories: ${account.memories.length}`,
    "",
    "## Projects",
    "",
  ];

  if (projects.length === 0) {
    lines.push("_No projects._");
  } else {
    for (const project of projects) {
      lines.push(
        `- [${project.name}](${project.readablePath.replace("readable/", "")}) (${project.documentCount} documents, ${project.chatCount} chats)`
      );
    }
  }

  lines.push("", "## Chats", "");
  if (chats.length === 0) {
    lines.push("_No chats._");
  } else {
    for (const chat of chats) {
      lines.push(
        `- [${chat.title}](${chat.readablePath.replace("readable/", "")}) (${chat.messageCount} messages)`
      );
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatProjectAsMarkdown(
  project: AccountExportProjectRecord,
  documents: Array<{ title: string; file: { path: string } }>,
  chatCount: number
) {
  const lines = [
    `# ${project.name}`,
    "",
    project.description || "_No project description._",
    "",
    `- Created At: ${project.createdAt.toISOString()}`,
    `- Updated At: ${project.updatedAt.toISOString()}`,
    `- Chats: ${chatCount}`,
  ];

  if (project.instruction) {
    lines.push("", "## Instructions", "", project.instruction.content);
  }

  if (project.projectMemory) {
    lines.push("", "## Project Memory", "", project.projectMemory.content);
  }

  lines.push("", "## Documents", "");
  if (documents.length === 0) {
    lines.push("_No project documents._");
  } else {
    for (const document of documents) {
      lines.push(`- [${document.title}](../../${document.file.path})`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatChatAsMarkdown(chat: AccountExportChatRecord) {
  const lines = [
    `# ${chat.title}`,
    "",
    `- Created At: ${chat.createdAt.toISOString()}`,
    `- Updated At: ${chat.updatedAt.toISOString()}`,
  ];

  for (const [index, message] of chat.messages.entries()) {
    lines.push(
      "",
      `## ${index + 1}. ${formatRole(message.role)}`,
      "",
      message.content
    );
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatMemoryAsMarkdown(account: AccountExportSourceRecord) {
  const lines = ["# Account Memory", ""];

  if (account.memories.length === 0) {
    lines.push("_No Account Memory records._");
  } else {
    for (const memory of account.memories) {
      lines.push(`- ${memory.content}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatMemoryForMigration(account: AccountExportSourceRecord) {
  const lines = [
    "# Personal context for another AI assistant",
    "",
    "The following entries were explicitly saved in Account Memory.",
    "",
  ];

  if (account.memories.length === 0) {
    lines.push("_No saved Account Memory records._");
  } else {
    for (const memory of account.memories) {
      lines.push(`- ${memory.content}`);
    }
  }

  return `${lines.join("\n").trim()}\n`;
}

function formatMigrationReadme() {
  return `# Moving this data to another AI service

This folder contains provider-neutral reference files, not a native account restore.

## ChatGPT

Start a new chat and upload \`conversations.json\` as reference context. ChatGPT does not recreate the original sidebar, separate chats, settings, memories, subscriptions, or workspaces from this file.

## Claude

Use \`conversations.json\` or the readable Markdown files as reference attachments. Claude does not support importing an exported archive into another personal account as native history.

## Gemini

Gemini documents native chat-history import for original ChatGPT and Claude export ZIP files in supported regions. This application's custom ZIP is not claimed to be a Gemini-native import package.

## Memory

\`account-memory.md\` contains explicitly saved Account Memory in a readable form for reviewed copy/paste into another service.
`;
}

function createDocumentPath(
  document: AccountExportDocumentRecord,
  projectIndex: number,
  documentIndex: number
) {
  const metadata = toPortableDocumentMetadata(document.metadata);
  const preferredName = metadata?.originalName || document.title;
  const safeName = sanitizeArchiveFilename(preferredName);
  const extension = hasFileExtension(safeName)
    ? ""
    : getDocumentExtension(document.mimeType);

  return `documents/project-${padSequence(projectIndex)}/${padSequence(documentIndex)}-${safeName}${extension}`;
}

function createFileManifest(entries: Map<string, Uint8Array>) {
  return Array.from(entries.entries()).map(([path, content]) => ({
    path,
    sha256: createHash("sha256").update(content).digest("hex"),
    sizeBytes: content.byteLength,
  }));
}

function validateEntries(entries: Map<string, Uint8Array>) {
  if (entries.size > ACCOUNT_EXPORT_LIMITS.maxEntries) {
    throwExportTooLarge();
  }

  let totalBytes = 0;
  for (const content of entries.values()) {
    if (content.byteLength > ACCOUNT_EXPORT_LIMITS.maxEntryBytes) {
      throwExportTooLarge();
    }

    totalBytes += content.byteLength;
    if (totalBytes > ACCOUNT_EXPORT_LIMITS.maxTotalEntryBytes) {
      throwExportTooLarge();
    }
  }
}

function validateExportBinaryAssets(
  account: AccountExportSourceRecord,
  collected: CollectedPortableBinaryAssets
): PortableBinaryAssetDescriptor[] {
  let validated;
  try {
    validated = validatePortableBinaryAssets(
      collected.assets,
      Object.fromEntries(collected.entries)
    );
  } catch {
    throwInvalidBinaryAssets();
  }

  const descriptorPaths = new Set(
    validated.map((asset) => asset.file.path)
  );
  const entryPaths = Array.from(collected.entries.keys());
  const actualTotalBytes = Array.from(collected.entries.values()).reduce(
    (total, content) => total + content.byteLength,
    0
  );
  if (
    descriptorPaths.size !== validated.length ||
    entryPaths.length !== descriptorPaths.size ||
    entryPaths.some((path) => !descriptorPaths.has(path)) ||
    collected.totalBytes !== actualTotalBytes
  ) {
    throwInvalidBinaryAssets();
  }

  const messages = new Map<
    string,
    { attachments: ReturnType<typeof normalizeAttachmentMetadata>; projectId: string | null }
  >();
  for (const chat of account.chats) {
    for (const message of chat.messages) {
      if (messages.has(message.id)) throwInvalidBinaryAssets();
      messages.set(message.id, {
        attachments: normalizeAttachmentMetadata(message.attachment),
        projectId: chat.projectId,
      });
    }
  }

  const documents = new Map<
    string,
    {
      mimeType: string | null;
      originalName: string;
      projectId: string;
    }
  >();
  for (const project of account.projects) {
    for (const document of project.documents) {
      if (documents.has(document.id)) throwInvalidBinaryAssets();
      documents.set(document.id, {
        mimeType: document.mimeType,
        originalName:
          toPortableDocumentMetadata(document.metadata)?.originalName ||
          document.title,
        projectId: project.id,
      });
    }
  }

  for (const asset of validated) {
    if (asset.binding.kind === "message_attachment") {
      const message = messages.get(asset.binding.sourceMessageId);
      const attachment = message?.attachments[asset.binding.ordinal];
      if (
        !message ||
        !attachment ||
        message.projectId !== asset.sourceProjectId ||
        attachment.name !== asset.originalName ||
        attachment.mimeType !== asset.mimeType ||
        attachment.type !==
          (asset.mimeType.startsWith("image/") ? "image" : "file")
      ) {
        throwInvalidBinaryAssets();
      }
      continue;
    }

    const document = documents.get(asset.binding.sourceDocumentId);
    if (
      !document ||
      document.projectId !== asset.sourceProjectId ||
      document.mimeType !== asset.mimeType ||
      document.originalName !== asset.originalName
    ) {
      throwInvalidBinaryAssets();
    }
  }

  return validated.map(({ bytes: _bytes, ...descriptor }) => descriptor);
}

function validateSourceSemantics(account: AccountExportSourceRecord) {
  const documentCount = account.projects.reduce(
    (total, project) => total + project.documents.length,
    0
  );
  const messageCount = account.chats.reduce(
    (total, chat) => total + chat.messages.length,
    0
  );

  if (
    account.projects.length > ACCOUNT_EXPORT_LIMITS.maxProjects ||
    documentCount > ACCOUNT_EXPORT_LIMITS.maxDocuments ||
    account.chats.length > ACCOUNT_EXPORT_LIMITS.maxChats ||
    messageCount > ACCOUNT_EXPORT_LIMITS.maxMessages ||
    account.memories.length > ACCOUNT_EXPORT_LIMITS.maxAccountMemories ||
    account.projects.some(
      (project) => project.documents.length > DATA_LIMITS.documentsPerProject
    ) ||
    account.chats.some(
      (chat) => chat.messages.length > ACCOUNT_EXPORT_LIMITS.maxMessagesPerChat
    )
  ) {
    throwExportTooLarge();
  }

  let totalTextChars = account.memories.reduce(
    (total, memory) => total + memory.content.length,
    0
  );

  for (const project of account.projects) {
    totalTextChars += project.name.length + (project.description?.length || 0);
    totalTextChars += project.instruction?.content.length || 0;
    totalTextChars += project.projectMemory?.content.length || 0;

    for (const document of project.documents) {
      if (
        Buffer.byteLength(document.content, "utf8") >
        ACCOUNT_EXPORT_LIMITS.maxDocumentBytes
      ) {
        throwExportTooLarge();
      }
      totalTextChars += document.title.length + document.content.length;
    }
  }

  for (const chat of account.chats) {
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
        message.content.length > ACCOUNT_EXPORT_LIMITS.maxMessageChars ||
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

  if (totalTextChars > ACCOUNT_EXPORT_LIMITS.maxTotalTextChars) {
    throwExportTooLarge();
  }
}

function throwExportTooLarge(): never {
  throw new AppError(
    "Account data export is too large to package safely.",
    413,
    "ACCOUNT_EXPORT_TOO_LARGE"
  );
}

function throwInvalidBinaryAssets(): never {
  throw new AppError(
    "Private binary assets could not be added to the account export safely.",
    500,
    "ACCOUNT_EXPORT_BINARY_ASSETS_INVALID"
  );
}

function normalizeAttachmentMetadata(value: unknown) {
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

function hasAttachmentMetadata(chats: AccountExportChatRecord[]) {
  return chats.some((chat) =>
    chat.messages.some(
      (message) => normalizeAttachmentMetadata(message.attachment).length > 0
    )
  );
}

function hasUnpackagedAttachmentMetadata(
  chats: AccountExportChatRecord[],
  binaryAssets: PortableBinaryAssetDescriptor[]
) {
  if (!hasAttachmentMetadata(chats)) return false;
  const packagedBindings = new Set(
    binaryAssets.flatMap((asset) =>
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
          !packagedBindings.has(`${message.id}:${ordinal}`)
      )
    )
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

function toPortableRole(role: ChatRole) {
  if (role === ChatRole.ASSISTANT) return "assistant";
  if (role === ChatRole.SYSTEM) return "system";

  return "user";
}

function formatRole(role: ChatRole) {
  if (role === ChatRole.ASSISTANT) return "Assistant";
  if (role === ChatRole.SYSTEM) return "System";

  return "User";
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

function getDocumentExtension(mimeType: string | null) {
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

  return (mimeType && extensions[mimeType]) || ".txt";
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
