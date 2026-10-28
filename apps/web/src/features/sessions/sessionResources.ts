import { computed, ref, watch, toValue, type MaybeRefOrGetter } from 'vue';
import { loadSessionResourceLayout, saveSessionResourceLayout, sessionLayoutScopeKey, type SessionLayoutScope } from './sessionResourceLayout';
import type { QaRequestDetail } from '../qa/types';
import type { TestSessionDetail } from '../test-sessions/types';

export type SessionResourceKind = 'sources' | 'activity' | 'results' | 'evidence' | 'browser' | 'readiness';
export interface SessionResource {
  id: string;
  scopeKey: string;
  kind: SessionResourceKind;
  title?: string;
  requestId?: string;
  executionId?: string;
}

/** References only. QA lifecycle and authority remain in the existing controller. */
export function buildSessionResources(scopeKey: string, projectId: string, session: TestSessionDetail | null, request: QaRequestDetail | null): SessionResource[] {
  const resources: SessionResource[] = ['sources', 'activity'].map(kind => ({ id: kind, kind: kind as SessionResourceKind, scopeKey }));
  const requests = session?.projectId === projectId ? session.requests : request?.projectId === projectId ? [request] : [];
  for (const item of requests.filter(item => item.projectId === projectId)) {
    for (const kind of ['results', 'evidence', 'readiness'] as const) resources.push({ id: `${kind}:${item.id}`, kind, scopeKey, requestId: item.id, title: item.title });
  }
  const execution = request?.runs[0]?.executionJob;
  if (request?.projectId === projectId && (!session || session.currentRequestId === request.id) && execution) {
    resources.push({ id: `browser:${execution.id}`, kind: 'browser', scopeKey, requestId: request.id, executionId: execution.id, title: request.title });
  }
  return resources;
}

export function useSessionResources(scopeKey: MaybeRefOrGetter<string>, catalog: MaybeRefOrGetter<SessionResource[]>, options?: {
  persistenceScope: MaybeRefOrGetter<SessionLayoutScope | null>; ready: MaybeRefOrGetter<boolean>;
}) {
  let loadedKey: string | null = null;
  const persistenceScope = computed(() => options ? toValue(options.persistenceScope) : null);
  const ready = computed(() => options ? toValue(options.ready) : true);
  const openIds = ref<string[]>([]), selectedId = ref<string | null>(null), pinnedIds = ref<string[]>([]);
  const hidden = ref(true), expanded = ref(false), limitReached = ref(false);
  const available = computed(() => toValue(catalog).filter(item => item.scopeKey === toValue(scopeKey)));
  const tabs = computed(() => openIds.value.map(id => available.value.find(item => item.id === id)).filter((item): item is SessionResource => !!item)
    .sort((a, b) => Number(pinnedIds.value.includes(b.id)) - Number(pinnedIds.value.includes(a.id))));
  const selected = computed(() => tabs.value.find(item => item.id === selectedId.value) || null);
  function reset() { openIds.value = []; pinnedIds.value = []; selectedId.value = null; hidden.value = true; expanded.value = false; limitReached.value = false; }
  function open(id: string) {
    if (!available.value.some(item => item.id === id)) return false;
    if (!openIds.value.includes(id)) {
      if (openIds.value.length >= 12) { limitReached.value = true; hidden.value = false; return false; }
      openIds.value = [...openIds.value, id];
    }
    selectedId.value = id; hidden.value = false; limitReached.value = false; return true;
  }
  function close(id: string) {
    const previous = tabs.value, index = previous.findIndex(item => item.id === id);
    openIds.value = openIds.value.filter(value => value !== id); pinnedIds.value = pinnedIds.value.filter(value => value !== id);
    if (selectedId.value === id) selectedId.value = previous[index + 1]?.id || previous[index - 1]?.id || null;
    if (!openIds.value.length) { hidden.value = true; expanded.value = false; }
    limitReached.value = false;
  }
  function pin(id: string) { if (openIds.value.includes(id)) pinnedIds.value = pinnedIds.value.includes(id) ? pinnedIds.value.filter(value => value !== id) : [...pinnedIds.value, id]; }
  function hide() { hidden.value = true; expanded.value = false; }
  function show() { if (tabs.value.length) hidden.value = false; }
  watch(() => toValue(scopeKey), () => { loadedKey = null; reset(); }, { flush: 'sync' });
  watch(available, value => {
    if (options) return;
    for (const id of [...openIds.value]) if (!value.some(item => item.id === id)) close(id);
  }, { flush: 'sync' });
  // Hydrate only after the owned session/catalog has loaded. A temporary empty
  // catalog or failed fetch must not overwrite the saved references.
  watch([persistenceScope, ready, available], () => {
    const scope = persistenceScope.value, key = sessionLayoutScopeKey(scope);
    if (!ready.value || !scope || !key) return;
    if (loadedKey !== key) {
      const saved = loadSessionResourceLayout(scope);
      if (saved) {
        openIds.value = saved.openIds.filter(id => available.value.some(item => item.id === id));
        pinnedIds.value = saved.pinnedIds.filter(id => openIds.value.includes(id));
        selectedId.value = openIds.value.includes(saved.selectedId || '') ? saved.selectedId : openIds.value[0] || null;
        hidden.value = saved.hidden || !openIds.value.length;
        expanded.value = false; // Never reopen a modal or a browser grant on reload.
      }
      loadedKey = key;
    }
    for (const id of [...openIds.value]) if (!available.value.some(item => item.id === id)) close(id);
  }, { flush: 'post', immediate: true });
  watch([openIds, pinnedIds, selectedId, hidden], () => {
    const scope = persistenceScope.value;
    if (ready.value && scope && loadedKey === sessionLayoutScopeKey(scope))
      saveSessionResourceLayout(scope, { openIds: openIds.value, pinnedIds: pinnedIds.value, selectedId: selectedId.value, hidden: hidden.value });
  }, { flush: 'post' });
  return { available, tabs, selected, openIds, selectedId, pinnedIds, hidden, expanded, limitReached, open, close, pin, hide, show, reset };
}
