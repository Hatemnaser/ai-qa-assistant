import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveApiBaseUrl } from "../src/config/api.ts";

describe("web API configuration", () => {
  it("keeps an empty base URL available for the local Vite proxy", () => {
    assert.equal(resolveApiBaseUrl(undefined, false), "");
  });

  it("requires an exact HTTPS origin in production", () => {
    assert.equal(
      resolveApiBaseUrl("https://api.oddpath.eluthira.com", true),
      "https://api.oddpath.eluthira.com"
    );

    for (const invalidValue of [
      undefined,
      "http://api.oddpath.eluthira.com",
      "https://api.oddpath.eluthira.com/",
      "https://api.oddpath.eluthira.com/path",
      "https://api.oddpath.eluthira.com?preview=true",
    ]) {
      assert.throws(() => resolveApiBaseUrl(invalidValue, true), /VITE_API_BASE_URL/);
    }
  });
});
