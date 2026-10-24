import { computed, onScopeDispose, ref, toValue, watch, type MaybeRefOrGetter } from 'vue';
import { fetchQaRequest } from '../qa/qaApi';
import type { QaRequestDetail } from '../qa/types';
import type { SessionResource } from './sessionResources';

/** Independent read model: never selects or mutates the controller's request. */
export function useSessionResourceReader(options: {
  scopeKey: MaybeRefOrGetter<string>; projectId: MaybeRefOrGetter<string>; resource: MaybeRefOrGetter<SessionResource>;
  active: MaybeRefOrGetter<boolean>;
}, read = fetchQaRequest) {
  const detail = ref<QaRequestDetail | null>(null), loading = ref(false), failed = ref(false), runId = ref<string | null>(null);
  let revision = 0, disposed = false;
  const run = computed(() => detail.value?.runs.find(item => item.id === runId.value) || null);
  async function refresh() {
    const resource = toValue(options.resource), projectId = toValue(options.projectId), scope = toValue(options.scopeKey);
    if (!toValue(options.active) || resource.scopeKey !== scope || !resource.requestId || !projectId || disposed) return;
    const sequence = ++revision; loading.value = true; failed.value = false;
    const valid = () => !disposed && sequence === revision && scope === toValue(options.scopeKey)
      && toValue(options.active) && toValue(options.resource).id === resource.id;
    try {
      const value = await read(projectId, resource.requestId);
      if (!valid()) return;
      if (value.id !== resource.requestId || value.projectId !== projectId) throw new Error('Resource scope mismatch');
      detail.value = value;
      // Once selected, a run stays selected when a newer run is added.
      if (runId.value === null) runId.value = value.runs[0]?.id || null;
    } catch { if (valid()) { failed.value = true; detail.value = null; } }
    finally { if (valid()) loading.value = false; }
  }
  watch(() => [toValue(options.scopeKey), toValue(options.projectId), toValue(options.resource).id], () => {
    ++revision; detail.value = null; runId.value = null; failed.value = false; loading.value = false; void refresh();
  }, { immediate: true, flush: 'sync' });
  watch(() => toValue(options.active), active => { ++revision; loading.value = false; if (active && !detail.value) void refresh(); }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; ++revision; });
  return { detail, run, runId, loading, failed, refresh };
}
