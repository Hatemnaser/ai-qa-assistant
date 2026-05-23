const conversationalPromptTemplate = (message: string) => `
You are an AI QA Assistant.

Help the user with software testing, QA strategy, test planning, bug analysis, and quality improvement.
Use the recent conversation context when the user asks a follow-up, says thanks, asks for a language change,
or asks a clarification question. Do not force a QA artifact format unless the latest user request asks for one.

User request:
${message}

Respond in a clear, practical, and structured way.
Use QA terminology where useful.
`;

const generalPromptTemplate = conversationalPromptTemplate;

const promptTemplates: Record<string, (message: string) => string> = {
  general: generalPromptTemplate,

  test_cases: (message) => `
You are a professional QA Engineer.

Generate structured test cases for the following feature or requirement:

${message}

Format the answer as:

# Test Cases

## Scope
Briefly describe what is being tested.

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
Include positive, negative, edge, security, and UI cases when relevant.
`,

  bug_report: (message) => `
You are a QA Engineer writing a professional bug report.

Create a structured bug report based on this issue:

${message}

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

## Possible Cause
Suggest possible technical or UX causes.

## Additional Notes
Mention useful logs, screenshots, or checks the tester should collect.
`,

  edge_cases: (message) => `
You are a QA Engineer specialized in edge case analysis.

Suggest edge cases for the following feature:

${message}

Format the answer as:

# Edge Case Analysis

## Feature
Briefly describe the feature.

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

  checklist: (message) => `
You are a Senior QA Engineer.

Create a QA checklist for:

${message}

Format the answer as:

# QA Checklist

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

  screenshot_review: (message) => `
You are a Senior QA Engineer reviewing a UI screenshot.

Analyze the attached screenshot and the user note:

${message}

Format the answer as:

# Screenshot QA Review

## Summary
Briefly describe what the screen appears to show.

## UI / UX Issues
List visible usability, layout, spacing, alignment, contrast, text, or interaction issues.

## Accessibility Concerns
Mention possible accessibility problems such as contrast, labels, readability, keyboard usage, or visual hierarchy.

## Possible Bugs
List anything that could be a functional or visual bug.

## Suggested Test Cases
Provide practical test cases based on the screenshot.

## Severity Notes
Classify the most important issues as Low / Medium / High.

Be practical and specific. Do not invent backend behavior that cannot be seen from the screenshot.
`,
};

export function buildPrompt(mode: string, message: string) {
  if (isConversationalFollowUp(message)) {
    return conversationalPromptTemplate(message);
  }

  const selectedTemplate = promptTemplates[mode] || generalPromptTemplate;
  return selectedTemplate(message);
}

function isConversationalFollowUp(message: string) {
  const normalized = message.trim().toLowerCase();

  if (!normalized) return false;

  return conversationalPatterns.some((pattern) => pattern.test(normalized));
}

const conversationalPatterns = [
  /^(thanks|thank you|thx|ty|ok|okay|cool|great|nice|perfect|awesome|done)[.!?]*$/,
  /\b(can|could|do)\s+you\s+(speak|talk|write|answer|reply)\s+(in\s+)?(arabic|english)\b/,
  /\b(use|switch to|respond in|reply in|answer in|write in)\s+(arabic|english)\b/,
  /\b(in arabic|in english|arabic please|english please)\b/,
  /^(مرحبا|اهلا|أهلا|شكرا|شكراً|تمام|اوكي|حلو|ممتاز|يسلمو|يعطيك العافية)[.!؟]*$/,
  /(بتحكي|تحكي|احكي|جاوب|اكتب).*(عربي|باللغة العربية|بالانجليزي|انجليزي)/,
];
