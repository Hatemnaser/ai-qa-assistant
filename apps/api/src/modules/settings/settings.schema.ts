import { z } from "zod";

import { SUPPORTED_LOCALES } from "../../config/locales.js";

export const USER_SETTINGS_LANGUAGES = SUPPORTED_LOCALES;
export const USER_SETTINGS_THEMES = ["light", "dark", "system"] as const;

export const updateSettingsSchema = z.object({
  defaultModel: z.string().trim().min(1).max(80),
  language: z.enum(USER_SETTINGS_LANGUAGES),
  theme: z.enum(USER_SETTINGS_THEMES),
});
