import type { GoogleGenAI } from "@google/genai";

import { env } from "../../../config/env.js";
import { GEMINI_PROVIDER_ID, normalizeGeminiModel } from "../gemini.models.js";
import {
  buildWorkflowRouterPrompt,
  type WorkflowRouterDecision,
  type WorkflowRouterInput,
} from "./workflow-router.js";

export async function routeWorkflowWithGemini(
  ai: GoogleGenAI,
  input: WorkflowRouterInput
): Promise<WorkflowRouterDecision | undefined> {
  if (!env.aiWorkflowRouterEnabled) return undefined;

  const model = normalizeGeminiModel(env.aiWorkflowRouterModel);
  const prompt = buildWorkflowRouterPrompt(input);

  const response = await withRouterTimeout(
    ai.models.generateContent({
      model,
      contents: prompt,
      config: {
        maxOutputTokens: 256,
        responseMimeType: "application/json",
        temperature: 0,
        thinkingConfig: {
          thinkingBudget: 0,
        },
      },
    }),
    env.aiWorkflowRouterTimeoutMs
  );

  return parseRouterDecision(response.text || "");
}

function parseRouterDecision(text: string): WorkflowRouterDecision | undefined {
  const trimmed = text.trim();

  if (!trimmed) return undefined;

  try {
    return JSON.parse(trimmed) as WorkflowRouterDecision;
  } catch {
    const jsonMatch = trimmed.match(/\{[\s\S]*\}/);

    if (!jsonMatch) return undefined;

    try {
      return JSON.parse(jsonMatch[0]) as WorkflowRouterDecision;
    } catch {
      return undefined;
    }
  }
}

function withRouterTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      reject(new Error(`${GEMINI_PROVIDER_ID} workflow router timed out.`));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    clearTimeout(timeout);
  });
}
