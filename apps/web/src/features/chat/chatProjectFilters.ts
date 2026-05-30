import type { Project } from "../projects/types";
import type { Chat } from "./types";

export const CHAT_PROJECT_FILTER_ALL = "__all_chats__";
export const CHAT_PROJECT_FILTER_UNASSIGNED = "__unassigned_chats__";

export type ChatProjectFilter = string;

export function filterChatsByProject(chats: Chat[], filter: ChatProjectFilter) {
  if (filter === CHAT_PROJECT_FILTER_ALL) {
    return chats;
  }

  if (filter === CHAT_PROJECT_FILTER_UNASSIGNED) {
    return chats.filter((chat) => !chat.projectId);
  }

  return chats.filter((chat) => chat.projectId === filter);
}

export function getProjectIdForNewChat(filter: ChatProjectFilter) {
  if (filter === CHAT_PROJECT_FILTER_ALL || filter === CHAT_PROJECT_FILTER_UNASSIGNED) {
    return null;
  }

  return filter;
}

export function isProjectFilterAvailable(filter: ChatProjectFilter, projects: Project[]) {
  if (filter === CHAT_PROJECT_FILTER_ALL || filter === CHAT_PROJECT_FILTER_UNASSIGNED) {
    return true;
  }

  return projects.some((project) => project.id === filter);
}

export function getProjectNameById(projects: Project[], projectId: string | null) {
  if (!projectId) return null;

  return projects.find((project) => project.id === projectId)?.name || null;
}
