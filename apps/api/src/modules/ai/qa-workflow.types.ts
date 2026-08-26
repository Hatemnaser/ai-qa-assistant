import type { AiHistoryMessage } from "./ai-message.types.js";

export type QaWorkflowIntent =
  | "bug_report"
  | "checklist"
  | "clarification"
  | "conversational"
  | "edge_cases"
  | "file_context"
  | "general_qa"
  | "language_preference"
  | "screenshot_review"
  | "test_cases"
  | "visual_context";

export type QaWorkflowLanguage = "arabic" | "english" | "mixed" | "unknown";
export type QaWorkflowSource = "ai_router" | "fallback" | "local_rule" | "selected_mode";

export interface QaWorkflowInput {
  hasTextAttachment?: boolean;
  history?: AiHistoryMessage[];
  hasImage?: boolean;
  message: string;
  mode: string;
}

export interface QaWorkflowAnalysis {
  confidence: number;
  effectiveMode: string;
  intent: QaWorkflowIntent;
  language: QaWorkflowLanguage;
  source: QaWorkflowSource;
  shouldUseArtifactTemplate: boolean;
  shouldAskClarifyingQuestion: boolean;
}
