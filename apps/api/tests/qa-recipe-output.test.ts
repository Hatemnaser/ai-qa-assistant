import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { z } from "zod";
import {
  recipeBundleV1Schema,
  recipeLocatorV1Schema,
  recipeStepV1Schema,
  recipeValueV1Schema,
} from "@oddpath/qa-execution-contract";

import {
  RECIPE_LOCATOR_EXAMPLES,
  RECIPE_OUTPUT_EXAMPLE,
  RECIPE_STEP_EXAMPLES,
  RECIPE_VALUE_EXAMPLES,
} from "../src/modules/qa-requests/qa-execution-recipe.prompt.ts";
import { QaRecipeOutputError } from "../src/modules/qa-requests/qa-recipe-output.ts";

describe("Recipe prompt contract examples", () => {
  it("validates all examples against the canonical API/Runner schemas", () => {
    recipeBundleV1Schema.parse(RECIPE_OUTPUT_EXAMPLE.bundle);
    RECIPE_STEP_EXAMPLES.forEach((step) => recipeStepV1Schema.parse(step));
    RECIPE_LOCATOR_EXAMPLES.forEach((locator) => recipeLocatorV1Schema.parse(locator));
    RECIPE_VALUE_EXAMPLES.forEach((value) => recipeValueV1Schema.parse(value));
  });

  it("documents every action, locator, and value discriminator in the shared contract", () => {
    assert.deepEqual(
      new Set(RECIPE_STEP_EXAMPLES.map(({ action }) => action)),
      new Set(recipeStepV1Schema.options.map((option) => option.shape.action.value))
    );
    assert.deepEqual(
      new Set(RECIPE_LOCATOR_EXAMPLES.map(({ by }) => by)),
      new Set(recipeLocatorV1Schema.options.map((option) => option.shape.by.value))
    );
    assert.deepEqual(
      new Set(RECIPE_VALUE_EXAMPLES.map(({ source }) => source)),
      new Set(recipeValueV1Schema.options.map((option) => option.shape.source.value))
    );
    assert.deepEqual(
      new Set(RECIPE_STEP_EXAMPLES.flatMap((step) => step.action === "expect" ? [step.expectation.kind] : [])),
      new Set([
        "visible", "hidden", "enabled", "disabled", "checked", "unchecked",
        "textEquals", "textContains", "valueEquals", "countEquals", "urlPathEquals", "urlPathContains",
      ])
    );
  });
});

describe("Recipe output diagnostics", () => {
  it("keeps trusted field paths but discards issue messages, arbitrary keys, and provider values", () => {
    const issues: z.ZodIssue[] = [{
      code: "invalid_enum_value",
      options: ["playwright"],
      received: "synthetic-private-provider-value",
      path: ["bundle", "items", 0, "synthetic-private-key", "engine"],
      message: "synthetic-private-message",
    }, {
      code: "unrecognized_keys",
      keys: ["synthetic-private-extra-key"],
      path: ["bundle"],
      message: "synthetic-private-extra-key",
    }];
    const error = new QaRecipeOutputError("generation", issues);
    assert.deepEqual(error.diagnostics.issues, [
      { code: "invalid_enum_value", path: "$.bundle.items.0.*.engine" },
      { code: "unrecognized_keys", path: "$.bundle" },
    ]);
    assert.doesNotMatch(JSON.stringify(error), /synthetic-private|"(?:received|options|keys)"\s*:/);
    assert.equal("cause" in error, false);
    assert.equal(error.expose, false);
  });

  it("bounds issue count, path depth, and numeric indices", () => {
    const error = new QaRecipeOutputError("review", Array.from({ length: 100 }, () => ({
      code: "custom",
      message: "synthetic-private-message",
      path: ["items", -1, 1.5, 100_000, ...Array.from({ length: 30 }, () => "steps")],
    })));
    assert.equal(error.diagnostics.issues.length, 16);
    assert.ok(error.diagnostics.issues.every(({ path }) => path.split(".").length === 13));
    assert.match(error.diagnostics.issues[0]!.path, /^\$\.items\.\*\.\*\.\*\./);
    assert.doesNotMatch(JSON.stringify(error), /synthetic-private/);
  });

  it("does not retain nested union errors or their private messages", () => {
    const error = new QaRecipeOutputError("generation", [{
      code: "invalid_union",
      path: ["bundle", "items", 0, "steps", 2, "expectation"],
      message: "synthetic-private-union-message",
      unionErrors: [new z.ZodError([{ code: "custom", path: ["synthetic-private-path"], message: "synthetic-private-message" }])],
    }]);
    assert.deepEqual(error.diagnostics.issues, [{ code: "invalid_union", path: "$.bundle.items.0.steps.2.expectation" }]);
    assert.doesNotMatch(JSON.stringify(error), /synthetic-private|unionErrors/);
  });
});
