import { AppError } from "../../lib/errors.js";

export type ExecutableQaEvidenceKind = "SCREENSHOT" | "TEXT";

export interface QaExecutionEvidenceRequirementLike {
  description: string;
  id: string;
  kind: string;
  required: boolean;
}

export interface QaExecutionChecklistItemLike {
  evidenceRequirements: QaExecutionEvidenceRequirementLike[];
  title: string;
}

export function selectExecutableEvidenceRequirements(
  requirements: QaExecutionEvidenceRequirementLike[],
  evidenceKinds: ExecutableQaEvidenceKind[]
) {
  const supported = new Set<string>(evidenceKinds);
  return requirements.filter(
    (requirement): requirement is QaExecutionEvidenceRequirementLike & {
      kind: ExecutableQaEvidenceKind;
    } => (requirement.kind === "TEXT" || requirement.kind === "SCREENSHOT")
      && supported.has(requirement.kind)
  );
}

export function validateExecutionEvidenceCompatibility(
  items: QaExecutionChecklistItemLike[],
  evidenceKinds: ExecutableQaEvidenceKind[]
) {
  const supported = new Set<string>(evidenceKinds);
  for (const item of items) {
    const requiredCounts = new Map<string, number>();
    for (const requirement of item.evidenceRequirements.filter(({ required }) => required)) {
      if (requirement.kind !== "TEXT" && requirement.kind !== "SCREENSHOT") {
        throw new AppError(
          `RecipeV1 cannot satisfy required ${requirement.kind} evidence for “${item.title}”.`,
          409,
          "QA_RECIPE_EVIDENCE_UNSUPPORTED"
        );
      }
      if (!supported.has(requirement.kind)) {
        throw new AppError(
          `The runner profile cannot capture required ${requirement.kind} evidence.`,
          409,
          "QA_RUNNER_EVIDENCE_UNSUPPORTED"
        );
      }
      requiredCounts.set(
        requirement.kind,
        (requiredCounts.get(requirement.kind) || 0) + 1
      );
      if ((requiredCounts.get(requirement.kind) || 0) > 1) {
        throw new AppError(
          `RecipeV1 supports at most one required ${requirement.kind} requirement per checklist item.`,
          409,
          "QA_RECIPE_EVIDENCE_AMBIGUOUS"
        );
      }
    }

    const executable = selectExecutableEvidenceRequirements(
      item.evidenceRequirements,
      evidenceKinds
    );
    if (executable.length === 0) {
      throw new AppError(
        `The runner profile cannot produce any accepted evidence for “${item.title}”.`,
        409,
        "QA_RECIPE_EVIDENCE_NOT_EXECUTABLE"
      );
    }
    if (executable.length > 2) {
      throw new AppError(
        `RecipeV1 supports at most two executable evidence requirements for “${item.title}”.`,
        409,
        "QA_RECIPE_EVIDENCE_LIMIT_EXCEEDED"
      );
    }
  }
}
