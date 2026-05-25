import { z } from "zod";

export const USER_SETTINGS_LANGUAGES = ["en", "ar", "de"] as const;
export const USER_SETTINGS_THEMES = ["light", "dark", "system"] as const;

export const updateSettingsSchema = z.object({
  defaultModel: z.string().trim().min(1).max(80),
  language: z.enum(USER_SETTINGS_LANGUAGES),
  theme: z.enum(USER_SETTINGS_THEMES),
});
