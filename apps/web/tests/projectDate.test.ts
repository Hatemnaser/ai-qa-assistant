import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatRelativeDate } from "../src/features/projects/projectDate";

describe("project date formatting", () => {
  const now = new Date("2026-06-05T12:00:00.000Z").getTime();

  it("formats very recent timestamps as just now", () => {
    assert.equal(formatRelativeDate("2026-06-05T11:59:35.000Z", now), "just now");
  });

  it("formats recent timestamps as relative time", () => {
    assert.equal(formatRelativeDate("2026-06-05T11:15:00.000Z", now), "45 minutes ago");
    assert.equal(formatRelativeDate("2026-06-04T12:00:00.000Z", now), "yesterday");
  });

  it("falls back to a medium date for older timestamps", () => {
    assert.match(formatRelativeDate("2026-05-20T12:00:00.000Z", now), /May 20, 2026|20 May 2026/);
  });
});
