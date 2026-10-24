import { AppError } from "../../lib/errors.js";
import type { ConversationSummaryGenerationResult } from "./conversation-summary.types.js";

type SummaryUsage = NonNullable<ConversationSummaryGenerationResult["usage"]>;

/** A rejected summary can still carry confirmed provider consumption. */
export class ConversationSummaryGenerationError extends AppError {
  readonly usage?: SummaryUsage;

  constructor(error: AppError, usage?: SummaryUsage) {
    super(error.message, error.statusCode, error.code, error.expose);

    if (!usage) return;

    const values = [usage.inputTokens, usage.outputTokens, usage.totalTokens];

    if (
      values.some(
        (value) =>
          value !== undefined && (!Number.isSafeInteger(value) || value < 0)
      ) ||
      !values.some((value) => value !== undefined && value > 0)
    ) {
      return;
    }

    this.usage = {
      inputTokens: usage.inputTokens,
      outputTokens: usage.outputTokens,
      totalTokens: usage.totalTokens,
    };
  }
}
