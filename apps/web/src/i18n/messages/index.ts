import type { AppLocale } from "../locales";
import type { MessageMap } from "./schema";
import ar from "./ar";
import de from "./de";
import en from "./en";

export type { TranslationKey } from "./schema";

export const messages: Record<AppLocale, MessageMap> = {
  ar,
  de,
  en,
};
