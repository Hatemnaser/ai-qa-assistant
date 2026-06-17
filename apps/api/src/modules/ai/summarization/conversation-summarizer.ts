import type { ConversationSummarizer } from "../../conversation-summary/conversation-summary.types.js";
import { geminiConversationSummarizer } from "./gemini-conversation-summarizer.js";

const summarizers = new Map<string, ConversationSummarizer>([
  [geminiConversationSummarizer.provider, geminiConversationSummarizer],
]);

export function getConversationSummarizer(
  provider = geminiConversationSummarizer.provider
) {
  return summarizers.get(provider) || geminiConversationSummarizer;
}

export const conversationSummarizer = getConversationSummarizer();
