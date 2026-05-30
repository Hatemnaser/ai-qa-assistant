import type { Project } from "../projects/types";
import type { Chat } from "./types";

export const CHAT_PROJECT_FILTER_ALL = "__all_chats__";
export const CHAT_PROJECT_FILTER_UNASSIGNED = "__unassigned_chats__";

export type ChatProjectFilter = string;

export interface ChatProjectFilterOption {
  count: number;
  label: string;
  value: ChatProjectFilter;
}

export function filterChatsByProject(chats: Chat[], filter: ChatProjectFilter) {
  if (filter === CHAT_PROJECT_FILTER_ALL) {
    return chats;
  }

  if (filter === CHAT_PROJECT_FILTER_UNASSIGNED) {
    return chats.filter((chat) => !chat.projectId);
  }

  return chats.filter((chat) => chat.projectId === filter);
}

export function isChatInProjectFilter(chat: Chat, filter: ChatProjectFilter) {
  return filterChatsByProject([chat], filter).length === 1;
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

export function getChatProjectFilterForProject(projectId: string | null) {
  return projectId || CHAT_PROJECT_FILTER_UNASSIGNED;
}

export function getChatProjectFilterOptions(chats: Chat[], projects: Project[]): ChatProjectFilterOption[] {
  return [
    {
      count: chats.length,
      label: "All chats",
      value: CHAT_PROJECT_FILTER_ALL,
    },
    {
      count: filterChatsByProject(chats, CHAT_PROJECT_FILTER_UNASSIGNED).length,
      label: "Unassigned",
      value: CHAT_PROJECT_FILTER_UNASSIGNED,
    },
    ...projects.map((project) => ({
      count: filterChatsByProject(chats, project.id).length,
      label: project.name,
      value: project.id,
    })),
  ];
}

export function getProjectNameById(projects: Project[], projectId: string | null) {
  if (!projectId) return null;

  return projects.find((project) => project.id === projectId)?.name || null;
}
