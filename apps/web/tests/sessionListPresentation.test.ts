import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createChat } from "../src/features/chat/chatStorage";
import { movableProjectChats, partitionSessionList } from "../src/features/sessions/sessionListPresentation";
import type { SidebarTestItem } from "../src/features/test-sessions/navigation";

const row = (id: string, projectId = "", archivedAt: string | null = null, updatedAt = "2026-10-04T12:00:00Z"): SidebarTestItem => ({ id, projectId, title: id, archivedAt, updatedAt });
const projects = [{ id: "a", name: "Project A" }, { id: "b", name: "Project B" }];

describe("one identity-based session list", () => {
  it("offers only movable unified conversations in Add chats, preferring server QA membership over local copies", () => {
    const sessions = [row("free"), row("other", "b"), row("already", "a"), row("archived", "b", "2026-10-04"),
      { ...row("linked", "b"), requestIds: ["qa-record"] }, { ...row("legacy-link", "b"), requestId: "qa-record" }, row("request:old", "b")];
    const chats = [createChat({ id: "linked", projectId: null }), createChat({ id: "guest", projectId: null })];
    const available = movableProjectChats({ sessions, chats, projectId: "a" });
    assert.deepEqual(new Set(available.map(item => item.id)), new Set(["free", "other", "guest"]));
    assert.equal(available.find(item => item.id === "free")?.kind, "session");
    assert.equal(available.find(item => item.id === "guest")?.kind, "chat");
    assert.equal(sessions[1]?.projectId, "b", "candidate presentation must not move data");
  });
  it("partitions active and archived project and projectless sessions exactly once", () => {
    const sessions = [row("in-a", "a"), row("in-b", "b"), row("standalone"), row("archive-a", "a", "2026-10-04"), row("archive-free", "", "2026-10-04")];
    const list = partitionSessionList({ sessions, projects });
    assert.deepEqual(list.standalone.active.map(item => item.id), ["standalone"]);
    assert.deepEqual(list.standalone.archived.map(item => item.id), ["archive-free"]);
    assert.deepEqual(list.projectGroups[0]?.active.map(item => item.id), ["in-a"]);
    assert.deepEqual(list.projectGroups[0]?.archived.map(item => item.id), ["archive-a"]);
    const all = [...list.standalone.active, ...list.standalone.archived, ...list.projectGroups.flatMap(group => [...group.active, ...group.archived])];
    assert.equal(new Set(all.map(item => item.id)).size, sessions.length);
  });
  it("deduplicates stable IDs with authoritative server membership and archives", () => {
    const chat = createChat({ id: "same", title: "Legacy", projectId: "b" });
    const list = partitionSessionList({ chats: [chat, chat], sessions: [row("same", "a", "2026-10-04"), row("same", "a", "2026-10-04")], projects });
    assert.equal(list.entries.length, 1);
    assert.equal(list.entries[0]?.kind, "session");
    assert.equal(list.projectGroups[0]?.archived[0]?.id, "same");
    assert.deepEqual(list.projectGroups[1]?.active, []);
  });
  it("keeps unknown-project records in recovery rather than Recent", () => {
    const list = partitionSessionList({ sessions: [row("lost", "missing"), row("lost-archive", "missing", "2026-10-04"), row("free")], projects: [] });
    assert.deepEqual(list.standalone.active.map(item => item.id), ["free"]);
    assert.equal(list.unavailableProjectGroups.length, 1);
    assert.deepEqual(list.unavailableProjectGroups[0]?.active.map(item => item.id), ["lost"]);
    assert.deepEqual(list.unavailableProjectGroups[0]?.archived.map(item => item.id), ["lost-archive"]);
  });
  it("retains legacy request markers and does not merge same titles", () => {
    const sessions = [row("request:q1", "a"), { ...row("linked", "a"), title: "request:q1" }];
    const list = partitionSessionList({ sessions, projects });
    assert.equal(list.projectGroups[0]?.active.length, 2);
    assert.equal(list.entries.find(item => item.id === "request:q1")?.kind, "session");
  });
  it("moves an unlinked row between buckets without mutating inputs or rewriting titles", () => {
    const original = row("session", "a");
    const before = partitionSessionList({ sessions: [original], projects });
    const after = partitionSessionList({ sessions: [{ ...original, projectId: "" }], projects });
    assert.equal(before.projectGroups[0]?.active.length, 1);
    assert.deepEqual(after.projectGroups[0]?.active, []);
    assert.equal(after.standalone.active[0]?.title, original.title);
    assert.equal(original.projectId, "a");
  });
  it("supports guest chats and stable tie ordering without project membership guessing", () => {
    const one = createChat({ id: "a", title: "Project A — a normal title", projectId: null });
    const two = { ...createChat({ id: "b", projectId: null }), updatedAt: one.updatedAt };
    const list = partitionSessionList({ chats: [one, two], projects });
    assert.deepEqual(list.standalone.active.map(item => item.id), ["b", "a"]);
    assert.deepEqual(list.projectGroups[0]?.active, []);
  });
});
