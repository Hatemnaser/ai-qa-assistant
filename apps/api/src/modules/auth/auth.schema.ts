import { z } from "zod";

import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from "../../config/locales.js";

const emailSchema = z
  .string()
  .trim()
  .email("A valid email is required.")
  .transform((value) => value.toLowerCase());

export const PASSWORD_MIN_LENGTH = 15;
export const PASSWORD_MAX_LENGTH = 128;

const COMMON_PASSWORDS = new Set([
  "123456789012345",
  "adminadminadmin",
  "asdfghjklasdfgh",
  "baseballbaseball",
  "changemechangeme",
  "correcthorsebatterystaple",
  "dragon123456789",
  "eluthiraeluthira",
  "footballfootball",
  "iloveyouiloveyou",
  "letmeinletmein1",
  "monkeymonkeymon",
  "oddpathoddpath1",
  "password1234567",
  "passwordpassword",
  "princessprincess",
  "qwertyqwertyqwer",
  "qwertyuiopasdfgh",
  "secretsecretsecret",
  "sunshinesunshine",
  "trustno1trustno1",
  "welcome123456789",
  "whateverwhatever",
  "zxcvbnmzxcvbnmz",
]);

const passwordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`)
  .max(PASSWORD_MAX_LENGTH, `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer.`)
  .refine((value) => !COMMON_PASSWORDS.has(value.toLowerCase()), {
    message: "Choose a less common password or passphrase.",
  });

export const registerRequestSchema = z.object({
  email: emailSchema,
  inviteCode: z.string().trim().min(1).max(256).optional(),
  locale: z.enum(SUPPORTED_LOCALES).default(DEFAULT_LOCALE),
  name: z.string().trim().min(1).max(80).optional(),
  password: passwordSchema,
  termsAccepted: z.literal(true, {
    errorMap: () => ({ message: "You must accept the current terms and privacy notice." }),
  }),
  termsVersion: z.string().trim().min(1).max(64),
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
