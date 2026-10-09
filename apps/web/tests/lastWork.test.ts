import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { canRestoreLastWork, readLastWork, saveLastWork, readWorkspaceNavigation, resolveLastWork, saveWorkspaceNavigation } from "../src/router/lastWork";

const allowed = {
  projectIds: new Set(["p1", "p2"]),
  chats: [{ id: "c1", projectId: "p1" }, { id: "c2", projectId: null }],
  tests: [{ id: "s1", projectId: "p1", requestIds: ["r1", "r2"] }, { id: "request:old", projectId: "p2", requestId: "old" }],
};

describe("owner-scoped last work", () => {
  it("keeps one last session, migrates the older hint, and saves IDs only", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
    saveLastWork(storage, "owner-a", { view: "tests", projectId: "p2", requestId: "old" });
    assert.equal(readWorkspaceNavigation(storage, "owner-a").last?.requestId, "old");
    const chat = { view: "conversations" as const, page: "projects" as const, projectId: "p1", content: "private draft" };
    saveWorkspaceNavigation(storage, "owner-a", { activeView: "conversations", conversations: chat, tests: { view: "tests", projectId: "p2", requestId: "old" }, qaProjectFilter: "p1" });
    const saved = readWorkspaceNavigation(storage, "owner-a");
    assert.equal(saved.last?.projectId, "p1");
    assert.equal(saved.last?.page, "projects");
    assert.equal(saved.tests, undefined);
    assert.equal(saved.qaProjectFilter, undefined);
    assert.ok(![...data.values()].some(value => value.includes("private draft")));
    assert.deepEqual(readWorkspaceNavigation(storage, "owner-b"), { activeView: "conversations" });
    assert.deepEqual(readWorkspaceNavigation({ ...storage, getItem: () => "{broken" }, "a"), { activeView: "conversations" });
  });
  it("isolates accounts and safely handles corrupt or unavailable storage", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
    saveLastWork(storage, "owner-a", { view: "tests", projectId: "p1", sessionId: "s1" });
    assert.deepEqual(readLastWork(storage, "owner-a"), { view: "tests", projectId: "p1", sessionId: "s1" });
    assert.equal(readLastWork(storage, "owner-b"), null);
    assert.equal(readLastWork({ ...storage, getItem: () => "{broken" }, "owner-a"), null);
    assert.equal(readLastWork({ ...storage, getItem: () => '{"view":"tests","projectId":42}' }, "owner-a"), null);
    assert.doesNotThrow(() => saveLastWork({ ...storage, setItem: () => { throw new Error("disabled"); } }, "a", { view: "tests" }));
  });

  it("reads the prior two-destination format only as a migration hint", () => {
    const data = new Map<string, string>([["oddpath:navigation:v2:owner-a", JSON.stringify({ activeView: "tests",
      conversations: { view: "conversations", page: "chat", chatId: "c1", projectId: "p1" },
      tests: { view: "tests", projectId: "p2", requestId: "old" }, qaProjectFilter: "p1" })]]);
    const storage = { getItem: (key: string) => data.get(key) || null, setItem: (key: string, value: string) => { data.set(key, value); } };
    assert.deepEqual(readWorkspaceNavigation(storage, "owner-a").last, { view: "tests", projectId: "p2", requestId: "old" });
    saveWorkspaceNavigation(storage, "owner-a", readWorkspaceNavigation(storage, "owner-a"));
    assert.ok(data.has("oddpath:navigation:v3:owner-a"));
    assert.ok(!data.get("oddpath:navigation:v3:owner-a")?.includes("qaProjectFilter"));
  });

  it("restores only server-authorized session and request combinations", () => {
    assert.equal(canRestoreLastWork({ view: "tests", projectId: "p1", sessionId: "s1", requestId: "r2" }, allowed), true);
    assert.equal(canRestoreLastWork({ view: "tests", projectId: "p2", requestId: "old" }, allowed), true);
    assert.equal(canRestoreLastWork({ view: "tests" }, allowed), true);
    for (const work of [
      { view: "tests" as const, projectId: "foreign", sessionId: "s1" },
      { view: "tests" as const, projectId: "p2", sessionId: "s1" },
      { view: "tests" as const, projectId: "p1", sessionId: "s1", requestId: "old" },
      { view: "tests" as const, sessionId: "s1" },
      { view: "tests" as const, projectId: "p1", requestId: "old" },
    ]) assert.equal(canRestoreLastWork(work, allowed), false);
  });

  it("checks ordinary chat ownership and its project without demanding a project for guest-style chats", () => {
    assert.equal(canRestoreLastWork({ view: "conversations", projectId: "p1", chatId: "c1" }, allowed), true);
    assert.equal(canRestoreLastWork({ view: "conversations", chatId: "c2" }, allowed), true);
    assert.equal(canRestoreLastWork({ view: "conversations", projectId: "p2", chatId: "c1" }, allowed), false);
    assert.equal(canRestoreLastWork({ view: "conversations", chatId: "foreign" }, allowed), false);
  });
});

describe("saved destinations resolved from owned detail", () => {
  const session = { id: "saved", projectId: "project", requests: [{ id: "earlier", projectId: "project" }] };
  const reads = () => ({
    session: async (_id: string) => session,
    request: async (projectId: string, id: string) => ({ id, projectId }),
    project: async (_projectId: string) => { throw new Error("A session read already authorizes its project"); },
    current: () => true,
  });

  it("restores an owned session outside the list and preserves an earlier request", async () => {
    const work = { view: "conversations" as const, page: "chat" as const, chatId: "saved", requestId: "earlier" };
    assert.deepEqual(await resolveLastWork(work, reads()), { ...work, projectId: "project" });
  });

  it("restores projectless and legacy saved session hints without requiring a list", async () => {
    const work = { view: "tests" as const, sessionId: "saved" };
    assert.deepEqual(await resolveLastWork(work, reads()), { ...work, projectId: "project" });
    assert.deepEqual(await resolveLastWork(work, { ...reads(), session: async () => ({ ...session, projectId: null, requests: [] }) }),
      { ...work, projectId: undefined });
  });

  it("rejects changed explicit project, foreign request, and mismatched detail identity", async () => {
    const work = { view: "conversations" as const, chatId: "saved" };
    assert.equal(await resolveLastWork({ ...work, projectId: "other" }, reads()), null);
    assert.equal(await resolveLastWork({ ...work, requestId: "foreign" }, reads()), null);
    assert.equal(await resolveLastWork(work, { ...reads(), session: async () => ({ ...session, id: "other" }) }), null);
    assert.equal(await resolveLastWork({ ...work, sessionId: "different" }, reads()), null);
    assert.equal(await resolveLastWork({ ...work, requestId: "earlier" }, { ...reads(), request: async () => ({ id: "earlier", projectId: "other" }) }), null);
  });

  it("invalidates confirmed missing or forbidden destinations but preserves transient failures", async () => {
    const work = { view: "conversations" as const, chatId: "saved" };
    for (const status of [403, 404, 410]) {
      assert.equal(await resolveLastWork(work, { ...reads(), session: async () => { throw Object.assign(new Error("Unavailable"), { status }); } }), null);
    }
    for (const status of [401, 429, 500, 503, undefined]) {
      const error = Object.assign(new Error("Retryable"), { status });
      await assert.rejects(resolveLastWork(work, { ...reads(), session: async () => { throw error; } }), error);
    }
  });

  it("discards late results and stops subsequent reads after navigation or owner changes", async () => {
    let current = true;
    let finish!: (value: typeof session) => void;
    let requestReads = 0;
    const pending = resolveLastWork({ view: "conversations", chatId: "saved", requestId: "earlier" }, {
      ...reads(), current: () => current, session: () => new Promise(resolve => { finish = resolve; }),
      request: async () => { requestReads++; return { id: "earlier", projectId: "project" }; },
    });
    current = false; finish(session);
    assert.equal(await pending, null);
    assert.equal(requestReads, 0);
  });

  it("authorizes legacy unlinked QA and project-only destinations through their existing detail reads", async () => {
    const legacy = { view: "tests" as const, projectId: "project", requestId: "old" };
    assert.deepEqual(await resolveLastWork(legacy, reads()), legacy);
    const project = { view: "conversations" as const, page: "projects" as const, projectId: "project" };
    const readProjects: string[] = [];
    assert.deepEqual(await resolveLastWork(project, { ...reads(), project: async id => { readProjects.push(id); } }), project);
    assert.deepEqual(readProjects, ["project"]);
  });
});
