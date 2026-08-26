import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import { messages } from "../src/i18n/messages";
import { mergeMessageCatalogs } from "../src/i18n/messages/mergeMessageCatalogs";
import { resolveInitialLocale, useI18n } from "../src/i18n/useI18n";

beforeEach(() => {
  installDomGlobals();
});

afterEach(() => {
  const { setLocale } = useI18n();

  setLocale("en");
});

describe("i18n", () => {
  it("uses the first supported browser language when no preference is stored", () => {
    assert.equal(resolveInitialLocale(null, ["fr-FR", "de-DE", "en-US"]), "de");
    assert.equal(resolveInitialLocale(undefined, ["ar-SY", "de-DE"]), "ar");
  });

  it("keeps a valid saved preference ahead of the browser language", () => {
    assert.equal(resolveInitialLocale("en-US", ["de-DE"]), "en");
    assert.equal(resolveInitialLocale("unsupported", ["de-DE"]), "de");
    assert.equal(resolveInitialLocale(null, ["fr-FR"]), "en");
  });

  it("applies supported locale metadata to the document", () => {
    const { direction, locale, setLocale, t } = useI18n();

    setLocale("ar");

    assert.equal(locale.value, "ar");
    assert.equal(direction.value, "rtl");
    assert.equal(document.documentElement.lang, "ar");
    assert.equal(document.documentElement.dir, "rtl");
    assert.equal(document.documentElement.dataset.locale, "ar");
    assert.equal(localStorage.getItem("ai_qa_assistant_locale"), "ar");
    assert.equal(t("settings.language"), "اللغة");
  });

  it("falls back to English for unsupported locale values", () => {
    const { locale, setLocale, t } = useI18n();

    setLocale("fr-FR");

    assert.equal(locale.value, "en");
    assert.equal(document.documentElement.lang, "en");
    assert.equal(document.documentElement.dir, "ltr");
    assert.equal(t("settings.language"), "Language");
  });

  it("keeps interpolation placeholders aligned across locale catalogs", () => {
    const englishMessages = messages.en;

    for (const [locale, localeMessages] of Object.entries(messages)) {
      for (const key of Object.keys(englishMessages) as Array<keyof typeof englishMessages>) {
        assert.deepEqual(
          extractPlaceholders(localeMessages[key]),
          extractPlaceholders(englishMessages[key]),
          `${locale}.${key} must use the same placeholders as English`
        );
      }
    }
  });

  it("keeps locale keys aligned and translation values non-empty", () => {
    const englishKeys = Object.keys(messages.en).sort();

    for (const [locale, localeMessages] of Object.entries(messages)) {
      assert.deepEqual(
        Object.keys(localeMessages).sort(),
        englishKeys,
        `${locale} must use exactly the same keys as English`
      );

      for (const [key, value] of Object.entries(localeMessages)) {
        assert.ok(value.trim(), `${locale}.${key} must not be empty`);
      }
    }
  });

  it("rejects duplicate keys across domain catalogs", () => {
    assert.throws(
      () =>
        mergeMessageCatalogs(
          { "app.actions.save": "Save" },
          { "app.actions.save": "Store" }
        ),
      /Duplicate i18n message key: app\.actions\.save/
    );
  });
});

function extractPlaceholders(message: string) {
  return Array.from(message.matchAll(/\{(\w+)\}/g), (match) => match[1]).sort();
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
        dir: "",
        lang: "",
      },
    },
  });
}
