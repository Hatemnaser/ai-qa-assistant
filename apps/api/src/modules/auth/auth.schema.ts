import { z } from "zod";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../config/locales.js";

const emailSchema = z
  .string()
  .trim()
  .email("A valid email is required.")
  .transform((value) => value.toLowerCase());

export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 128;

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`)
  .regex(/[A-Za-z]/, "Password must include at least one letter.")
  .regex(/[0-9]/, "Password must include at least one number.");

export const registerRequestSchema = z.object({
  email: emailSchema,
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
  name: z.string().trim().min(1).max(80).optional(),
  password: passwordSchema,
});

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z
    .string()
    .min(1, "Password is required.")
    .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`),
  remember: z.boolean().default(false),
});

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});

export const resetPasswordRequestSchema = z.object({
  newPassword: passwordSchema,
  token: z.string().trim().min(24, "A valid reset token is required."),
});

export const verifyEmailRequestSchema = z.object({
  token: z.string().trim().min(24, "A valid verification token is required."),
});

export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
});
