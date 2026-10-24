import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MODEL,
  AUTO_MODEL,
  getModelForMode,
  supportsImages,
  supportsTextAttachments,
} from "../src/features/chat/constants";

describe("chat model catalog", () => {
  it("exposes attachment capabilities for the default model", () => {
    assert.equal(supportsImages(DEFAULT_MODEL), true);
    assert.equal(supportsTextAttachments(DEFAULT_MODEL), true);
  });

  it("preserves explicit and Auto selections for visual review", () => {
    assert.equal(getModelForMode("screenshot_review", DEFAULT_MODEL), DEFAULT_MODEL);
    assert.equal(getModelForMode("screenshot_review", AUTO_MODEL), AUTO_MODEL);
    assert.equal(supportsImages(AUTO_MODEL), true);
    assert.equal(getModelForMode("general", "removed-model"), "removed-model");
    assert.equal(supportsImages("removed-model"), false);
  });
});
