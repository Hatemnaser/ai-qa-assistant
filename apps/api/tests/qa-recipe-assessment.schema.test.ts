import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  recipeAssessmentSchema,
  RECIPE_ASSESSMENT_EXAMPLES,
  RECIPE_ASSESSMENT_JSON_SCHEMA,
} from "../src/modules/qa-requests/qa-recipe-assessment.schema.ts";

describe("Recipe assessment output contract", () => {
  it("uses concrete examples that satisfy the authoritative local contract", () => {
    for (const example of RECIPE_ASSESSMENT_EXAMPLES) {
      assert.deepEqual(recipeAssessmentSchema.parse(example), example);
    }
  });

  it("requires an array at the provider boundary and only permits the two review statuses", () => {
    const schema = RECIPE_ASSESSMENT_JSON_SCHEMA;
    assert.equal(schema.type, "object");
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, ["status", "suggestions"]);
    assert.deepEqual(schema.properties.status.enum, ["PASSED", "SUGGESTIONS"]);
    assert.equal(schema.properties.suggestions.type, "array");
    assert.equal(schema.properties.suggestions.minItems, 0);
    assert.equal(Object.hasOwn(schema.properties.suggestions, "maxItems"), false);
    assert.equal(schema.properties.suggestions.items.additionalProperties, false);
    assert.deepEqual(schema.properties.suggestions.items.required, ["code", "severity", "message"]);
    assert.deepEqual(schema.properties.suggestions.items.properties.severity.enum, ["INFO", "WARNING", "BLOCKING"]);
  });

  it("keeps the 80-suggestion limit authoritative in local validation", () => {
    const suggestions = Array.from({ length: 80 }, (_, index) => ({
      code: `FINDING_${index}`,
      severity: "WARNING" as const,
      message: "A concrete finding.",
    }));
    const assessment = { status: "SUGGESTIONS", suggestions };
    assert.deepEqual(recipeAssessmentSchema.parse(assessment), assessment);

    const parsed = recipeAssessmentSchema.safeParse({
      ...assessment,
      suggestions: [...suggestions, { code: "FINDING_80", severity: "WARNING", message: "One finding too many." }],
    });
    assert.equal(parsed.success, false);
    if (!parsed.success) {
      assert.ok(parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path.join(".") === "suggestions"));
    }
  });

  it("never coerces a missing or non-array suggestions field into a passed review", () => {
    for (const suggestions of [undefined, null, "", "none", {}, 0, false]) {
      for (const status of ["PASSED", "SUGGESTIONS"]) {
        const parsed = recipeAssessmentSchema.safeParse({ status, suggestions });
        assert.equal(parsed.success, false);
        if (!parsed.success) {
          assert.ok(parsed.error.issues.some((issue) => issue.code === "invalid_type" && issue.path.join(".") === "suggestions"));
        }
      }
    }
  });

  it("retains cross-field invariants even when native output has valid field types", () => {
    assert.equal(recipeAssessmentSchema.safeParse({ status: "SUGGESTIONS", suggestions: [] }).success, false);
    assert.equal(recipeAssessmentSchema.safeParse({
      status: "PASSED", suggestions: [{ code: "FIX", severity: "WARNING", message: "A finding." }],
    }).success, false);
  });
});
