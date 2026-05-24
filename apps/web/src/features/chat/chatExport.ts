import { DEFAULT_MODE, DEFAULT_MODEL } from "./constants";
import {
  convertMarkdownTableToCsv,
  escapeCsvCell,
  formatChatAsMarkdown,
  markdownToPlainText,
  sanitizeChatForExport,
} from "./chatExportFormatters";
import { getMessageAttachments } from "./chatMessages";
import type { Chat, ChatMessage, ExportFormat } from "./types";

const ANSWER_TYPE = "qa-answer";
const CHAT_TYPE = "qa-chat";

export { parseImportedChatJson } from "./chatImport";

export function exportMarkdown(content: string) {
  downloadFile(content, `qa-answer-${createTimestamp()}.md`, "text/markdown");
}

export function exportText(content: string) {
  downloadFile(markdownToPlainText(content), `qa-answer-${createTimestamp()}.txt`, "text/plain");
}

export function exportCsvFromMarkdownTable(content: string) {
  const tableCsv = convertMarkdownTableToCsv(content);
  const csv = tableCsv || `content\n${escapeCsvCell(markdownToPlainText(content))}`;
  const filenamePrefix = tableCsv ? "qa-test-cases" : "qa-answer";

  downloadFile(csv, `${filenamePrefix}-${createTimestamp()}.csv`, "text/csv");
}

export function exportAnswerJson({ content, mode = DEFAULT_MODE }: { content: string; mode?: string }) {
  exportJson({
    type: ANSWER_TYPE,
    createdAt: new Date().toISOString(),
    mode,
    content,
    format: "markdown",
  });
}

export function exportChatJson(chat: Chat) {
  exportJson({
    type: CHAT_TYPE,
    exportedAt: new Date().toISOString(),
    chat: sanitizeChatForExport(chat),
  });
}

export function exportChatMarkdown(chat: Chat) {
  downloadFile(formatChatAsMarkdown(chat), `qa-chat-${createTimestamp()}.md`, "text/markdown");
}

export function exportChatText(chat: Chat) {
  downloadFile(
    markdownToPlainText(formatChatAsMarkdown(chat)),
    `qa-chat-${createTimestamp()}.txt`,
    "text/plain"
  );
}

export function exportChatCsv(chat: Chat) {
  const rows = [
    ["role", "mode", "model", "createdAt", "attachmentName", "attachmentType", "content"],
    ...chat.messages.map((message) => [
      message.role,
      message.mode || chat.mode || DEFAULT_MODE,
      message.model || chat.model || DEFAULT_MODEL,
      message.createdAt || "",
      getMessageAttachments(message)
        .map((attachment) => attachment.name)
        .join("; "),
      getMessageAttachments(message)
        .map((attachment) => attachment.type)
        .join("; "),
      markdownToPlainText(message.content || ""),
    ]),
  ];

  const csv = rows.map((row) => row.map(escapeCsvCell).join(",")).join("\n");

  downloadFile(csv, `qa-chat-${createTimestamp()}.csv`, "text/csv");
}

export function exportChatByFormat(chat: Chat, format: ExportFormat) {
  const exporters: Record<ExportFormat, (chatToExport: Chat) => void> = {
    csv: exportChatCsv,
    json: exportChatJson,
    md: exportChatMarkdown,
    txt: exportChatText,
  };

  exporters[format](chat);
}

export function exportAnswerByFormat(message: ChatMessage, format: ExportFormat) {
  const exporters: Record<ExportFormat, () => void> = {
    csv: () => exportCsvFromMarkdownTable(message.content),
    json: () => exportAnswerJson({ content: message.content, mode: message.mode }),
    md: () => exportMarkdown(message.content),
    txt: () => exportText(message.content),
  };

  exporters[format]();
}

function exportJson(payload: unknown) {
  const filePrefix =
    typeof payload === "object" && payload && (payload as { type?: string }).type === CHAT_TYPE
      ? "qa-chat"
      : "qa-answer";

  downloadFile(JSON.stringify(payload, null, 2), `${filePrefix}-${createTimestamp()}.json`, "application/json");
}

function downloadFile(content: string, filename: string, mimeType: string) {
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

function createTimestamp(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    pad(date.getHours()),
    pad(date.getMinutes()),
  ].join("-");
}
