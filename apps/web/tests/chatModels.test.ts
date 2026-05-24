import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_MODEL,
  getModelForMode,
  supportsImages,
  supportsTextAttachments,
} from "../src/features/chat/constants";

describe("chat model catalog", () => {
  it("exposes attachment capabilities for the default model", () => {
    assert.equal(supportsImages(DEFAULT_MODEL), true);
    assert.equal(supportsTextAttachments(DEFAULT_MODEL), true);
  });

  it("keeps visual review on an image-capable model", () => {
    assert.equal(getModelForMode("screenshot_review", DEFAULT_MODEL), "gemini-2.5-flash");
  });
});
