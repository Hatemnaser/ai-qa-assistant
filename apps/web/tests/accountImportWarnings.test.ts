import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  ACCOUNT_IMPORT_WARNING_TRANSLATION_KEYS,
  localizeAccountImportWarning,
} from "../src/features/data-portability/accountImportWarnings.ts";
import { messages } from "../src/i18n/messages/index.ts";
import { setLocale } from "../src/i18n/useI18n.ts";

afterEach(() => {
  setLocale("en");
});

describe("account import warning localization", () => {
  it("localizes every known backend warning in every supported locale", () => {
    for (const locale of ["en", "ar", "de"] as const) {
      setLocale(locale);

      for (const [warning, translationKey] of Object.entries(
        ACCOUNT_IMPORT_WARNING_TRANSLATION_KEYS
      )) {
        assert.equal(
          localizeAccountImportWarning(warning),
          messages[locale][translationKey]
        );
        assert.notEqual(localizeAccountImportWarning(warning), translationKey);
      }
    }
  });

  it("keeps unknown package warnings visible instead of hiding them", () => {
    setLocale("ar");

    assert.equal(
      localizeAccountImportWarning("A future package warning."),
      "A future package warning."
    );
  });
});
