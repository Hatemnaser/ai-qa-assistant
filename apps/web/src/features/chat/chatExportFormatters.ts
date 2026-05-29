import { DEFAULT_MODE, DEFAULT_MODEL } from "./constants";
import { getMessageAttachments } from "./chatMessages";
import type { Chat, ChatMessage } from "./types";

export function formatChatAsMarkdown(chat: Chat) {
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

  chat.messages.forEach((message, index) => {
    lines.push(`## ${index + 1}. ${formatRole(message.role)}`);
    lines.push("");
    lines.push(`- Mode: ${message.mode || chat.mode || DEFAULT_MODE}`);
    lines.push(`- Model: ${message.model || chat.model || DEFAULT_MODEL}`);
    lines.push(`- Created At: ${message.createdAt || ""}`);

    for (const attachment of getMessageAttachments(message)) {
      lines.push(`- Attachment Name: ${attachment.name || ""}`);
      lines.push(`- Attachment Type: ${attachment.type || ""}`);
      lines.push(`- Attachment MIME Type: ${attachment.mimeType || ""}`);
    }

    lines.push("");
    lines.push(message.content || "");
    lines.push("");
  });

  return lines.join("\n").trim();
}

export function markdownToPlainText(content: string) {
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

export function convertMarkdownTableToCsv(content: string) {
  const table = findMarkdownTable(content);

  if (!table) return "";

  return table.rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");
}

export function escapeCsvCell(cell: unknown) {
  const value = String(cell ?? "");

  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }

  return value;
}

export function sanitizeChatForExport(chat: Chat): Chat {
  return {
    id: chat.id,
    projectId: chat.projectId || null,
    title: chat.title,
    mode: chat.mode || DEFAULT_MODE,
    model: chat.model || DEFAULT_MODEL,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messages: chat.messages.map(sanitizeMessageForExport),
  };
}

function findMarkdownTable(content: string) {
  const lines = String(content || "").split(/\r?\n/);

  for (let index = 0; index < lines.length - 1; index += 1) {
    const headerLine = lines[index]?.trim() || "";
    const separatorLine = lines[index + 1]?.trim() || "";

    if (!isTableRow(headerLine) || !isSeparatorRow(separatorLine)) {
      continue;
    }

    const rows = [splitMarkdownRow(headerLine)];

    for (let rowIndex = index + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex]?.trim() || "";

      if (!isTableRow(rowLine)) break;

      rows.push(splitMarkdownRow(rowLine));
    }

    if (rows.length > 1) {
      return { rows };
    }
  }

  return null;
}

function isTableRow(line: string) {
  return line.includes("|") && splitMarkdownRow(line).length > 1;
}

function isSeparatorRow(line: string) {
  if (!isTableRow(line)) return false;

  return splitMarkdownRow(line).every((cell) => /^:?-{3,}:?$/.test(cell));
}

function splitMarkdownRow(line: string) {
  const placeholder = "\u0000PIPE\u0000";
  const normalizedLine = line.replace(/\\\|/g, placeholder);
  const trimmedLine = normalizedLine.replace(/^\|/, "").replace(/\|$/, "");

  return trimmedLine.split("|").map((cell) => cell.replaceAll(placeholder, "|").trim());
}

function formatRole(role: string) {
  if (role === "assistant") return "Assistant";
  if (role === "user") return "User";

  return role || "Message";
}

function sanitizeMessageForExport(message: ChatMessage): ChatMessage {
  const attachments = getMessageAttachments(message).map((attachment) => ({
    type: attachment.type,
    name: attachment.name || "Attachment",
    mimeType: attachment.mimeType || "",
  }));

  return {
    id: message.id,
    role: message.role,
    content: message.content || "",
    mode: message.mode || DEFAULT_MODE,
    model: message.model || DEFAULT_MODEL,
    createdAt: message.createdAt,
    ...(message.isError ? { isError: true } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}
