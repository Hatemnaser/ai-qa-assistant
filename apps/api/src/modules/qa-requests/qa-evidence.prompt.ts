// This describes the bundled Runner, not the capabilities of every external
// agent. Keep it shared by planning and review so their evidence promises agree.
export const PLAYWRIGHT_V1_EVIDENCE_GUIDANCE = [
  "Bundled local Playwright Runner / RecipeV1 evidence contract:",
  "- The Runner collects evidence after executing each checklist item, outside Recipe steps. RecipeV1 has no evidence-collection action; do not add or suggest capture, evaluate, screenshot, logging, or evidence metadata steps.",
  "- When the selected profile supports TEXT, its automatic TEXT entry contains the checklist title, executed status, completed-step count, and first incomplete step reference when present (otherwise all declared steps completed). It is an assertion execution summary, not a DOM snapshot or a detailed diagnostic log.",
  "- Automatic TEXT does not contain outerHTML, element text/value/attribute dumps, console or network logs, backend logs, or the browser exception/error message. Assertions can verify visibility, disabled state, text, or values, but that does not mean those raw values are captured in TEXT evidence.",
  "- When the selected profile supports SCREENSHOT, the Runner can attach a screenshot after the item's execution. Do not promise a screenshot at every step or any evidence kind not declared by the profile. No Runner profile has been selected merely because planning context mentions a website.",
  "- Evidence requirements attached by exact requirement ID satisfy a structural gate only; presence is not verification that their requested content is sufficient, and does not imply the check passed or the product is release-ready.",
  "- These limits apply to the bundled Runner only. External agents can submit richer evidence through the existing QA workflow; do not weaken their explicitly requested or immutable evidence requirements to fit this Runner.",
].join("\n");

export const CHECKLIST_EVIDENCE_GUIDANCE = [
  PLAYWRIGHT_V1_EVIDENCE_GUIDANCE,
  "For default generated browser checks, when no richer capture is explicitly required, use one required TEXT requirement per check describing the Runner's executed status, completed-step count, and first incomplete step reference if any. Do not invent a requirement for outerHTML, attribute dumps, or error logs that this Runner cannot capture.",
  "If the request explicitly requires richer evidence or names an external evidence source, preserve that need and state the capture dependency in preconditions rather than silently replacing it with a generic summary. Do not claim the bundled Runner can fulfill it. When reviewing a supplied checklist, keep its evidence requirements unchanged and flag any relevant capture dependency or capability gap for the owner.",
].join("\n\n");

export const RECIPE_EVIDENCE_REVIEW_GUIDANCE = [
  PLAYWRIGHT_V1_EVIDENCE_GUIDANCE,
  "Do not report missing evidence-collection steps: automatic supported evidence is produced outside the Recipe. Instead, compare each immutable evidence requirement's requested content with the actual selected Runner capability. A required DOM/attribute/log dump cannot be fulfilled by automatic TEXT; flag that requirement as an evidence-capability mismatch and explain the capture limitation, without suggesting unsupported actions or claiming existing evidence content was verified.",
  "Do not rewrite, drop, or relabel the immutable evidence requirement. A resolution requiring a different capture source or a new checklist belongs to an explicit owner decision, not an invisible change to this Recipe.",
].join("\n\n");
