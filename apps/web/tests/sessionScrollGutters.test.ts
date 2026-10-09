import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { sessionScrollGutters } from "../src/features/chat/sessionScrollGutters";

const base = { offsetWidth: 800, clientWidth: 783, clientLeft: 0, borderLeft: 0, borderRight: 0, overflowing: true, rtl: false };
describe("session dock scrollbar clearance", () => {
  it("excludes the real native right-hand gutter, even with RTL content", () => {
    assert.deepEqual(sessionScrollGutters(base), { left: 0, right: 17 });
    assert.deepEqual(sessionScrollGutters({ ...base, rtl: true }), { left: 0, right: 17 });
  });
  it("measures left-hand gutters without mistaking borders for scrollbars", () => {
    assert.deepEqual(sessionScrollGutters({ ...base, offsetWidth: 805, clientLeft: 19, borderLeft: 2, borderRight: 3, rtl: true }), { left: 17, right: 0 });
  });
  it("supports wider system gutters and stable gutters on both sides", () => {
    assert.deepEqual(sessionScrollGutters({ ...base, clientWidth: 770 }), { left: 0, right: 30 });
    assert.deepEqual(sessionScrollGutters({ ...base, clientWidth: 766, clientLeft: 17 }), { left: 17, right: 17 });
  });
  it("leaves overlay scrollbar edges clear in both directions", () => {
    assert.deepEqual(sessionScrollGutters({ ...base, clientWidth: 800 }), { left: 0, right: 16 });
    assert.deepEqual(sessionScrollGutters({ ...base, clientWidth: 800, rtl: true }), { left: 16, right: 0 });
  });
  it("does not reserve an absent rail but keeps a browser-reserved stable gutter", () => {
    assert.deepEqual(sessionScrollGutters({ ...base, clientWidth: 800, overflowing: false }), { left: 0, right: 0 });
    assert.deepEqual(sessionScrollGutters({ ...base, overflowing: false }), { left: 0, right: 17 });
  });
});
