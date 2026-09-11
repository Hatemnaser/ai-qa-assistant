import { z } from "zod";

import { boundedIdSchema, hasUniqueValues, profileValueKeySchema } from "./common.js";

export const RECIPE_V1_ENGINE = "playwright" as const;
export const RECIPE_V1_SCHEMA_VERSION = 1 as const;

const stepRefSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9._-]{0,63}$/u, "Use a lowercase step reference.");
const boundedLiteralSchema = z.string().max(2_000);
const timeoutSchema = z.number().int().min(500).max(30_000).optional();

export const recipeValueV1Schema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("literal"), value: boundedLiteralSchema }).strict(),
  z.object({ key: profileValueKeySchema, source: z.literal("profile") }).strict(),
]);

export const PLAYWRIGHT_ARIA_ROLES = [
  "alert",
  "alertdialog",
  "application",
  "article",
  "banner",
  "blockquote",
  "button",
  "caption",
  "cell",
  "checkbox",
  "code",
  "columnheader",
  "combobox",
  "complementary",
  "contentinfo",
  "definition",
  "deletion",
  "dialog",
  "directory",
  "document",
  "emphasis",
  "feed",
  "figure",
  "form",
  "generic",
  "grid",
  "gridcell",
  "group",
  "heading",
  "img",
  "insertion",
  "link",
  "list",
  "listbox",
  "listitem",
  "log",
  "main",
  "marquee",
  "math",
  "menu",
  "menubar",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "meter",
  "navigation",
  "none",
  "note",
  "option",
  "paragraph",
  "presentation",
  "progressbar",
  "radio",
  "radiogroup",
  "region",
  "row",
  "rowgroup",
  "rowheader",
  "scrollbar",
  "search",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "status",
  "strong",
  "subscript",
  "superscript",
  "switch",
  "tab",
  "table",
  "tablist",
  "tabpanel",
  "term",
  "textbox",
  "time",
  "timer",
  "toolbar",
  "tooltip",
  "tree",
  "treegrid",
  "treeitem",
] as const;

const locatorBase = {
  exact: z.boolean().optional(),
  index: z.number().int().min(0).max(49).optional(),
};

export const recipeLocatorV1Schema = z.discriminatedUnion("by", [
  z.object({
    ...locatorBase,
    by: z.literal("role"),
    name: z.string().trim().min(1).max(500),
    role: z.enum(PLAYWRIGHT_ARIA_ROLES),
  }).strict(),
  z.object({
    ...locatorBase,
    by: z.literal("label"),
    value: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    ...locatorBase,
    by: z.literal("placeholder"),
    value: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    ...locatorBase,
    by: z.literal("text"),
    value: z.string().trim().min(1).max(500),
  }).strict(),
  z.object({
    by: z.literal("testId"),
    index: locatorBase.index,
    value: z.string().trim().min(1).max(200),
  }).strict(),
]);

const safeRelativePathSchema = z
  .string()
  .min(1)
  .max(1_000)
  .refine((value) => /^\/(?!\/)/u.test(value), "Navigation paths must be relative to the profile base URL.")
  .refine((value) => !/[\\\u0000-\u001f\u007f\s]/u.test(value), "Navigation path contains unsupported characters.");

const stepBase = {
  ref: stepRefSchema,
  timeoutMs: timeoutSchema,
};

const navigateStepSchema = z.object({
  ...stepBase,
  action: z.literal("navigate"),
  path: safeRelativePathSchema,
  waitUntil: z.enum(["domcontentloaded", "load"]).default("domcontentloaded"),
}).strict();

const locatorActionSchemas = [
  z.object({ ...stepBase, action: z.literal("click"), locator: recipeLocatorV1Schema }).strict(),
  z.object({
    ...stepBase,
    action: z.literal("fill"),
    locator: recipeLocatorV1Schema,
    value: recipeValueV1Schema,
  }).strict(),
  z.object({
    ...stepBase,
    action: z.literal("select"),
    locator: recipeLocatorV1Schema,
    option: z.discriminatedUnion("by", [
      z.object({ by: z.literal("label"), value: recipeValueV1Schema }).strict(),
      z.object({ by: z.literal("value"), value: recipeValueV1Schema }).strict(),
    ]),
  }).strict(),
  z.object({
    ...stepBase,
    action: z.literal("check"),
    checked: z.boolean(),
    locator: recipeLocatorV1Schema,
  }).strict(),
  z.object({
    ...stepBase,
    action: z.literal("press"),
    key: z.enum(["Enter", "Escape", "Tab", "ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Space"]),
    locator: recipeLocatorV1Schema,
  }).strict(),
  z.object({ ...stepBase, action: z.literal("hover"), locator: recipeLocatorV1Schema }).strict(),
] as const;

const locatorExpectationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.enum(["visible", "hidden", "enabled", "disabled", "checked", "unchecked"]), locator: recipeLocatorV1Schema }).strict(),
  z.object({
    expected: boundedLiteralSchema,
    kind: z.enum(["textEquals", "textContains", "valueEquals"]),
    locator: recipeLocatorV1Schema,
  }).strict(),
  z.object({
    expected: z.number().int().min(0).max(10_000),
    kind: z.literal("countEquals"),
    locator: recipeLocatorV1Schema,
  }).strict(),
]);

const urlExpectationSchema = z.object({
  expected: safeRelativePathSchema,
  kind: z.enum(["urlPathEquals", "urlPathContains"]),
}).strict();

const expectStepSchema = z.object({
  ...stepBase,
  action: z.literal("expect"),
  expectation: z.union([locatorExpectationSchema, urlExpectationSchema]),
}).strict();

export const recipeStepV1Schema = z.discriminatedUnion("action", [
  navigateStepSchema,
  ...locatorActionSchemas,
  expectStepSchema,
]);

export const recipeItemV1Schema = z.object({
  checklistItemId: boundedIdSchema,
  steps: z.array(recipeStepV1Schema).min(1).max(50),
}).strict().superRefine((value, context) => {
  if (value.steps[0]?.action !== "navigate") {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "The first recipe step must navigate to a relative path.",
      path: ["steps", 0],
    });
  }
  if (!value.steps.some((step) => step.action === "expect")) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Each recipe item must contain an observable expectation.",
      path: ["steps"],
    });
  }
  const refs = value.steps.map(({ ref }) => ref);
  if (!hasUniqueValues(refs)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Recipe step references must be unique within an item.",
      path: ["steps"],
    });
  }
});

export const recipeBundleV1Schema = z.object({
  engine: z.literal(RECIPE_V1_ENGINE),
  items: z.array(recipeItemV1Schema).min(1).max(80),
  schemaVersion: z.literal(RECIPE_V1_SCHEMA_VERSION),
}).strict().superRefine((value, context) => {
  const itemIds = value.items.map(({ checklistItemId }) => checklistItemId);
  if (!hasUniqueValues(itemIds)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "A recipe bundle must cover each checklist item exactly once.",
      path: ["items"],
    });
  }
});

export type RecipeBundleV1 = z.infer<typeof recipeBundleV1Schema>;
export type RecipeItemV1 = z.infer<typeof recipeItemV1Schema>;
export type RecipeLocatorV1 = z.infer<typeof recipeLocatorV1Schema>;
export type RecipeStepV1 = z.infer<typeof recipeStepV1Schema>;
export type RecipeValueV1 = z.infer<typeof recipeValueV1Schema>;
