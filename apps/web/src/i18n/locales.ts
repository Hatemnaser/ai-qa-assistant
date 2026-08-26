export const DEFAULT_LOCALE = "en";
export const SUPPORTED_LOCALES = ["en", "ar", "de"] as const;

export type AppLocale = (typeof SUPPORTED_LOCALES)[number];
export type LocaleDirection = "ltr" | "rtl";

export interface LocaleOption {
  code: AppLocale;
  direction: LocaleDirection;
  label: string;
  nativeLabel: string;
}

export const LOCALE_OPTIONS: readonly LocaleOption[] = [
  {
    code: "en",
    direction: "ltr",
    label: "English",
    nativeLabel: "English",
  },
  {
    code: "ar",
    direction: "rtl",
    label: "Arabic",
    nativeLabel: "العربية",
  },
  {
    code: "de",
    direction: "ltr",
    label: "German",
    nativeLabel: "Deutsch",
  },
] as const;

const localeOptionsByCode = new Map(LOCALE_OPTIONS.map((option) => [option.code, option]));

export function normalizeLocale(value: unknown): AppLocale {
  return parseLocale(value) ?? DEFAULT_LOCALE;
}

export function parseLocale(value: unknown): AppLocale | null {
  if (typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase().split(/[-_]/)[0];

  return isSupportedLocale(normalized) ? normalized : null;
}

export function isSupportedLocale(value: string): value is AppLocale {
  return SUPPORTED_LOCALES.includes(value as AppLocale);
}

export function getLocaleDirection(locale: AppLocale): LocaleDirection {
  return localeOptionsByCode.get(locale)?.direction || "ltr";
}

export function getLocaleLabel(locale: AppLocale) {
  const option = localeOptionsByCode.get(locale);

  return option ? `${option.label} (${option.nativeLabel})` : locale;
}
