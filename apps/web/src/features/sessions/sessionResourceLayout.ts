/** Per-browser-tab UX preferences only. Never store viewer grants, URLs or QA authority. */
export interface SessionLayoutScope { ownerId: string; projectId: string; sessionId: string }
export interface SessionResourceLayout { openIds: string[]; pinnedIds: string[]; selectedId: string | null; hidden: boolean }
type LayoutStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Entry = { scope: SessionLayoutScope; savedAt: number; layout: SessionResourceLayout };
export const SESSION_LAYOUT_KEY = 'oddpath.session-resource-layouts.v1';
const MAX_ENTRIES = 24, MAX_AGE_MS = 86_400_000, MAX_BYTES = 131072;
const resourceId = /^(?:sources|activity|(?:results|evidence|readiness|browser):[a-zA-Z0-9_-]{1,128})$/;
function storage(): LayoutStorage | null { try { return globalThis.sessionStorage ?? null; } catch { return null; } }
function validScope(value: unknown): value is SessionLayoutScope {
  if (!value || typeof value !== 'object') return false;
  const s = value as SessionLayoutScope;
  return [s.ownerId, s.projectId, s.sessionId].every(id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(id)) && s.ownerId !== 'guest';
}
export function sessionLayoutScopeKey(scope: SessionLayoutScope | null): string | null {
  return validScope(scope) ? JSON.stringify([scope.ownerId, scope.projectId, scope.sessionId]) : null;
}
function layout(value: unknown): SessionResourceLayout | null {
  if (!value || typeof value !== 'object') return null;
  const input = value as SessionResourceLayout;
  if (!Array.isArray(input.openIds) || !Array.isArray(input.pinnedIds) || typeof input.hidden !== 'boolean') return null;
  const openIds = [...new Set(input.openIds.filter(id => typeof id === 'string' && resourceId.test(id)))].slice(0, 12);
  const pinnedIds = [...new Set(input.pinnedIds.filter(id => openIds.includes(id)))];
  return { openIds, pinnedIds, selectedId: openIds.includes(input.selectedId || '') ? input.selectedId : openIds[0] || null, hidden: input.hidden };
}
function entries(store: LayoutStorage | null, now: number): Entry[] {
  try {
    const raw = store?.getItem(SESSION_LAYOUT_KEY);
    if (!raw || raw.length > MAX_BYTES) return [];
    const parsed = JSON.parse(raw);
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.entries) || parsed.entries.length > MAX_ENTRIES) return [];
    return parsed.entries.flatMap((entry: Entry) => {
      const clean = layout(entry?.layout);
      return clean && validScope(entry?.scope) && Number.isSafeInteger(entry.savedAt) && entry.savedAt <= now && now - entry.savedAt < MAX_AGE_MS
        ? [{ scope: { ownerId: entry.scope.ownerId, projectId: entry.scope.projectId, sessionId: entry.scope.sessionId }, savedAt: entry.savedAt, layout: clean }] : [];
    });
  } catch { return []; }
}
export function loadSessionResourceLayout(scope: SessionLayoutScope, store = storage(), now = Date.now()): SessionResourceLayout | null {
  const key = sessionLayoutScopeKey(scope);
  return key ? entries(store, now).find(entry => sessionLayoutScopeKey(entry.scope) === key)?.layout ?? null : null;
}
export function saveSessionResourceLayout(scope: SessionLayoutScope, value: SessionResourceLayout, store = storage(), now = Date.now()): boolean {
  const key = sessionLayoutScopeKey(scope), clean = layout(value);
  if (!key || !clean || !store) return false;
  try {
    const previous = entries(store, now).filter(entry => sessionLayoutScopeKey(entry.scope) !== key);
    // Copy the scope explicitly too: caller-provided fields are never serialized.
    previous.push({ scope: { ownerId: scope.ownerId, projectId: scope.projectId, sessionId: scope.sessionId }, savedAt: now, layout: clean });
    store.setItem(SESSION_LAYOUT_KEY, JSON.stringify({ schemaVersion: 1, entries: previous.slice(-MAX_ENTRIES) }));
    return true;
  } catch { return false; }
}
export function clearSessionResourceLayouts(ownerId: string, store = storage()): boolean {
  if (!store) return false;
  try {
    const remaining = entries(store, Date.now()).filter(entry => entry.scope.ownerId !== ownerId);
    if (remaining.length) store.setItem(SESSION_LAYOUT_KEY, JSON.stringify({ schemaVersion: 1, entries: remaining }));
    else store.removeItem(SESSION_LAYOUT_KEY);
    return true;
  } catch { return false; }
}
