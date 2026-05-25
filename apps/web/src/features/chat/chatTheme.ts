import { computed, ref } from "vue";

import { STORAGE_KEYS } from "./constants";

type Theme = "light" | "dark";
type ThemePreference = Theme | "system";

function normalizeTheme(value: string | null): ThemePreference {
  if (value === "dark" || value === "system") return value;

  return "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

function resolveTheme(theme: ThemePreference): Theme {
  if (theme !== "system") return theme;

  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function useTheme() {
  const theme = ref<ThemePreference>(normalizeTheme(localStorage.getItem(STORAGE_KEYS.THEME)));
  const themeToggleLabel = computed(() => (resolveTheme(theme.value) === "dark" ? "Light" : "Dark"));

  applyTheme(resolveTheme(theme.value));

  function setTheme(nextTheme: ThemePreference) {
    theme.value = nextTheme;
    localStorage.setItem(STORAGE_KEYS.THEME, theme.value);
    applyTheme(resolveTheme(theme.value));
  }

  function toggleTheme() {
    setTheme(resolveTheme(theme.value) === "dark" ? "light" : "dark");
  }

  return {
    setTheme,
    theme,
    themeToggleLabel,
    toggleTheme,
  };
}
