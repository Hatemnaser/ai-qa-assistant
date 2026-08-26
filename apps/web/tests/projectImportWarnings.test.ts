import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  PROJECT_IMPORT_WARNING_TRANSLATION_KEYS,
  localizeProjectImportWarning,
} from "../src/features/projects/projectImportWarnings.ts";
import { messages } from "../src/i18n/messages/index.ts";
import { setLocale } from "../src/i18n/useI18n.ts";

afterEach(() => {
  setLocale("en");
});

describe("project import warning localization", () => {
  it("localizes every known backend warning in every supported locale", () => {
    for (const locale of ["en", "ar", "de"] as const) {
      setLocale(locale);

      for (const [warning, translationKey] of Object.entries(
        PROJECT_IMPORT_WARNING_TRANSLATION_KEYS
      )) {
        assert.equal(
          localizeProjectImportWarning(warning),
          messages[locale][translationKey]
        );
        assert.notEqual(localizeProjectImportWarning(warning), translationKey);
      }
    }
  });

  it("keeps unknown package warnings visible", () => {
    setLocale("ar");

    assert.equal(
      localizeProjectImportWarning("A future project warning."),
      "A future project warning."
    );
  });
});
