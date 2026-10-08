import type { t as translate } from "../../i18n/useI18n";
import type { QaRecipeLocator, QaRecipeStep, QaRecipeValue } from "./types";

/** Display-only translation of the immutable instruction, never execution input. */
export function describeApprovalStep(step: QaRecipeStep, t: typeof translate): string {
  const locator = (value: QaRecipeLocator): string => value.by === "role"
    ? t("projects.qa.approval.locator.role", { role: value.role, name: value.name })
    : t(`projects.qa.approval.locator.${value.by}`, { value: value.value });
  const value = (input: QaRecipeValue): string => input.source === "profile"
    ? t("projects.qa.approval.profileValue", { key: input.key }) : `“${input.value}”`;
  if (step.action === "navigate") return t("projects.qa.approval.step.navigate", { path: step.path });
  if (step.action === "expect") {
    return t("projects.qa.approval.step.expect", {
      target: "locator" in step.expectation ? locator(step.expectation.locator) : t("projects.qa.approval.pageUrl"),
      expectation: t(`projects.qa.approval.expectation.${step.expectation.kind}`),
      value: "expected" in step.expectation ? `“${step.expectation.expected}”` : "",
    }).trim();
  }
  const target = locator(step.locator);
  if (step.action === "fill") return t("projects.qa.approval.step.fill", { target, value: value(step.value) });
  if (step.action === "select") return t("projects.qa.approval.step.select", { target, value: value(step.option.value) });
  if (step.action === "press") return t("projects.qa.approval.step.press", { target, key: step.key });
  if (step.action === "check") return t(step.checked ? "projects.qa.approval.step.check" : "projects.qa.approval.step.uncheck", { target });
  return t(`projects.qa.approval.step.${step.action}`, { target });
}
