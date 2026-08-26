export type AiRole = "user" | "assistant";

export interface AiHistoryMessage {
  role?: AiRole;
  content: string;
  mode?: string;
  model?: string;
}
