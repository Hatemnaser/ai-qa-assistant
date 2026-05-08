import { STORAGE_KEYS } from "./constants.js";

export function initThemeToggle() {
  const themeToggle = document.querySelector("#theme-toggle");

  function updateThemeButton(theme) {
    themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
  }

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.dataset.theme;
    const nextTheme = currentTheme === "dark" ? "light" : "dark";

    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(STORAGE_KEYS.THEME, nextTheme);
    updateThemeButton(nextTheme);
  });

  const savedTheme = localStorage.getItem(STORAGE_KEYS.THEME) || "light";
  document.documentElement.dataset.theme = savedTheme;
  updateThemeButton(savedTheme);
}
