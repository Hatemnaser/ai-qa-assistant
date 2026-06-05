export type MemoryScope = "USER" | "PROJECT" | "CHAT";
export type MemorySource = "USER_PROVIDED" | "AI_EXTRACTED" | "CHAT_SUMMARY" | "IMPORTED";

export interface Memory {
  id: string;
  projectId: string | null;
  scope: MemoryScope;
  content: string;
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  content: string;
}
