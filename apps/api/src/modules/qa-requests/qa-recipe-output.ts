import { z } from "zod";

import { AppError } from "../../lib/errors.js";

type RecipeOutputStage = "generation" | "review";

// Paths must contain only known contract fields, never provider-supplied keys.
const SAFE_PATH_FIELDS = new Set([
  "title", "bundle", "schemaVersion", "engine", "items", "checklistItemId",
  "steps", "ref", "timeoutMs", "action", "path", "waitUntil", "locator",
  "by", "name", "role", "value", "source", "key", "option", "checked",
  "expectation", "kind", "expected", "exact", "index", "status",
  "suggestions", "code", "itemClientRef", "message", "proposedChange",
  "severity", "summary",
]);
const SAFE_ISSUE_CODES = new Set<string>(Object.values(z.ZodIssueCode));

export class QaRecipeOutputError extends AppError {
  readonly diagnostics: {
    stage: RecipeOutputStage;
    issues: Array<{ code: string; path: string }>;
  };

  constructor(stage: RecipeOutputStage, issues: readonly z.ZodIssue[] | "invalid_json") {
    super(
      stage === "generation"
        ? "The AI provider returned an invalid Execution Recipe."
        : "The AI provider returned an invalid Execution Recipe assessment.",
      502,
      stage === "generation" ? "QA_RECIPE_OUTPUT_INVALID" : "QA_RECIPE_REVIEW_INVALID",
      false
    );
    // Do not retain ZodError, issue messages, union errors, raw output, or causes.
    this.diagnostics = {
      stage,
      issues: issues === "invalid_json"
        ? [{ code: "invalid_json", path: "$" }]
        : issues.slice(0, 16).map((issue) => ({
          code: SAFE_ISSUE_CODES.has(issue.code) ? issue.code : "invalid_output",
          path: ["$", ...issue.path.slice(0, 12).map((part) => {
            if (typeof part === "number") {
              return Number.isInteger(part) && part >= 0 && part <= 10_000 ? String(part) : "*";
            }
            return SAFE_PATH_FIELDS.has(part) ? part : "*";
          })].join("."),
        })),
    };
  }
}
