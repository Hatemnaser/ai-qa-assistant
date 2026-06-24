import { createHash } from "node:crypto";

import { strToU8, zipSync } from "fflate";

import { ChatRole } from "../../generated/prisma/enums.js";
import {
  PROJECT_EXPORT_FORMAT_VERSION,
  type ProjectExportChatRecord,
  type ProjectExportDocumentRecord,
  type ProjectExportFileManifestEntry,
  type ProjectExportManifest,
  type ProjectExportMessageRecord,
  type ProjectExportOptions,
  type ProjectExportPackage,
  type ProjectExportSourceRecord,
} from "./data-portability.types.js";

const CHAT_ATTACHMENT_WARNING =
  "Chat attachment files are not included because chat file persistence is not implemented. Attachment metadata is included only.";

interface PortableAttachmentMetadata {
  type: "image" | "file";
  name: string;
  mimeType: string;
}

export function createProjectExportPackage(
  project: ProjectExportSourceRecord,
  options: ProjectExportOptions,
  exportedAt = new Date()
): ProjectExportPackage {
  const entries = new Map<string, Uint8Array>();
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
  const chats = options.includeChats ? project.chats : [];
  const chatReferences = chats.map((chat, index) => {
    const sequence = padSequence(index);
    const dataPath = `data/chats/chat-${sequence}.json`;
    const readablePath = `readable/chats/chat-${sequence}.md`;

    entries.set(dataPath, encodeJson(createPortableChat(project.id, chat)));
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
    formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
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

  const warnings = hasChatAttachmentMetadata(chats) ? [CHAT_ATTACHMENT_WARNING] : [];
  const files = createFileManifest(entries);
  const manifest: ProjectExportManifest = {
    formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
    exportType: "project",
    exportedAt: exportedAt.toISOString(),
    projectId: project.id,
    projectName: project.name,
    include: {
      chats: options.includeChats,
      documents: true,
      readable: true,
    },
    counts: {
      documents: project.documents.length,
      chats: chats.length,
      messages: chats.reduce((total, chat) => total + chat.messages.length, 0),
    },
    warnings,
    files,
  };

  entries.set("manifest.json", encodeJson(manifest));

  return {
    archive: Buffer.from(zipSync(Object.fromEntries(entries), { level: 6 })),
    downloadFilename: createDownloadFilename(project.name),
    manifest,
  };
}

function createPortableChat(projectId: string, chat: ProjectExportChatRecord) {
  return {
    formatVersion: PROJECT_EXPORT_FORMAT_VERSION,
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
