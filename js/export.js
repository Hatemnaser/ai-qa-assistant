import { DEFAULT_MODE, DEFAULT_MODEL, normalizeModel } from "./constants.js";
import {
  isValidDate,
  normalizeImportedMessage,
  sanitizeAttachment,
} from "./chatSchema.js";

const ANSWER_TYPE = "qa-answer";
const CHAT_TYPE = "qa-chat";

export function createTimestamp(date = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("-");
}

export function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], {
    type: `${mimeType};charset=utf-8`,
  });

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
}

export function exportMarkdown(content) {
  downloadFile(
    content,
    `qa-answer-${createTimestamp()}.md`,
    "text/markdown"
  );
}

export function exportText(content) {
  downloadFile(
    markdownToPlainText(content),
    `qa-answer-${createTimestamp()}.txt`,
    "text/plain"
  );
}

export function exportJson(payload) {
  const filePrefix = payload.type === CHAT_TYPE ? "qa-chat" : "qa-answer";

  downloadFile(
    JSON.stringify(payload, null, 2),
    `${filePrefix}-${createTimestamp()}.json`,
    "application/json"
  );
}

export function hasMarkdownTable(content) {
  return Boolean(findMarkdownTable(content));
}

export function convertMarkdownTableToCsv(content) {
  const table = findMarkdownTable(content);

  if (!table) return "";

  return table.rows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");
}

export function exportCsvFromMarkdownTable(content) {
  const tableCsv = convertMarkdownTableToCsv(content);
  const csv = tableCsv || `content\n${escapeCsvCell(markdownToPlainText(content))}`;
  const filenamePrefix = tableCsv ? "qa-test-cases" : "qa-answer";

  downloadFile(
    csv,
    `${filenamePrefix}-${createTimestamp()}.csv`,
    "text/csv"
  );
}

export function exportAnswerJson({ content, mode = DEFAULT_MODE }) {
  exportJson({
    type: ANSWER_TYPE,
    createdAt: new Date().toISOString(),
    mode,
    content,
    format: "markdown",
  });
}

export function exportChatJson(chat) {
  if (!chat) return;

  exportJson({
    type: CHAT_TYPE,
    exportedAt: new Date().toISOString(),
    chat: sanitizeChatForExport(chat),
  });
}

export function exportChatMarkdown(chat) {
  if (!chat) return;

  downloadFile(
    formatChatAsMarkdown(chat),
    `qa-chat-${createTimestamp()}.md`,
    "text/markdown"
  );
}

export function exportChatText(chat) {
  if (!chat) return;

  downloadFile(
    markdownToPlainText(formatChatAsMarkdown(chat)),
    `qa-chat-${createTimestamp()}.txt`,
    "text/plain"
  );
}

export function exportChatCsv(chat) {
  if (!chat) return;

  const rows = [
    [
      "role",
      "mode",
      "model",
      "createdAt",
      "attachmentName",
      "attachmentType",
      "content",
    ],
    ...getChatMessages(chat).map((message) => [
      message.role || "",
      message.mode || chat.mode || DEFAULT_MODE,
      message.model || chat.model || DEFAULT_MODEL,
      message.createdAt || "",
      message.attachment?.name || "",
      message.attachment?.type || "",
      markdownToPlainText(message.content || ""),
    ]),
  ];

  const csv = rows
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n");

  downloadFile(csv, `qa-chat-${createTimestamp()}.csv`, "text/csv");
}

export function parseImportedChatJson(rawJson) {
  let parsed;

  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error("Invalid JSON file. Please choose a valid exported chat JSON file.");
  }

  const chat = parsed?.type === CHAT_TYPE ? parsed.chat : parsed;

  if (!chat || typeof chat !== "object" || Array.isArray(chat)) {
    throw new Error("Invalid chat file. The JSON does not contain a chat object.");
  }

  if (!Array.isArray(chat.messages)) {
    throw new Error("Invalid chat file. The chat must include a messages array.");
  }

  return {
    id: chat.id || crypto.randomUUID(),
    title: typeof chat.title === "string" && chat.title.trim()
      ? chat.title.trim().slice(0, 50)
      : "Imported QA Chat",
    mode: typeof chat.mode === "string" && chat.mode.trim()
      ? chat.mode
      : DEFAULT_MODE,
    model: normalizeModel(chat.model),
    createdAt: isValidDate(chat.createdAt) ? chat.createdAt : new Date().toISOString(),
    updatedAt: isValidDate(chat.updatedAt) ? chat.updatedAt : new Date().toISOString(),
    messages: chat.messages.map(normalizeImportedMessage),
  };
}

function findMarkdownTable(content) {
  const lines = String(content || "").split(/\r?\n/);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index].trim();
    const separatorLine = lines[index + 1].trim();

    if (!isTableRow(headerLine) || !isSeparatorRow(separatorLine)) {
      continue;
    }

    const rows = [splitMarkdownRow(headerLine)];

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex].trim();

      if (!isTableRow(rowLine)) break;

      rows.push(splitMarkdownRow(rowLine));
    }

    if (rows.length > 1) {
      return { rows };
    }
  }

  return null;
}

function isTableRow(line) {
  return line.includes("|") && splitMarkdownRow(line).length > 1;
}

function isSeparatorRow(line) {
  if (!isTableRow(line)) return false;

  return splitMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownRow(line) {
  const placeholder = "\u0000PIPE\u0000";
  const normalizedLine = line.replace(/\\\|/g, placeholder);
  const trimmedLine = normalizedLine.replace(/^\|/, "").replace(/\|$/, "");

  return trimmedLine
    .split("|")
    .map((cell) => cell.replaceAll(placeholder, "|").trim());
}

function escapeCsvCell(cell) {
  const value = String(cell ?? "");

  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

function markdownToPlainText(content) {
  return String(content || "")
    .replace(/```[\s\S]*?```/g, (block) =>
      block.replace(/^```[^\n]*\n?/, "").replace(/```$/, "")
    )
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/^\s{0,3}[-*+]\s+/gm, "- ")
    .replace(/^\s{0,3}\d+\.\s+/gm, "")
    .replace(/[*_~]/g, "")
    .trim();
}

function formatChatAsMarkdown(chat) {
  const lines = [
    `# ${chat.title || "QA Chat"}`,
    "",
    `- Chat ID: ${chat.id || ""}`,
    `- Mode: ${chat.mode || DEFAULT_MODE}`,
    `- Model: ${chat.model || DEFAULT_MODEL}`,
    `- Created At: ${chat.createdAt || ""}`,
    `- Updated At: ${chat.updatedAt || ""}`,
    "",
  ];

  getChatMessages(chat).forEach((message, index) => {
    lines.push(`## ${index + 1}. ${formatRole(message.role)}`);
    lines.push("");
    lines.push(`- Mode: ${message.mode || chat.mode || DEFAULT_MODE}`);
    lines.push(`- Model: ${message.model || chat.model || DEFAULT_MODEL}`);
    lines.push(`- Created At: ${message.createdAt || ""}`);

    if (message.attachment) {
      lines.push(`- Attachment Name: ${message.attachment.name || ""}`);
      lines.push(`- Attachment Type: ${message.attachment.type || ""}`);
      lines.push(`- Attachment MIME Type: ${message.attachment.mimeType || ""}`);
    }

    lines.push("");
    lines.push(message.content || "");
    lines.push("");
  });

  return lines.join("\n").trim();
}

function getChatMessages(chat) {
  return Array.isArray(chat.messages) ? chat.messages : [];
}

function formatRole(role) {
  if (role === "assistant") return "Assistant";
  if (role === "user") return "User";

  return role || "Message";
}

function sanitizeChatForExport(chat) {
  return {
    id: chat.id,
    title: chat.title,
    mode: chat.mode || DEFAULT_MODE,
    model: chat.model || DEFAULT_MODEL,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: Array.isArray(chat.messages)
      ? chat.messages.map(sanitizeMessageForExport)
      : [],
  };
}

function sanitizeMessageForExport(message) {
  const sanitizedMessage = {
    role: message.role,
    content: message.content || "",
    mode: message.mode || DEFAULT_MODE,
    model: message.model || DEFAULT_MODEL,
    createdAt: message.createdAt,
  };

  if (message.attachment) {
    sanitizedMessage.attachment = sanitizeAttachment(message.attachment);
  }

  return sanitizedMessage;
}
