import { useI18n } from "../../i18n/useI18n";
import type {
  QaExecutionJob,
  QaExecutionRecipe,
  QaOperationReceipt,
  QaProfileManifest,
  QaRecipeLocator,
  QaRecipeStep,
  QaRunnerProfile,
} from "./types";

export function isQaHarnessPollingActive(
  operations: readonly QaOperationReceipt[],
  job?: QaExecutionJob | null
) {
  return operations.some(({ status }) => status === "PENDING" || status === "PROCESSING")
    || Boolean(job && ["QUEUED", "CLAIMED", "RUNNING"].includes(job.status));
}

export function qaExecutionStatusPresentation(job: QaExecutionJob | null | undefined) {
  if (!job) return null;

  const presentations = {
    CANCELLED: { label: "Cancelled", message: "This execution was cancelled. You can start a new QA Run.", tone: "neutral" },
    CLAIMED: { label: "Preflighting", message: "The Runner is validating the approved Recipe and local profile.", tone: "active" },
    FAILED: { label: "Execution failed", message: job.failureMessage || "The Runner could not complete this execution.", tone: "danger" },
    QUEUED: { label: "Queued", message: "Waiting for the selected Playwright Runner.", tone: "active" },
    RUNNING: {
      label: job.totalItems > 0 ? `Running ${job.completedItems}/${job.totalItems}` : "Running",
      message: "The Runner is recording results and required evidence.",
      tone: "active",
    },
    SUCCEEDED: { label: "Execution complete", message: "Results are ready for evidence checks and Human Review.", tone: "success" },
  } as const;

  return presentations[job.status];
}

export function qaRunnerProfilePresentation(profile: QaRunnerProfile) {
  if (profile.status === "ONLINE") return { label: "Online", tone: "success" } as const;
  if (profile.status === "INCOMPATIBLE") return { label: "Incompatible", tone: "warning" } as const;
  return { label: "Offline", tone: "neutral" } as const;
}

export function describeQaRecipeStep(step: QaRecipeStep) {
  if (step.action === "navigate") return `Open ${step.path || "the configured page"}`;
  if (step.action === "expect") {
    const target = "locator" in step.expectation ? describeLocator(step.expectation.locator) : "the page URL";
    const expectation = splitCamelCase(step.expectation.kind);
    const expected = "expected" in step.expectation ? ` “${step.expectation.expected}”` : "";
    return `Verify ${target} ${expectation}${expected}`;
  }
  const target = describeLocator(step.locator);
  if (step.action === "fill" || step.action === "select") {
    const value = step.action === "fill" ? step.value : step.option.value;
    return `${capitalize(step.action)} ${target} with ${describeValue(value)}`;
  }
  if (step.action === "press") return `Press ${step.key} on ${target}`;
  if (step.action === "check") return `${step.checked ? "Check" : "Uncheck"} ${target}`;
  return `${capitalize(step.action)} ${target}`;
}

export function qaRecipeCoverage(recipe: QaExecutionRecipe) {
  const items = recipe.bundle?.items || recipe.items;
  const steps = items.reduce((total, item) => total + item.steps.length, 0);
  return `${items.length} checklist item${items.length === 1 ? "" : "s"} · ${steps} action${steps === 1 ? "" : "s"}`;
}

export function qaRunnerProfileManifest(profile: QaRunnerProfile): QaProfileManifest {
  return {
    environmentKind: profile.environmentKind,
    evidenceKinds: profile.evidenceKinds,
    executorKey: "playwright",
    label: profile.label,
    ...(profile.manifestHash ? { manifestHash: profile.manifestHash } : {}),
    profileKey: profile.key,
    recipeSchemaVersions: [1],
    schemaVersion: 1,
    valueReferences: profile.valueRefs.map(({ name, secret }) => ({ key: name, secret })),
  };
}

export function qaRecipeCanRunOnProfile(recipe: QaExecutionRecipe, profile: QaRunnerProfile) {
  return profile.status === "ONLINE"
    && profile.supportedRecipeVersions.includes(recipe.schemaVersion)
    && Boolean(profile.manifestHash)
    && recipe.profileManifestHash === profile.manifestHash;
}

export function qaRecipeReviewState(
  recipe: QaExecutionRecipe | null,
  operations: readonly QaOperationReceipt[] = [],
  isRetrying = false
) {
  const assessment = recipe?.assessments[0] || null;
  const isPending = isRetrying || assessment?.status === "PENDING" || operations.some((operation) =>
    operation.kind === "EXECUTION_RECIPE_REVIEW"
    && operation.recipeId === recipe?.id
    && ["PENDING", "PROCESSING"].includes(operation.status)
  );
  return {
    assessment,
    canRetry: assessment?.status === "FAILED" && !isPending,
    isPending,
    isReviewed: !isPending && (assessment?.status === "PASSED" || assessment?.status === "SUGGESTIONS"),
  };
}

export function qaOperationGroups(operations: readonly QaOperationReceipt[]) {
  const current: QaOperationReceipt[] = [];
  const earlier: QaOperationReceipt[] = [];
  const seen = new Set<string>();
  // Receipts are newest-first from the API (and locally prepended on enqueue).
  // Completion time and retry availability are not creation order.
  for (const operation of operations) {
    const target = operation.kind === "EXECUTION_RECIPE_REVIEW"
      ? operation.recipeId
      : operation.kind === "CHECKLIST_GENERATION" ? operation.requestId : operation.artifactId;
    // Without the target, do not infer that a different operation replaced it.
    const artifact = operation.kind === "CHECKLIST_GENERATION" ? null : operation.artifactId || null;
    const key = target ? JSON.stringify([operation.requestId, operation.kind, artifact, target]) : null;
    const active = operation.status === "PENDING" || operation.status === "PROCESSING";
    if (!active && key && seen.has(key)) earlier.push(operation);
    else current.push(operation);
    if (key) seen.add(key);
  }
  return { current, earlier };
}

export function qaOperationPresentation(operation: QaOperationReceipt, isEarlier = false) {
  const { t } = useI18n();
  if (isEarlier) {
    return {
      message: operation.status === "FAILED" && operation.errorCode
        ? t("projects.qa.operations.earlierFailure", { code: operation.errorCode })
        : t("projects.qa.operations.earlierNote"),
      tone: "neutral",
    } as const;
  }
  if (operation.status === "FAILED") {
    if (operation.errorCode === "QA_RECIPE_OUTPUT_INVALID") {
      return { message: t("projects.qa.operations.recipeOutputInvalid"), tone: "danger" } as const;
    }
    if (operation.errorCode === "QA_RECIPE_REVIEW_INVALID") {
      return { message: t("projects.qa.operations.recipeReviewInvalid"), tone: "danger" } as const;
    }
    return {
      message: operation.errorCode
        ? t("projects.qa.operations.failedCode", { code: operation.errorCode })
        : t("projects.qa.operations.failed"),
      tone: "danger",
    } as const;
  }
  if (operation.status === "SUCCEEDED") {
    return { message: t("projects.qa.operations.succeeded"), tone: "success" } as const;
  }
  return {
    message: t(operation.status === "PENDING" ? "projects.qa.operations.pending" : "projects.qa.operations.processing"),
    tone: "active",
  } as const;
}

function describeLocator(locator: QaRecipeLocator) {
  const kind = locator.by === "testId" ? "test ID" : locator.by;
  if (locator.by === "role") return `${kind} ${locator.role} named “${locator.name}”`;
  return `${kind} “${locator.value}”`;
}

function describeValue(value: import("./types").QaRecipeValue) {
  return value.source === "profile" ? `profile value “${value.key}”` : `“${value.value}”`;
}

function splitCamelCase(value: string) {
  return value.replaceAll(/([A-Z])/g, " $1").toLowerCase();
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}
