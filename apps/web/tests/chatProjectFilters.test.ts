import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  CHAT_PROJECT_FILTER_ALL,
  CHAT_PROJECT_FILTER_UNASSIGNED,
  filterChatsByProject,
  getProjectIdForNewChat,
  getProjectNameById,
  isProjectFilterAvailable,
} from "../src/features/chat/chatProjectFilters";
import { createChat } from "../src/features/chat/chatStorage";
import type { Project } from "../src/features/projects/types";

describe("chat project filters", () => {
  it("filters chats by all, unassigned, and project scopes", () => {
    const unassignedChat = createChat({ id: "chat-1", projectId: null });
    const checkoutChat = createChat({ id: "chat-2", projectId: "project-checkout" });
    const loginChat = createChat({ id: "chat-3", projectId: "project-login" });
    const chats = [unassignedChat, checkoutChat, loginChat];

    assert.deepEqual(
      filterChatsByProject(chats, CHAT_PROJECT_FILTER_ALL).map((chat) => chat.id),
      ["chat-1", "chat-2", "chat-3"]
    );
    assert.deepEqual(
      filterChatsByProject(chats, CHAT_PROJECT_FILTER_UNASSIGNED).map((chat) => chat.id),
      ["chat-1"]
    );
    assert.deepEqual(
      filterChatsByProject(chats, "project-checkout").map((chat) => chat.id),
      ["chat-2"]
    );
  });

  it("uses only project filters as the next chat project", () => {
    assert.equal(getProjectIdForNewChat(CHAT_PROJECT_FILTER_ALL), null);
    assert.equal(getProjectIdForNewChat(CHAT_PROJECT_FILTER_UNASSIGNED), null);
    assert.equal(getProjectIdForNewChat("project-checkout"), "project-checkout");
  });

  it("validates and names available project filters", () => {
    const projects: Project[] = [
      {
        id: "project-checkout",
        name: "Checkout QA",
        description: null,
        role: "OWNER",
        createdAt: "2026-05-30T00:00:00.000Z",
        updatedAt: "2026-05-30T00:00:00.000Z",
      },
    ];

    assert.equal(isProjectFilterAvailable(CHAT_PROJECT_FILTER_ALL, projects), true);
    assert.equal(isProjectFilterAvailable(CHAT_PROJECT_FILTER_UNASSIGNED, projects), true);
    assert.equal(isProjectFilterAvailable("project-checkout", projects), true);
    assert.equal(isProjectFilterAvailable("project-missing", projects), false);
    assert.equal(getProjectNameById(projects, "project-checkout"), "Checkout QA");
    assert.equal(getProjectNameById(projects, "project-missing"), null);
  });
});
