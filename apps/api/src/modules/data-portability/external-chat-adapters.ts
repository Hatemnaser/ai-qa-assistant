import { createHash } from "node:crypto";

import { AppError } from "../../lib/errors.js";
import { decodeSafeUtf8, readSafeZip } from "./safe-zip.js";
import {
  EXTERNAL_CHAT_IMPORT_LIMITS,
  type ExternalChatImportChat,
  type ExternalChatImportMessage,
  type ExternalChatProvider,
  type ExternalChatProviderSelection,
  type ValidatedExternalChatImport,
} from "./external-chat-import.types.js";

const INVALID_PACKAGE = {
  code: "EXTERNAL_CHAT_IMPORT_PACKAGE_INVALID",
  message: "External chat export is invalid or unsupported.",
};
const ATTACHMENT_WARNING =
  "Attachment references from the external service are not imported because original attachment file mapping is not supported yet.";
const BRANCH_WARNING =
  "One or more ChatGPT conversations did not expose an active branch; messages were imported in timestamp order.";
const UNSUPPORTED_MESSAGE_WARNING =
  "Some non-user/assistant or unsupported message content was skipped.";
const EMPTY_CONVERSATION_WARNING =
  "Some conversations without supported text messages were skipped.";
const MAX_TRACE_ID_CHARS = 240;
const MAX_MODEL_CHARS = 120;
const MAX_DATE_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function validateExternalChatImport(
  archive: Buffer,
  selection: ExternalChatProviderSelection
): ValidatedExternalChatImport {
  const entries = readSafeZip(
    archive,
    EXTERNAL_CHAT_IMPORT_LIMITS,
    INVALID_PACKAGE
  );
  const conversationEntries = Object.entries(entries).filter(([path]) =>
    /^conversations(?:-\d+)?\.json$/i.test(path.split("/").at(-1) || "")
  );

  if (conversationEntries.length === 0) {
    throwInvalidPackage();
  }

  const parsedFiles = conversationEntries.map(([path, content]) => ({
    path,
    value: parseJson(content),
  }));
  const provider =
    selection === "auto" ? detectProvider(parsedFiles.map((file) => file.value)) : selection;
  const warnings = new Set<string>();
  const chats =
    provider === "chatgpt"
      ? parseChatGptFiles(parsedFiles, warnings)
      : parseClaudeFiles(parsedFiles, warnings);

  validateImportedChats(chats);

  return {
    packageDigest: createHash("sha256").update(archive).digest("hex"),
    provider,
    chats,
    warnings: Array.from(warnings),
  };
}

function detectProvider(values: unknown[]): ExternalChatProvider {
  for (const value of values) {
    if (!Array.isArray(value)) continue;

    for (const item of value) {
      if (!isRecord(item)) continue;
      if (isRecord(item.mapping)) return "chatgpt";
      if (Array.isArray(item.chat_messages)) return "claude";
    }
  }

  throwInvalidPackage();
}

function parseChatGptFiles(
  files: Array<{ path: string; value: unknown }>,
  warnings: Set<string>
) {
  const chats: ExternalChatImportChat[] = [];

  for (const file of files) {
    if (!Array.isArray(file.value)) throwInvalidPackage();

    for (const [index, value] of file.value.entries()) {
      if (!isRecord(value) || !isRecord(value.mapping)) {
        throwInvalidPackage();
      }

      const messages = readChatGptMessages(value, warnings);
      if (messages.length === 0) {
        warnings.add(EMPTY_CONVERSATION_WARNING);
        continue;
      }

      const createdAt = toUnixDate(value.create_time);
      const updatedAt = toUnixDate(value.update_time);
      chats.push({
        sourceId: readTraceString(value.id) || `${file.path}:${index}`,
        title: normalizeTitle(value.title, "Imported ChatGPT conversation"),
        createdAt,
        updatedAt: updatedAt || createdAt,
        messages,
      });
    }
  }

  return chats;
}

function readChatGptMessages(
  conversation: Record<string, unknown>,
  warnings: Set<string>
) {
  const mapping = conversation.mapping as Record<string, unknown>;
  let nodes: Record<string, unknown>[] = [];
  const currentNode = readString(conversation.current_node);

  if (currentNode && mapping[currentNode]) {
    const visited = new Set<string>();
    let nodeId: string | null = currentNode;

    while (nodeId && !visited.has(nodeId)) {
      visited.add(nodeId);
      const node = mapping[nodeId];
      if (!isRecord(node)) break;
      nodes.unshift(node);
      nodeId = readString(node.parent);
    }
  } else {
    warnings.add(BRANCH_WARNING);
    nodes = Object.values(mapping)
      .filter(isRecord)
      .sort(
        (left, right) =>
          (toUnixDate(readMessageCreateTime(left))?.getTime() || 0) -
          (toUnixDate(readMessageCreateTime(right))?.getTime() || 0)
      );
  }

  const messages: ExternalChatImportMessage[] = [];
  for (const [index, node] of nodes.entries()) {
    const message = node.message;
    if (!isRecord(message) || !isRecord(message.author)) continue;

    const role = readString(message.author.role);
    if (role !== "user" && role !== "assistant") {
      warnings.add(UNSUPPORTED_MESSAGE_WARNING);
      continue;
    }

    const content = readChatGptContent(message.content, warnings);
    if (!content.trim()) {
      warnings.add(UNSUPPORTED_MESSAGE_WARNING);
      continue;
    }

    messages.push({
      sourceId:
        readTraceString(message.id) ||
        readTraceString(node.id) ||
        `message-${index + 1}`,
      role,
      content: normalizeMessageContent(content),
      createdAt: toUnixDate(message.create_time),
      originalModel: readOriginalModel(message.metadata),
    });
  }

  return messages;
}

function readChatGptContent(value: unknown, warnings: Set<string>) {
  if (!isRecord(value)) return "";

  const parts = Array.isArray(value.parts) ? value.parts : [];
  const textParts: string[] = [];

  for (const part of parts) {
    if (typeof part === "string") {
      textParts.push(part);
      continue;
    }

    if (isRecord(part) && typeof part.text === "string") {
      textParts.push(part.text);
      continue;
    }

    warnings.add(ATTACHMENT_WARNING);
  }

  if (textParts.length === 0 && typeof value.text === "string") {
    return value.text;
  }

  return textParts.join("\n");
}

function parseClaudeFiles(
  files: Array<{ path: string; value: unknown }>,
  warnings: Set<string>
) {
  const chats: ExternalChatImportChat[] = [];

  for (const file of files) {
    if (!Array.isArray(file.value)) throwInvalidPackage();

    for (const [index, value] of file.value.entries()) {
      if (!isRecord(value) || !Array.isArray(value.chat_messages)) {
        throwInvalidPackage();
      }

      const messages: ExternalChatImportMessage[] = [];
      for (const [messageIndex, rawMessage] of value.chat_messages.entries()) {
        if (!isRecord(rawMessage)) continue;

        const sender = readString(rawMessage.sender);
        const role =
          sender === "human"
            ? "user"
            : sender === "assistant"
              ? "assistant"
              : null;
        const content = readString(rawMessage.text);

        if (!role) {
          warnings.add(UNSUPPORTED_MESSAGE_WARNING);
          continue;
        }

        if (!content?.trim()) {
          warnings.add(UNSUPPORTED_MESSAGE_WARNING);
          continue;
        }

        if (
          (Array.isArray(rawMessage.attachments) &&
            rawMessage.attachments.length > 0) ||
          (Array.isArray(rawMessage.files) && rawMessage.files.length > 0)
        ) {
          warnings.add(ATTACHMENT_WARNING);
        }

        messages.push({
          sourceId:
            readTraceString(rawMessage.uuid) ||
            readTraceString(rawMessage.id) ||
            `message-${messageIndex + 1}`,
          role,
          content: normalizeMessageContent(content),
          createdAt: toIsoDate(rawMessage.created_at),
          originalModel: readTraceString(rawMessage.model, MAX_MODEL_CHARS),
        });
      }

      if (messages.length === 0) {
        warnings.add(EMPTY_CONVERSATION_WARNING);
        continue;
      }

      const createdAt = toIsoDate(value.created_at);
      const updatedAt = toIsoDate(value.updated_at);
      chats.push({
        sourceId:
          readTraceString(value.uuid) ||
          readTraceString(value.id) ||
          `${file.path}:${index}`,
        title: normalizeTitle(value.name || value.title, "Imported Claude conversation"),
        createdAt,
        updatedAt: updatedAt || createdAt,
        messages,
      });
    }
  }

  return chats;
}

function validateImportedChats(chats: ExternalChatImportChat[]) {
  const messageCount = chats.reduce(
    (total, chat) => total + chat.messages.length,
    0
  );

  if (
    chats.length === 0 ||
    chats.length > EXTERNAL_CHAT_IMPORT_LIMITS.maxChats ||
    messageCount > EXTERNAL_CHAT_IMPORT_LIMITS.maxMessages ||
    chats.some((chat) =>
      chat.messages.some(
        (message) =>
          message.content.length >
          EXTERNAL_CHAT_IMPORT_LIMITS.maxMessageChars
      )
    )
  ) {
    throwInvalidPackage();
  }
}

function parseJson(content: Uint8Array) {
  try {
    return JSON.parse(decodeSafeUtf8(content, INVALID_PACKAGE)) as unknown;
  } catch (error) {
    if (isAppError(error)) throw error;
    throwInvalidPackage();
  }
}

function readMessageCreateTime(node: Record<string, unknown>) {
  return isRecord(node.message) ? node.message.create_time : undefined;
}

function readOriginalModel(metadata: unknown) {
  if (!isRecord(metadata)) return null;

  return (
    readTraceString(metadata.model_slug, MAX_MODEL_CHARS) ||
    readTraceString(metadata.default_model_slug, MAX_MODEL_CHARS) ||
    null
  );
}

function normalizeTitle(value: unknown, fallback: string) {
  const title =
    readString(value)
      ?.normalize("NFKC")
      .replace(/[\u0000-\u001f\u007f]/g, " ")
      .replace(/\s+/g, " ")
      .trim() || fallback;

  return title.slice(0, 120);
}

function toUnixDate(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;

  const milliseconds = value > 10_000_000_000 ? value : value * 1_000;
  const date = new Date(milliseconds);

  return isPortableDate(date) ? date : null;
}

function toIsoDate(value: unknown) {
  if (typeof value !== "string" || !value) return null;

  const date = new Date(value);

  return isPortableDate(date) ? date : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function readTraceString(value: unknown, maxChars = MAX_TRACE_ID_CHARS) {
  const text = readString(value)
    ?.normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();

  return text ? text.slice(0, maxChars) : null;
}

function normalizeMessageContent(value: string) {
  return value.replace(/\u0000/g, "\uFFFD");
}

function isPortableDate(value: Date) {
  const timestamp = value.getTime();

  return Number.isFinite(timestamp) && timestamp >= 0 && timestamp <= MAX_DATE_MS;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isAppError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      (error as { code?: unknown }).code === INVALID_PACKAGE.code
  );
}

function throwInvalidPackage(): never {
  throw new AppError(
    INVALID_PACKAGE.message,
    400,
    INVALID_PACKAGE.code
  );
}
