import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";
import { effectScope } from "vue";

import { STORAGE_KEYS } from "../src/features/chat/constants";
import { useTheme } from "../src/features/chat/chatTheme";

beforeEach(() => {
  installDomGlobals();
});

describe("chat theme", () => {
  it("starts with light theme when nothing is saved", () => {
    const { theme, themeToggleLabel } = useTheme();

    assert.equal(theme.value, "light");
    assert.equal(themeToggleLabel.value, "Dark");
    assert.equal(document.documentElement.dataset.theme, "light");
  });

  it("toggles the document theme and persists it", () => {
    const { theme, themeToggleLabel, toggleTheme } = useTheme();

    toggleTheme();

    assert.equal(theme.value, "dark");
    assert.equal(themeToggleLabel.value, "Light");
    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(localStorage.getItem(STORAGE_KEYS.THEME), "dark");

    toggleTheme();

    assert.equal(theme.value, "light");
    assert.equal(themeToggleLabel.value, "Dark");
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(localStorage.getItem(STORAGE_KEYS.THEME), "light");
  });

  it("uses a saved dark theme on startup", () => {
    localStorage.setItem(STORAGE_KEYS.THEME, "dark");

    const { theme, themeToggleLabel } = useTheme();

    assert.equal(theme.value, "dark");
    assert.equal(themeToggleLabel.value, "Light");
    assert.equal(document.documentElement.dataset.theme, "dark");
  });

  it("supports the system theme preference", () => {
    localStorage.setItem(STORAGE_KEYS.THEME, "system");
    Object.defineProperty(globalThis, "matchMedia", {
      configurable: true,
      value: () => ({
        matches: true,
      }),
    });

    const { setTheme, theme, themeToggleLabel } = useTheme();

    assert.equal(theme.value, "system");
    assert.equal(themeToggleLabel.value, "Light");
    assert.equal(document.documentElement.dataset.theme, "dark");

    setTheme("light");

    assert.equal(localStorage.getItem(STORAGE_KEYS.THEME), "light");
    assert.equal(document.documentElement.dataset.theme, "light");
  });

  it("keeps the selected theme usable when persistence is blocked", () => {
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      get: () => {
        throw new DOMException("Storage is blocked", "SecurityError");
      },
    });

    const { setTheme, theme } = useTheme();

    assert.equal(theme.value, "light");
    assert.doesNotThrow(() => setTheme("dark"));
    assert.equal(theme.value, "dark");
    assert.equal(document.documentElement.dataset.theme, "dark");
  });

  it("updates a system theme live and removes its listener when the scope stops", () => {
    localStorage.setItem(STORAGE_KEYS.THEME, "system");
    const systemTheme = installSystemTheme(false);
    const scope = effectScope();
    const themeState = scope.run(() => useTheme());

    assert.ok(themeState);
    assert.equal(systemTheme.listenerCount(), 1);
    assert.equal(document.documentElement.dataset.theme, "light");
    assert.equal(themeState.themeToggleLabel.value, "Dark");

    systemTheme.setDark(true);

    assert.equal(document.documentElement.dataset.theme, "dark");
    assert.equal(themeState.themeToggleLabel.value, "Light");

    scope.stop();

    assert.equal(systemTheme.listenerCount(), 0);
    systemTheme.setDark(false);
    assert.equal(document.documentElement.dataset.theme, "dark");
  });
});

function installSystemTheme(initiallyDark: boolean) {
  let isDark = initiallyDark;
  const listeners = new Set<() => void>();
  const query = {
    get matches() {
      return isDark;
    },
    addEventListener: (event: string, listener: () => void) => {
      if (event === "change") listeners.add(listener);
    },
    removeEventListener: (event: string, listener: () => void) => {
      if (event === "change") listeners.delete(listener);
    },
  } as unknown as MediaQueryList;

  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => query,
  });

  return {
    listenerCount: () => listeners.size,
    setDark(nextValue: boolean) {
      isDark = nextValue;
      for (const listener of listeners) listener();
    },
  };
}

function installDomGlobals() {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (key) => store.get(key) ?? null,
    key: (index) => Array.from(store.keys())[index] ?? null,
    removeItem: (key) => store.delete(key),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
  };

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: memoryStorage,
  });

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      documentElement: {
        dataset: {},
      },
    },
  });

  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: undefined,
  });
}
