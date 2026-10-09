import type { TestRouteScope } from "./useAppRoute";

export interface LastWork extends TestRouteScope {
  view: "tests" | "conversations";
  chatId?: string;
  page?: "home" | "chat" | "projects";
}

export type WorkView = LastWork["view"];
export interface WorkspaceNavigation {
  activeView: WorkView;
  last?: LastWork;
  conversations?: LastWork;
  tests?: LastWork;
  qaProjectFilter?: string;
}
const navigationKey = (ownerId: string) => `oddpath:navigation:v3:${encodeURIComponent(ownerId)}`;
const previousNavigationKey = (ownerId: string) => `oddpath:navigation:v2:${encodeURIComponent(ownerId)}`;

function parseDestination(value: unknown, view: WorkView): LastWork | undefined {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (item.view !== view) return undefined;
  const result: LastWork = { view };
  for (const field of ["projectId", "chatId", "sessionId", "requestId"] as const) {
    const id = item[field];
    if (id === undefined) continue;
    if (typeof id !== "string" || !id || id.length > 256 || /[\u0000-\u001f\u007f]/.test(id)) return undefined;
    result[field] = id;
  }
  if (item.page !== undefined) {
    if (item.page !== "home" && item.page !== "chat" && item.page !== "projects") return undefined;
    result.page = item.page;
  }
  return result;
}

export function readWorkspaceNavigation(storage: StoragePort, ownerId: string): WorkspaceNavigation {
  try {
    const raw = storage.getItem(navigationKey(ownerId));
    if (raw) {
      const item = JSON.parse(raw) as WorkspaceNavigation;
      const view = item?.last?.view;
      const last = view === "tests" || view === "conversations" ? parseDestination(item.last, view) : undefined;
      if (last) return { activeView: last.view, last, [last.view]: last };
    }
    const previousRaw = storage.getItem(previousNavigationKey(ownerId));
    if (previousRaw) {
      const item = JSON.parse(previousRaw) as WorkspaceNavigation;
      if (item && (item.activeView === "tests" || item.activeView === "conversations")) {
        const last = parseDestination(item[item.activeView], item.activeView);
        return last ? { activeView: last.view, last, [last.view]: last } : { activeView: "conversations" };
      }
    }
    const legacy = readLastWork(storage, ownerId);
    return legacy ? { activeView: legacy.view, last: legacy, [legacy.view]: legacy } : { activeView: "conversations" };
  } catch { return { activeView: "conversations" }; }
}

export function saveWorkspaceNavigation(storage: StoragePort, ownerId: string, state: WorkspaceNavigation): void {
  try {
    const last = state.last || state[state.activeView];
    if (!last) return;
    // Persist IDs only, never drafts, titles, transcripts, attachments or credentials.
    storage.setItem(navigationKey(ownerId), JSON.stringify({ last: parseDestination(last, last.view) }));
  } catch { /* Storage is optional. */ }
}

interface StoragePort { getItem(key: string): string | null; setItem(key: string, value: string): void; }
const keyFor = (ownerId: string) => `oddpath:last-work:v1:${encodeURIComponent(ownerId)}`;

export function readLastWork(storage: StoragePort, ownerId: string): LastWork | null {
  try {
    const value: unknown = JSON.parse(storage.getItem(keyFor(ownerId)) || "null");
    if (!value || typeof value !== "object") return null;
    const item = value as Record<string, unknown>;
    if (item.view !== "tests" && item.view !== "conversations") return null;
    const result: LastWork = { view: item.view };
    for (const key of ["projectId", "sessionId", "requestId", "chatId"] as const) {
      if (item[key] === undefined) continue;
      if (typeof item[key] !== "string" || !item[key] || item[key].length > 256 || /[\u0000-\u001f\u007f]/.test(item[key])) return null;
      result[key] = item[key];
    }
    return result;
  } catch { return null; }
}

export function saveLastWork(storage: StoragePort, ownerId: string, work: LastWork): void {
  try { storage.setItem(keyFor(ownerId), JSON.stringify(work)); } catch { /* Storage is optional. */ }
}

interface LastWorkReads {
  session(id: string): Promise<{ id: string; projectId: string | null; requests: Array<{ id: string; projectId: string }> }>;
  request(projectId: string, id: string): Promise<{ id: string; projectId: string }>;
  project(projectId: string): Promise<unknown>;
  current(): boolean;
}

/** Resolve a saved hint using owned detail reads, independently of capped lists. */
export async function resolveLastWork(work: LastWork, reads: LastWorkReads): Promise<LastWork | null> {
  if (work.chatId && work.sessionId && work.chatId !== work.sessionId) return null;
  const sessionId = work.sessionId || work.chatId;
  let projectId = work.projectId;
  try {
    if (sessionId) {
      const session = await reads.session(sessionId);
      if (!reads.current()) return null;
      if (session.id !== sessionId || (projectId && session.projectId !== projectId)) return null;
      // Only omitted scope may be inferred. Never silently move an explicit
      // project/request destination because a session has since moved.
      projectId = session.projectId || undefined;
      if (work.requestId && !session.requests.some(request => request.id === work.requestId && request.projectId === projectId)) return null;
    }
    if (work.requestId) {
      if (!projectId) return null;
      const request = await reads.request(projectId, work.requestId);
      if (!reads.current()) return null;
      if (request.id !== work.requestId || request.projectId !== projectId) return null;
    } else if (projectId && !sessionId) {
      await reads.project(projectId);
      if (!reads.current()) return null;
    }
    return { ...work, projectId };
  } catch (error) {
    if (!reads.current()) return null;
    const status = error && typeof error === "object" && "status" in error ? error.status : undefined;
    // Network/server/authentication failures are retryable; only a confirmed
    // missing or inaccessible destination invalidates the stored hint.
    if (status === 403 || status === 404 || status === 410) return null;
    throw error;
  }
}

// A stored destination is only a hint. Authorize it against current server data,
// never against owner IDs embedded in local storage or a previous account cache.
export function canRestoreLastWork(work: LastWork, allowed: {
  projectIds: Set<string>;
  chats: Array<{ id: string; projectId: string | null }>;
  tests: Array<{ id: string; projectId: string; requestIds?: string[]; requestId?: string }>;
}): boolean {
  if (work.projectId && !allowed.projectIds.has(work.projectId)) return false;
  if (work.view === "conversations") {
    return !work.chatId || allowed.chats.some((item) => item.id === work.chatId && (item.projectId || undefined) === work.projectId) ||
      allowed.tests.some((item) => item.id === work.chatId && (item.projectId || undefined) === work.projectId && (!work.requestId || item.requestIds?.includes(work.requestId)));
  }
  if (!work.projectId) return !work.sessionId && !work.requestId;
  if (work.sessionId) return allowed.tests.some((item) => item.id === work.sessionId && item.projectId === work.projectId && (!work.requestId || item.requestIds?.includes(work.requestId)));
  return !work.requestId || allowed.tests.some((item) => item.projectId === work.projectId && (item.requestId === work.requestId || item.requestIds?.includes(work.requestId!)));
}
