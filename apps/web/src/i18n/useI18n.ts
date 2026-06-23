import { computed, ref, watch } from "vue";

import {
  DEFAULT_LOCALE,
  getLocaleDirection,
  LOCALE_OPTIONS,
  normalizeLocale,
  type AppLocale,
} from "./locales";
import { messages, type TranslationKey } from "./messages";

const LOCALE_STORAGE_KEY = "ai_qa_assistant_locale";
const locale = ref<AppLocale>(readInitialLocale());
const direction = computed(() => getLocaleDirection(locale.value));

watch(
  locale,
  (nextLocale) => {
    writeStoredLocale(nextLocale);
    applyLocaleToDocument(nextLocale);
  },
  { immediate: true }
);

export function useI18n() {
  return {
    direction,
    formatDate,
    locale,
    localeOptions: LOCALE_OPTIONS,
    setLocale,
    t,
  };
}

export function setLocale(value: unknown) {
  const nextLocale = normalizeLocale(value);

  locale.value = nextLocale;
  writeStoredLocale(nextLocale);
  applyLocaleToDocument(nextLocale);
}

export function t(key: TranslationKey, params: Record<string, string | number> = {}) {
  const template = messages[locale.value][key] || messages[DEFAULT_LOCALE][key] || key;

  return template.replace(/\{(\w+)\}/g, (match, paramKey: string) => {
    const value = params[paramKey];

    return value === undefined ? match : String(value);
  });
}

export function formatDate(
  value: string | Date,
  options: Intl.DateTimeFormatOptions = {
    dateStyle: "medium",
  }
) {
  return new Intl.DateTimeFormat(locale.value, options).format(new Date(value));
}

export function getCurrentLocale() {
  return locale.value;
}

function readInitialLocale(): AppLocale {
  const storedLocale = readStoredLocale();

  if (storedLocale) return storedLocale;

  return normalizeLocale(globalThis.navigator?.language);
}

function readStoredLocale() {
  try {
    return normalizeLocale(globalThis.localStorage?.getItem(LOCALE_STORAGE_KEY));
  } catch {
    return DEFAULT_LOCALE;
  }
}

function writeStoredLocale(nextLocale: AppLocale) {
  try {
    globalThis.localStorage?.setItem(LOCALE_STORAGE_KEY, nextLocale);
  } catch {
    // Local preference persistence should never block rendering.
  }
}

function applyLocaleToDocument(nextLocale: AppLocale) {
  const root = globalThis.document?.documentElement;

  if (!root) return;

  root.lang = nextLocale;
  root.dir = getLocaleDirection(nextLocale);
  root.dataset.locale = nextLocale;
}
