import { z } from "zod";

const emailSchema = z
  .string()
  .trim()
  .email("A valid email is required.")
  .transform((value) => value.toLowerCase());

const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters.")
  .max(128, "Password must be 128 characters or fewer.")
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

export const registerRequestSchema = z.object({
  email: emailSchema,
  locale: z.string().trim().min(2).max(12).default("en"),
  name: z.string().trim().min(1).max(80).optional(),
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Password is required."),
  remember: z.boolean().default(false),
});

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
