import { z } from "zod";

const assessmentStatuses = ["PASSED", "SUGGESTIONS"] as const;
const suggestionSeverities = ["INFO", "WARNING", "BLOCKING"] as const;

export const recipeAssessmentSchema = z.object({
  status: z.enum(assessmentStatuses),
  suggestions: z.array(z.object({
    code: z.string().trim().min(1).max(120),
    itemClientRef: z.string().trim().max(120).optional(),
    message: z.string().trim().min(1).max(2_000),
    proposedChange: z.string().trim().max(4_000).optional(),
    severity: z.enum(suggestionSeverities),
  }).strict()).max(80),
  summary: z.string().trim().max(4_000).optional(),
}).strict().superRefine((value, context) => {
  if (value.status === "PASSED" && value.suggestions.length > 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A passed assessment cannot contain suggestions.",
      path: ["suggestions"],
    });
  }
  if (value.status === "SUGGESTIONS" && value.suggestions.length === 0) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A suggestions assessment requires at least one suggestion.",
      path: ["suggestions"],
    });
  }
});

// Native structured output prevents absent/null/object suggestions at the
// provider boundary. Do not send the array's maxItems to the provider: a
// live Gemini 3.1 Flash-Lite comparison rejected maxItems: 80 with HTTP 400
// and accepted the same schema without it. Local Zod validation above still
// enforces the 80-finding limit, string bounds, and status invariants.
export const RECIPE_ASSESSMENT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["status", "suggestions"],
  properties: {
    status: { type: "string", enum: [...assessmentStatuses] },
    summary: { type: "string", description: "Optional assessment summary, at most 4000 characters." },
    suggestions: {
      type: "array",
      minItems: 0,
      description: "Always a JSON array. Use [] for PASSED; 1-80 concrete suggestions for SUGGESTIONS. Never null, a string, or an object.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "severity", "message"],
        properties: {
          code: { type: "string", description: "Nonempty stable code, at most 120 characters." },
          severity: { type: "string", enum: [...suggestionSeverities] },
          message: { type: "string", description: "Nonempty finding, at most 2000 characters." },
          itemClientRef: { type: "string", description: "Optional checklist clientRef, at most 120 characters." },
          proposedChange: { type: "string", description: "Optional change, at most 4000 characters." },
        },
      },
    },
  },
};

export const RECIPE_ASSESSMENT_EXAMPLES = [
  { status: "PASSED", suggestions: [], summary: "The Recipe matches the checklist and public profile." },
  {
    status: "SUGGESTIONS",
    suggestions: [{
      code: "ASSERTION_TOO_VAGUE",
      severity: "WARNING",
      itemClientRef: "example-check-ref",
      message: "The assertion does not establish the expected result.",
      proposedChange: "Assert the specific observable result required by this checklist item.",
    }],
    summary: "Review the suggested assertion improvement before approving execution.",
  },
] satisfies Array<z.infer<typeof recipeAssessmentSchema>>;
