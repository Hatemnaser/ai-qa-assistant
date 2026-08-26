import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const webRoot = path.resolve(import.meta.dirname, "..");

describe("chat AI disclosure", () => {
  it("keeps a visible translated AI notice beside every shared composer", async () => {
    const composer = await readFile(
      path.join(webRoot, "src", "features", "chat", "components", "ChatComposer.vue"),
      "utf8"
    );

    assert.match(composer, /class="composer-ai-notice[^"\n]*"[^>]*role="note"/);
    assert.match(composer, /t\("chat\.composer\.aiNotice"\)/);

    for (const locale of ["en", "de", "ar"]) {
      const catalog = JSON.parse(
        await readFile(path.join(webRoot, "src", "i18n", "messages", locale, "chat.json"), "utf8")
      ) as Record<string, string>;
      assert.ok(catalog["chat.composer.aiNotice"]?.trim(), `${locale} AI notice must not be empty`);
    }
  });
});
