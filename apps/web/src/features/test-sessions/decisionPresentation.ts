export type SessionDecision = "loading" | "read-error" | "project" | "archived" | "working" | "proposal" | "recovery" | "checklist" | "approval" | "evidence" | "review" | "none";
export interface DecisionInput {
  loading: boolean; readError: boolean; hasProject: boolean; archived: boolean;
  working: boolean; proposal: boolean; recovery: boolean; canSelect: boolean;
  approvalAvailable: boolean; evidence: boolean; reviewAvailable: boolean;
}
/** Presentation precedence only. Authorization remains in the existing controller. */
export function sessionDecision(input: DecisionInput): SessionDecision {
  if (input.loading) return "loading";
  if (input.readError) return "read-error";
  if (!input.hasProject) return "project";
  if (input.archived) return "archived";
  if (input.working) return "working";
  if (input.proposal) return "proposal";
  if (input.recovery) return "recovery";
  if (input.canSelect) return "checklist";
  if (input.approvalAvailable) return "approval";
  if (input.evidence) return "evidence";
  if (input.reviewAvailable) return "review";
  return "none";
}
