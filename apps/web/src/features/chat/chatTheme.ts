import { computed, ref } from "vue";

import { STORAGE_KEYS } from "./constants";

type Theme = "light" | "dark";

function normalizeTheme(value: string | null): Theme {
  return value === "dark" ? "dark" : "light";
}

function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
}

export function useTheme() {
  const theme = ref<Theme>(normalizeTheme(localStorage.getItem(STORAGE_KEYS.THEME)));
  const themeToggleLabel = computed(() => (theme.value === "dark" ? "Light" : "Dark"));

  applyTheme(theme.value);

  function toggleTheme() {
    theme.value = theme.value === "dark" ? "light" : "dark";
    localStorage.setItem(STORAGE_KEYS.THEME, theme.value);
    applyTheme(theme.value);
  }

  return {
    theme,
    themeToggleLabel,
    toggleTheme,
  };
}
