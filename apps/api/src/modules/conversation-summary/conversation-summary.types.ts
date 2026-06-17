export interface ConversationSummaryDto {
  chatId: string;
  createdAt: string;
  id: string;
  openQuestions: string[];
  summary: string;
  throughMessageId: string | null;
  updatedAt: string;
}

export interface SaveConversationSummaryInput {
  openQuestions?: string[];
  summary: string;
  throughMessageId?: string | null;
}

export interface ConversationSummaryGenerationTurn {
  assistant: string;
  assistantMessageId: string;
  user: string;
  userMessageId: string;
}

export interface ConversationSummaryGenerationInput {
  existingOpenQuestions: string[];
  existingSummary?: string;
  turns: ConversationSummaryGenerationTurn[];
}

export interface ConversationSummaryGenerationResult {
  model: string;
  openQuestions?: string[];
  provider: string;
  summary: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
}

export interface ConversationSummarizer {
  generate(
    input: ConversationSummaryGenerationInput
  ): Promise<ConversationSummaryGenerationResult>;
  model: string;
  provider: string;
}
