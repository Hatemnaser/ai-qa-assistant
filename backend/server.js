const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { GoogleGenAI } = require("@google/genai");

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const ai = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY,
});

const promptTemplates = {
  general: (message) => `
You are an AI QA Assistant.

Help the user with software testing, QA strategy, test planning, bug analysis, and quality improvement.

User request:
${message}

Respond in a clear, practical, and structured way.
Use QA terminology where useful.
`,

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
};

function buildPrompt(mode, message) {
  const selectedTemplate = promptTemplates[mode] || promptTemplates.general;
  return selectedTemplate(message);
}

app.get("/", (req, res) => {
  res.send("AI QA Assistant backend is running");
});

app.post("/api/chat", async (req, res) => {
  try {
    const { message, mode = "general" } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({
        error: "Message is required and must be a string.",
      });
    }

    const prompt = buildPrompt(mode, message);

    const response = await ai.models.generateContent({
      model: "gemini-3.1-flash-lite-preview",
      contents: prompt,
    });

    res.json({
      reply: response.text,
      mode,
    });
  } catch (error) {
    console.error("Gemini API Error:", error);

    res.status(500).json({
      error: "Something went wrong while generating the response.",
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});