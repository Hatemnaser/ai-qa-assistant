import { ChatRole } from "../../generated/prisma/enums.js";
import type { AiHistoryMessage } from "../ai/ai.types.js";
import type { StoredMessageRecord } from "./chat-history.repository.js";

export const RECENT_COMPLETE_TURN_LIMIT = 4;

export interface CompleteStoredTurn {
  assistant: StoredMessageRecord;
  user: StoredMessageRecord;
}

export function selectCompleteStoredTurns(
  messages: StoredMessageRecord[]
): CompleteStoredTurn[] {
  const completeTurns: CompleteStoredTurn[] = [];

  for (let index = 0; index < messages.length - 1; index += 1) {
    const userMessage = messages[index];
    const assistantMessage = messages[index + 1];

    if (!userMessage || !assistantMessage) continue;

    if (
      !isUsableMessage(userMessage, ChatRole.USER) ||
      !isUsableMessage(assistantMessage, ChatRole.ASSISTANT) ||
      hasErrorFlag(assistantMessage.metadata)
    ) {
      continue;
    }

    completeTurns.push({
      assistant: assistantMessage,
      user: userMessage,
    });
    index += 1;
  }

  return completeTurns;
}

export function selectRecentCompleteTurns(
  messages: StoredMessageRecord[],
  maxTurns = RECENT_COMPLETE_TURN_LIMIT
): AiHistoryMessage[] {
  if (maxTurns <= 0) return [];

  return selectCompleteStoredTurns(messages)
    .slice(-maxTurns)
    .flatMap((turn) => [
      toAiHistoryMessage(turn.user),
      toAiHistoryMessage(turn.assistant),
    ]);
}

function isUsableMessage(
  message: StoredMessageRecord,
  role: (typeof ChatRole)[keyof typeof ChatRole]
) {
  return message.role === role && Boolean(message.content.trim());
}

function toAiHistoryMessage(message: StoredMessageRecord): AiHistoryMessage {
  return {
    content: message.content,
    mode: message.mode,
    model: message.model || undefined,
    role: message.role === ChatRole.ASSISTANT ? "assistant" : "user",
  };
}

function hasErrorFlag(metadata: unknown) {
  return Boolean(
    metadata &&
      typeof metadata === "object" &&
      !Array.isArray(metadata) &&
      "isError" in metadata &&
      (metadata as { isError?: unknown }).isError
  );
}
