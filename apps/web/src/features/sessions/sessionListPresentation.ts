import type { Chat } from "../chat/types";
import type { Project } from "../projects/types";
import type { SidebarTestItem } from "../test-sessions/navigation";

type SessionListBase = {
  id: string;
  title: string;
  projectId: string | null;
  updatedAt: string;
  archivedAt: string | null;
};

export type SessionListEntry = SessionListBase & (
  | { kind: "chat"; chat: Chat }
  | { kind: "session"; item: SidebarTestItem }
);

export interface SessionListBucket {
  active: SessionListEntry[];
  archived: SessionListEntry[];
}

export type SessionListProject = Pick<Project, "id" | "name">;

export interface ProjectSessionList<P extends SessionListProject = SessionListProject> extends SessionListBucket {
  project: P;
}

export interface UnavailableProjectSessionList extends SessionListBucket {
  projectId: string;
}

export interface PartitionedSessionList<P extends SessionListProject = SessionListProject> {
  entries: SessionListEntry[];
  projectGroups: ProjectSessionList<P>[];
  standalone: SessionListBucket;
  unavailableProjectGroups: UnavailableProjectSessionList[];
}

/** Only unarchived conversations without QA records can change project membership. */
export function movableProjectChats(input: {
  chats?: readonly Chat[];
  sessions?: readonly SidebarTestItem[];
  projectId: string;
}): SessionListEntry[] {
  return partitionSessionList({ ...input, projects: [] }).entries.filter(entry =>
    entry.projectId !== input.projectId && !entry.archivedAt &&
    (entry.kind === "chat" || (!entry.id.startsWith("request:") && !entry.item.requestId && !entry.item.requestIds?.length))
  );
}

/** Presentation only. Membership never depends on disclosure state or session titles. */
export function partitionSessionList<P extends SessionListProject>(input: {
  chats?: readonly Chat[];
  sessions?: readonly SidebarTestItem[];
  projects: readonly P[];
}): PartitionedSessionList<P> {
  const byId = new Map<string, SessionListEntry>();
  for (const chat of input.chats || []) {
    if (!chat.id) continue;
    const entry: SessionListEntry = { kind: "chat", id: chat.id, title: chat.title,
      projectId: chat.projectId || null, updatedAt: chat.updatedAt, archivedAt: null, chat };
    const previous = byId.get(entry.id);
    if (!previous || entry.updatedAt > previous.updatedAt) byId.set(entry.id, entry);
  }
  for (const item of input.sessions || []) {
    if (!item.id) continue;
    const entry: SessionListEntry = { kind: "session", id: item.id, title: item.title,
      projectId: item.projectId || null, updatedAt: item.updatedAt || "", archivedAt: item.archivedAt || null, item };
    const previous = byId.get(entry.id);
    // The owned server index takes precedence over a legacy local representation.
    if (!previous || previous.kind === "chat" || entry.updatedAt > previous.updatedAt) byId.set(entry.id, entry);
  }
  const entries = [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || b.id.localeCompare(a.id));
  const projectGroups = input.projects.map(project => ({ project, active: [] as SessionListEntry[], archived: [] as SessionListEntry[] }));
  const projectsById = new Map(projectGroups.map(group => [group.project.id, group]));
  const standalone: SessionListBucket = { active: [], archived: [] };
  const unavailable = new Map<string, UnavailableProjectSessionList>();
  for (const entry of entries) {
    let bucket: SessionListBucket;
    if (!entry.projectId) bucket = standalone;
    else if (projectsById.has(entry.projectId)) bucket = projectsById.get(entry.projectId)!;
    else {
      let group = unavailable.get(entry.projectId);
      if (!group) { group = { projectId: entry.projectId, active: [], archived: [] }; unavailable.set(entry.projectId, group); }
      bucket = group;
    }
    (entry.archivedAt ? bucket.archived : bucket.active).push(entry);
  }
  return { entries, projectGroups, standalone, unavailableProjectGroups: [...unavailable.values()] };
}
