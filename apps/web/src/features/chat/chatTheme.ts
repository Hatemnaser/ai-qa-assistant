import { computed, onScopeDispose, ref } from "vue";

import { STORAGE_KEYS } from "./constants";
import { t } from "../../i18n/useI18n";
import { getLocalStorageItem, setLocalStorageItem } from "../../lib/browserStorage";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

function normalizeTheme(value: string | null): ThemePreference {
  if (value === "dark" || value === "system") return value;

  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function getSystemThemeQuery() {
  try {
    return globalThis.matchMedia?.("(prefers-color-scheme: dark)") ?? null;
  } catch {
    return null;
  }
}

export function useTheme() {
  const theme = ref<ThemePreference>(
    normalizeTheme(getLocalStorageItem(STORAGE_KEYS.THEME, null))
  );
  const systemThemeQuery = getSystemThemeQuery();
  const resolvedTheme = ref<Theme>(resolveTheme(theme.value));
  const themeToggleLabel = computed(() =>
    t(resolvedTheme.value === "dark" ? "theme.light" : "theme.dark")
  );
  let isListeningForSystemTheme = false;

  function resolveTheme(preference: ThemePreference): Theme {
    if (preference !== "system") return preference;

    return systemThemeQuery?.matches ? "dark" : "light";
  }

  function refreshResolvedTheme() {
    resolvedTheme.value = resolveTheme(theme.value);
    applyTheme(resolvedTheme.value);
  }

  function handleSystemThemeChange() {
    if (theme.value === "system") refreshResolvedTheme();
  }

  function startSystemThemeSync() {
    if (!systemThemeQuery || isListeningForSystemTheme) return;

    if (typeof systemThemeQuery.addEventListener !== "function") return;

    try {
      systemThemeQuery.addEventListener("change", handleSystemThemeChange);
      isListeningForSystemTheme = true;
    } catch {
      // The resolved theme still works even if this browser rejects subscriptions.
    }
  }

  function stopSystemThemeSync() {
    if (!systemThemeQuery || !isListeningForSystemTheme) return;

    try {
      systemThemeQuery.removeEventListener?.("change", handleSystemThemeChange);
    } catch {
      // Cleanup must not make navigation or component teardown fail.
    } finally {
      isListeningForSystemTheme = false;
    }
  }

  function syncSystemThemePreference() {
    if (theme.value === "system") {
      startSystemThemeSync();
    } else {
      stopSystemThemeSync();
    }

    refreshResolvedTheme();
  }

  syncSystemThemePreference();
  onScopeDispose(stopSystemThemeSync, true);

  function setTheme(nextTheme: ThemePreference) {
    theme.value = nextTheme;
    setLocalStorageItem(STORAGE_KEYS.THEME, theme.value);
    syncSystemThemePreference();
  }

  function toggleTheme() {
    setTheme(resolvedTheme.value === "dark" ? "light" : "dark");
  }

  return {
    setTheme,
    theme,
    themeToggleLabel,
    toggleTheme,
  };
}
