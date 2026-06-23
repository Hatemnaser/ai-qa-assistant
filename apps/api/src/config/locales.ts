export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "ar", "de"] as const;

export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
