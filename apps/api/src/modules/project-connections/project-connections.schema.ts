import { z } from "zod";

export const QA_CONNECTION_SCOPES = [
  "qa:read",
  "qa:write",
  "evidence:write",
  "execution:claim",
  "execution:write",
] as const;

export const QA_CONNECTION_PRESETS = ["AGENT", "RUNNER"] as const;

const idSchema = z.string().trim().min(1).max(120);

export const connectionProjectParamsSchema = z.object({ projectId: idSchema }).strict();
export const connectionParamsSchema = z.object({
  projectId: idSchema,
  connectionId: idSchema,
}).strict();

export const createProjectConnectionSchema = z.object({
  name: z.string().trim().min(1).max(120),
  preset: z.enum(QA_CONNECTION_PRESETS).optional(),
  scopes: z.array(z.enum(QA_CONNECTION_SCOPES)).min(1).max(QA_CONNECTION_SCOPES.length).optional(),
  expiresAt: z.string().datetime({ offset: true }).nullable().optional(),
}).strict().superRefine((value, context) => {
  if (value.preset && value.scopes) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Choose a connection preset or explicit scopes, not both.",
      path: ["scopes"],
    });
  }
});

export type QaConnectionScope = typeof QA_CONNECTION_SCOPES[number];
export type QaConnectionPreset = typeof QA_CONNECTION_PRESETS[number];
export type CreateProjectConnectionInput = z.infer<typeof createProjectConnectionSchema>;
