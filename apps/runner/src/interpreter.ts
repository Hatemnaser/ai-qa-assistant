import {
  recipeItemV1Schema,
  type RecipeItemV1,
  type RecipeLocatorV1,
  type RecipeStepV1,
} from "@oddpath/qa-execution-contract";

import {
  assertSameOriginUrl,
  resolveNavigationUrl,
  resolveProfileValue,
  type RunnerProfileConfig,
} from "./config.js";

type ExpectStep = Extract<RecipeStepV1, { action: "expect" }>;
type SelectStep = Extract<RecipeStepV1, { action: "select" }>;

export interface SemanticBrowserSession {
  check(locator: RecipeLocatorV1, checked: boolean, timeoutMs: number): Promise<void>;
  click(locator: RecipeLocatorV1, timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  currentUrl(): string;
  expect(expectation: ExpectStep["expectation"], timeoutMs: number): Promise<void>;
  fill(locator: RecipeLocatorV1, value: string, timeoutMs: number): Promise<void>;
  hover(locator: RecipeLocatorV1, timeoutMs: number): Promise<void>;
  navigate(url: string, waitUntil: "domcontentloaded" | "load", timeoutMs: number): Promise<void>;
  press(locator: RecipeLocatorV1, key: Extract<RecipeStepV1, { action: "press" }>["key"], timeoutMs: number): Promise<void>;
  screenshot(): Promise<Uint8Array>;
  select(
    locator: RecipeLocatorV1,
    option: SelectStep["option"]["by"],
    value: string,
    timeoutMs: number
  ): Promise<void>;
}

export interface RecipeItemExecutionResult {
  completedStepRefs: string[];
  failedStepRef: string | null;
  notes?: string;
  observedResult: string;
  status: "PASS" | "FAIL" | "BLOCKED";
}

export interface ExecuteRecipeItemInput {
  assertActive?: () => void;
  item: RecipeItemV1;
  profile: RunnerProfileConfig;
  session: SemanticBrowserSession;
}

const DEFAULT_STEP_TIMEOUT_MS = 10_000;

export async function executeRecipeItem({
  assertActive = () => {},
  item: rawItem,
  profile,
  session,
}: ExecuteRecipeItemInput): Promise<RecipeItemExecutionResult> {
  const item = recipeItemV1Schema.parse(rawItem);
  const completedStepRefs: string[] = [];

  for (const step of item.steps) {
    assertActive();
    try {
      await executeStep(session, profile, step);
      assertSameOriginUrl(profile.baseUrl, session.currentUrl());
      assertActive();
      completedStepRefs.push(step.ref);
    } catch {
      const failedExpectation = step.action === "expect";
      return {
        completedStepRefs,
        failedStepRef: step.ref,
        notes: failedExpectation
          ? `The observable expectation at step ${step.ref} did not pass.`
          : `Execution was blocked at step ${step.ref}.`,
        observedResult: failedExpectation
          ? `Expectation ${step.ref} did not match the page state.`
          : `The runner could not complete step ${step.ref}.`,
        status: failedExpectation ? "FAIL" : "BLOCKED",
      };
    }
  }

  return {
    completedStepRefs,
    failedStepRef: null,
    observedResult: `All ${completedStepRefs.length} recipe steps completed, including the declared observable expectation.`,
    status: "PASS",
  };
}

async function executeStep(
  session: SemanticBrowserSession,
  profile: RunnerProfileConfig,
  step: RecipeStepV1
) {
  const timeoutMs = step.timeoutMs ?? DEFAULT_STEP_TIMEOUT_MS;
  switch (step.action) {
    case "navigate":
      await session.navigate(
        resolveNavigationUrl(profile.baseUrl, step.path),
        step.waitUntil,
        timeoutMs
      );
      return;
    case "click":
      await session.click(step.locator, timeoutMs);
      return;
    case "fill":
      await session.fill(step.locator, resolveValue(profile, step.value), timeoutMs);
      return;
    case "select":
      await session.select(
        step.locator,
        step.option.by,
        resolveValue(profile, step.option.value),
        timeoutMs
      );
      return;
    case "check":
      await session.check(step.locator, step.checked, timeoutMs);
      return;
    case "press":
      await session.press(step.locator, step.key, timeoutMs);
      return;
    case "hover":
      await session.hover(step.locator, timeoutMs);
      return;
    case "expect":
      await session.expect(step.expectation, timeoutMs);
  }
}

function resolveValue(
  profile: RunnerProfileConfig,
  value: Extract<RecipeStepV1, { action: "fill" }>["value"]
) {
  return value.source === "literal" ? value.value : resolveProfileValue(profile, value.key);
}
