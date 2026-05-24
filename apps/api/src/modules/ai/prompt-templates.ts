import type { AiHistoryMessage } from "./ai.types.js";
import { analyzeQaWorkflow, formatWorkflowInstructions, type QaWorkflowAnalysis } from "./qa-workflow.js";

interface PromptBuildOptions {
  hasImage?: boolean;
  hasTextAttachment?: boolean;
  history?: AiHistoryMessage[];
}

const conversationalPromptTemplate = (message: string, analysis: QaWorkflowAnalysis) => `
You are an AI QA Assistant.

${formatWorkflowInstructions(analysis)}

Help the user with software testing, QA strategy, test planning, bug analysis, and quality improvement.
Use the recent conversation context when the user asks a follow-up, says thanks, asks for a language change,
or asks a clarification question. Do not force a QA artifact format unless the latest user request asks for one.
If the latest message is only a brief reaction such as thanks, wow, or ok, answer naturally and do not ask for a new image or attachment just because older context involved one.

User request:
${message}

Respond in a clear, practical, and structured way.
Use QA terminology where useful.
`;

const generalPromptTemplate = (message: string, analysis: QaWorkflowAnalysis) => `
You are an AI QA Assistant.

${formatWorkflowInstructions(analysis)}

User request:
${message}

Respond as a senior QA partner. If the request is broad, identify the likely QA workflow and give a useful next step.
When details are missing, state assumptions clearly and ask focused follow-up questions.
`;

const visualContextPromptTemplate = (message: string, analysis: QaWorkflowAnalysis) => `
You are an AI QA Assistant looking at an attached visual.

${formatWorkflowInstructions(analysis)}

The user attached an image or screenshot without a specific QA task.

User note:
${message}

Briefly describe what appears to be visible in the image. Then ask what the user wants to do next.
Offer a short set of relevant QA options, such as:
- QA visual review
- test cases based on the screen
- bug report for a visible issue
- accessibility, layout, or UX review

Do not produce a full QA artifact yet unless the user's latest message clearly asks for one.
Do not invent details that are not visible in the attached image.
`;

const fileContextPromptTemplate = (message: string, analysis: QaWorkflowAnalysis) => `
You are an AI QA Assistant reviewing attached text or data files.

${formatWorkflowInstructions(analysis)}

The user attached one or more text/data files without a specific QA task.

User note:
${message}

Briefly summarize what the attached file content appears to contain. Then ask what the user wants to do next.
Offer a short set of relevant QA options, such as:
- create test cases from the requirements
- find edge cases or risks
- turn an issue description into a bug report
- create a QA checklist
- review data for gaps or inconsistencies

Do not produce a full QA artifact yet unless the user's latest message clearly asks for one.
Do not mention screenshots or ask for an image unless the user specifically asks for visual review.
`;

const promptTemplates: Record<string, (message: string, analysis: QaWorkflowAnalysis) => string> = {
  general: generalPromptTemplate,

  test_cases: (message, analysis) => `
You are a professional QA Engineer.

${formatWorkflowInstructions(analysis)}

Generate structured test cases for the following feature or requirement:

${message}

${formatClarificationInstruction(analysis)}

Format the answer as:

# Test Cases

## Scope
Briefly describe what is being tested.

## Assumptions
List any assumptions you made from the request.

## Test Cases
For each test case include:
- Test Case ID
- Title
- Preconditions
- Steps
- Expected Result
- Priority
- Type: Functional / Negative / Boundary / Security / UI / Regression

Make the test cases practical and realistic.
Include positive, negative, edge, security, accessibility, integration/API, and UI cases when relevant.
`,

  bug_report: (message, analysis) => `
You are a QA Engineer writing a professional bug report.

${formatWorkflowInstructions(analysis)}

Create a structured bug report based on this issue:

${message}

${formatClarificationInstruction(analysis)}

Format the answer as:

# Bug Report

## Title
Clear and concise bug title.

## Summary
Short explanation of the issue.

## Environment
- Browser:
- Device:
- OS:
- App Version:

## Steps to Reproduce
1.
2.
3.

## Actual Result
What actually happens.

## Expected Result
What should happen.

## Severity
Low / Medium / High / Critical

## Priority
Low / Medium / High

## Evidence Needed
Mention useful logs, screenshots, network calls, console errors, or data checks the tester should collect.

## Possible Cause
Suggest possible technical or UX causes without pretending they are confirmed.

## Additional Notes
Add assumptions and open questions.
`,

  edge_cases: (message, analysis) => `
You are a QA Engineer specialized in edge case analysis.

${formatWorkflowInstructions(analysis)}

Suggest edge cases for the following feature:

${message}

${formatClarificationInstruction(analysis)}

Format the answer as:

# Edge Case Analysis

## Feature
Briefly describe the feature.

## Assumptions
List any assumptions you made from the request.

## Edge Cases
Group the edge cases by category:
- Input validation
- Boundary values
- User behavior
- Security
- Performance
- Network / API
- UI / UX
- Browser / device compatibility

For each edge case, include:
- Scenario
- Why it matters
- Expected behavior
`,

  checklist: (message, analysis) => `
You are a Senior QA Engineer.

${formatWorkflowInstructions(analysis)}

Create a QA checklist for:

${message}

${formatClarificationInstruction(analysis)}

Format the answer as:

# QA Checklist

## Assumptions
- ...

## Functional Testing
- [ ] ...

## UI / UX Testing
- [ ] ...

## Negative Testing
- [ ] ...

## Boundary Testing
- [ ] ...

## Security Testing
- [ ] ...

## Accessibility Testing
- [ ] ...

## API / Integration Testing
- [ ] ...

## Regression Testing
- [ ] ...

Make the checklist practical and useful for a real QA process.
`,

  screenshot_review: (message, analysis) => `
You are a Senior QA Engineer reviewing a visual attachment such as a UI screenshot, app screen, or product image.

${formatWorkflowInstructions(analysis)}

Analyze the attached image or screenshot and the user note:

${message}

If no image is attached to the latest request, ask the user to upload the image before reviewing. Do not invent visible details from earlier context.

Format the answer as:

# Visual QA Review

## Summary
Briefly describe what the screen appears to show.

## UI / UX Issues
List visible usability, layout, spacing, alignment, contrast, text, or interaction issues.

## Accessibility Concerns
Mention possible accessibility problems such as contrast, labels, readability, keyboard usage, or visual hierarchy.

## Possible Bugs
List anything that could be a functional or visual bug.

## Suggested Test Cases
Provide practical test cases based on the attached visual.

## Severity Notes
Classify the most important issues as Low / Medium / High.

Be practical and specific. Do not invent backend behavior that cannot be seen from the attached visual.
`,
};

export function buildPrompt(mode: string, message: string, options: PromptBuildOptions = {}) {
  const analysis = analyzeQaWorkflow({
    hasImage: options.hasImage,
    hasTextAttachment: options.hasTextAttachment,
    history: options.history,
    message,
    mode,
  });

  if (!analysis.shouldUseArtifactTemplate) {
    if (analysis.intent === "visual_context") {
      return visualContextPromptTemplate(message, analysis);
    }

    if (analysis.intent === "file_context") {
      return fileContextPromptTemplate(message, analysis);
    }

    return conversationalPromptTemplate(message, analysis);
  }

  const selectedTemplate = promptTemplates[analysis.effectiveMode] || generalPromptTemplate;
  return selectedTemplate(message, analysis);
}

function formatClarificationInstruction(analysis: QaWorkflowAnalysis) {
  if (!analysis.shouldAskClarifyingQuestion) {
    return "If important details are missing, state reasonable assumptions before the artifact.";
  }

  return "The request is underspecified. Ask up to 3 focused clarifying questions first, then provide a short starter outline only if it is still useful.";
}
