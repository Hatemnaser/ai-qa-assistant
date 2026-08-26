import type { TranslationKey } from "../../i18n/messages";

const USAGE_STATUS_KEYS = {
  completed: "usage.status.completed",
  failed: "usage.status.failed",
  reserved: "usage.status.reserved",
  unknown: "usage.status.unknown",
} as const satisfies Record<string, TranslationKey>;

export function getUsageStatusTranslationKey(status: string): TranslationKey {
  const normalizedStatus = status.trim().toLowerCase();

  return USAGE_STATUS_KEYS[normalizedStatus as keyof typeof USAGE_STATUS_KEYS]
    || "usage.status.unknown";
}
