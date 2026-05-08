import { DEFAULT_MODE, DEFAULT_MODEL, normalizeModel } from "./constants.js";

export function normalizeChat(chat, fallbackTitle = "New QA Chat") {
  return {
    ...chat,
    title: chat?.title || fallbackTitle,
    mode: chat?.mode || DEFAULT_MODE,
    model: normalizeModel(chat?.model),
    messages: Array.isArray(chat?.messages)
      ? chat.messages.map(normalizeMessage)
      : [],
  };
}

export function normalizeMessage(message) {
  if (!message || typeof message !== "object") {
    return {
      role: "assistant",
      content: "",
      mode: DEFAULT_MODE,
      model: DEFAULT_MODEL,
      createdAt: new Date().toISOString(),
    };
  }

  return {
    ...message,
    content: typeof message.content === "string" ? message.content : "",
    mode: message.mode || DEFAULT_MODE,
    model: normalizeModel(message.model),
  };
}

export function normalizeImportedMessage(message) {
  if (!message || typeof message !== "object" || Array.isArray(message)) {
    throw new Error("Invalid chat file. Every message must be an object.");
  }

  if (!["user", "assistant"].includes(message.role)) {
    throw new Error("Invalid chat file. Every message must have a user or assistant role.");
  }

  return {
    role: message.role,
    content: typeof message.content === "string" ? message.content : "",
    mode: typeof message.mode === "string" && message.mode.trim()
      ? message.mode
      : DEFAULT_MODE,
    model: normalizeModel(message.model),
    createdAt: isValidDate(message.createdAt)
      ? message.createdAt
      : new Date().toISOString(),
    ...(message.attachment
      ? { attachment: sanitizeAttachment(message.attachment) }
      : {}),
  };
}

export function sanitizeAttachment(attachment) {
  return {
    type: attachment.type || "file",
    name: attachment.name || "Attachment",
    mimeType: attachment.mimeType || attachment.type || "",
  };
}

export function isValidDate(value) {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}
