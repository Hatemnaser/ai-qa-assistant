import assert from "node:assert/strict";
import { it } from "node:test";
import { filterTestNavigation } from "../src/features/test-sessions/navigation";

it("filters and orders a QA index without mutating sessions, selections, or mixing archives", () => {
  const items = [
    { id: "a", projectId: "p1", title: "A", updatedAt: "2026-09-01" },
    { id: "b", projectId: "p2", title: "B", updatedAt: "2026-09-03" },
    { id: "request:legacy", requestId: "legacy", projectId: "p1", title: "Old", updatedAt: "2026-09-02" },
    { id: "archived", projectId: "p1", title: "Archive", archivedAt: "2026-09-04", updatedAt: "2026-09-04" },
  ];
  const before = JSON.stringify(items);
  assert.deepEqual(filterTestNavigation(items).map(item => item.id), ["b", "request:legacy", "a"]);
  assert.deepEqual(filterTestNavigation(items, "p1").map(item => item.id), ["request:legacy", "a"]);
  assert.deepEqual(filterTestNavigation(items, "p1", true).map(item => item.id), ["archived"]);
  assert.deepEqual(filterTestNavigation(items, "deleted"), []);
  assert.equal(JSON.stringify(items), before);
});
