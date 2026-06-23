import { getCurrentLocale, t } from "../../i18n/useI18n";

export function formatRelativeDate(value: string, now = Date.now(), locale = getCurrentLocale()) {
  const date = new Date(value);
  const diffInSeconds = Math.round((now - date.getTime()) / 1000);

  if (Math.abs(diffInSeconds) < 60) return t("date.justNow");

  const relativeFormatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

  if (Math.abs(diffInSeconds) < 3600) {
    return relativeFormatter.format(-Math.round(diffInSeconds / 60), "minute");
  }

  if (Math.abs(diffInSeconds) < 86400) {
    return relativeFormatter.format(-Math.round(diffInSeconds / 3600), "hour");
  }

  if (Math.abs(diffInSeconds) < 604800) {
    return relativeFormatter.format(-Math.round(diffInSeconds / 86400), "day");
  }

  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
  }).format(date);
}
