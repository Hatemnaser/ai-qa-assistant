<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import { useDialogAccessibility } from '../../ui/useDialogAccessibility';
import SessionSourcesPanel from './SessionSourcesPanel.vue';
import SessionActivityPanel from './SessionActivityPanel.vue';
import SessionRecordResource from './SessionRecordResource.vue';
import BrowserResourceView from './BrowserResourceView.vue';
import ReadinessResourceView from './ReadinessResourceView.vue';
import type { useSessionResources, SessionResource } from './sessionResources';
import type { SessionSource } from './sessionSources';
import type { TestSessionDetail } from '../test-sessions/types';
import type { QaRequestDetail } from '../qa/types';

const props = defineProps<{
  state: ReturnType<typeof useSessionResources>; scopeKey: string; projectId: string; active: boolean;
  sources: SessionSource[]; selectedSourceId: string | null; session: TestSessionDetail | null;
  request: QaRequestDetail | null; loading: boolean; readError?: string | boolean; retryDisabled?: boolean;
  forceDrawer?: boolean; openerElement?: HTMLElement | null; canStop: boolean;
}>();
const emit = defineEmits<{ 'select-source': [id: string]; 'focus-message': [id: string]; 'open-results': [id: string]; retry: []; stop: [executionId: string]; connections: [] }>();
const { t } = useI18n();
const { tabs, selected, selectedId, hidden, expanded, pinnedIds, available, limitReached } = props.state;
const anchor = ref<HTMLElement | null>(null), drawer = ref(false), resourcePicker = ref('');
const prefix = useId(), visible = computed(() => props.active && !hidden.value && !!selected.value);
const modalOpen = computed(() => visible.value && (drawer.value || expanded.value || props.forceDrawer));
const { dialogRef: panel, onDialogKeydown, onDialogFocusEnd } = useDialogAccessibility({ isOpen: modalOpen, onClose: hide });
const tabButtons = new Map<string, HTMLElement>();
function title(item: SessionResource) { return t(`sessionResources.${item.kind}`) + (item.title ? ` · ${item.title}` : ''); }
function id(item: SessionResource) { return `${prefix}-${encodeURIComponent(item.id)}`; }
function measure() {
  const width = anchor.value?.closest('.test-session')?.getBoundingClientRect().width || window.innerWidth;
  drawer.value = window.innerWidth <= 991 || width - 440 < 480;
}
let observer: ResizeObserver | undefined, inertHost: HTMLElement | null = null, previousInert = false;
function releaseInert() { if (inertHost) { inertHost.inert = previousInert; inertHost = null; } }
watch(modalOpen, value => { releaseInert(); if (value) { inertHost = document.getElementById('app'); if (inertHost) { previousInert = inertHost.inert; inertHost.inert = true; } } }, { flush: 'post' });
async function hide() {
  const scope = props.scopeKey, opener = props.openerElement; props.state.hide(); await nextTick();
  if (props.active && scope === props.scopeKey && opener?.isConnected) opener.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (modalOpen.value) onDialogKeydown(event);
  else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); void hide(); }
}
function tabKey(event: KeyboardEvent) {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End']; if (!keys.includes(event.key) || event.isComposing) return;
  event.preventDefault(); const list = tabs.value, index = list.findIndex(item => item.id === selectedId.value);
  const rtl = document.documentElement.dir === 'rtl';
  const delta = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
  const next = event.key === 'Home' ? list[0] : event.key === 'End' ? list.at(-1) : list[(index + delta + list.length) % list.length];
  if (next) { props.state.open(next.id); tabButtons.get(next.id)?.focus({ preventScroll: true }); }
}
async function closeTab(item: SessionResource) {
  const scope = props.scopeKey; props.state.close(item.id); const nextId = selectedId.value; await nextTick();
  if (!props.active || scope !== props.scopeKey || nextId !== selectedId.value) return;
  if (selectedId.value) tabButtons.get(selectedId.value)?.focus({ preventScroll: true }); else await hide();
}
function pick() { if (resourcePicker.value) props.state.open(resourcePicker.value); resourcePicker.value = ''; }
watch(() => props.active, value => { if (!value) { props.state.hide(); releaseInert(); } }, { flush: 'sync' });
watch(() => props.scopeKey, () => { resourcePicker.value = ''; tabButtons.clear(); releaseInert(); }, { flush: 'sync' });
watch(visible, async value => { if (value) { const scope = props.scopeKey; measure(); await nextTick(); if (props.active && visible.value && scope === props.scopeKey) panel.value?.focus({ preventScroll: true }); } });
onMounted(() => { measure(); window.addEventListener('resize', measure); const host = anchor.value?.closest('.test-session'); if (host) { observer = new ResizeObserver(measure); observer.observe(host); } });
onBeforeUnmount(() => { releaseInert(); observer?.disconnect(); window.removeEventListener('resize', measure); });
</script>

<template>
  <span ref="anchor" hidden />
  <Teleport to="body" :disabled="!modalOpen">
    <div v-show="visible" class="workspace-surface session-resources-shell" :class="{ 'session-resources-shell--drawer': modalOpen, 'session-resources-shell--expanded': expanded }" @keydown="keydown">
      <div v-if="modalOpen" class="session-resources-backdrop" @click="hide" />
      <section id="session-resources-panel" ref="panel" class="session-resources-panel" :role="modalOpen ? 'dialog' : 'complementary'" :aria-modal="modalOpen ? 'true' : undefined" :aria-label="t('sessionResources.title')" tabindex="-1">
        <header class="session-resources-panel__header">
          <h2>{{ t('sessionResources.title') }}</h2>
          <button type="button" class="btn btn-sm btn-control" :aria-pressed="expanded" @click="expanded = !expanded">{{ t(expanded ? 'sessionResources.collapse' : 'sessionResources.expand') }}</button>
          <button type="button" class="btn btn-sm btn-control" @click="hide">{{ t('sessionResources.hide') }}</button>
        </header>
        <select v-model="resourcePicker" class="form-select session-resources-panel__picker" :aria-label="t('sessionResources.open')" @change="pick"><option value="">{{ t('sessionResources.open') }}</option><option v-for="item in available" :key="item.id" :value="item.id">{{ title(item) }}</option></select>
        <p v-if="limitReached" role="alert">{{ t('sessionResources.limit') }}</p>
        <div class="session-resource-tabs" role="tablist" :aria-label="t('sessionResources.title')" @keydown="tabKey">
          <div v-for="item in tabs" :key="item.id" class="session-resource-tab" :class="{ 'session-resource-tab--selected': item.id === selectedId }">
            <button :id="id(item) + '-tab'" :ref="element => { if (element) tabButtons.set(item.id, element as HTMLElement); else tabButtons.delete(item.id); }" type="button" role="tab" :tabindex="item.id === selectedId ? 0 : -1" :aria-selected="item.id === selectedId" :aria-controls="id(item) + '-view'" :title="title(item)" @click="state.open(item.id)">{{ title(item) }}</button>
            <button type="button" :aria-label="t(pinnedIds.includes(item.id) ? 'sessionResources.unpin' : 'sessionResources.pin', { name: title(item) })" :aria-pressed="pinnedIds.includes(item.id)" @click="state.pin(item.id)">⌖</button>
            <button type="button" :aria-label="t('sessionResources.close', { name: title(item) })" @click="closeTab(item)">×</button>
          </div>
        </div>
        <section v-for="item in tabs" v-show="item.id === selectedId" :id="id(item) + '-view'" :key="item.id" class="session-resource-view" role="tabpanel" :aria-labelledby="id(item) + '-tab'" tabindex="0">
          <SessionSourcesPanel v-if="item.kind === 'sources'" :scope-key="scopeKey" :sources="sources" :selected-source-id="selectedSourceId" @select-source="emit('select-source', $event)" @focus-message="emit('focus-message', $event)" />
          <template v-else-if="item.kind === 'activity'"><SessionActivityPanel :session="session" :request="request" :loading="loading" :read-error="readError" :disabled="!active || loading || Boolean(readError)" :retry-disabled="retryDisabled" @select-request="emit('open-results', $event)" @retry="emit('retry')" /><button class="btn btn-secondary" type="button" @click="emit('connections')">{{ t('testSessions.connect') }}</button></template>
          <BrowserResourceView v-else-if="item.kind === 'browser' && item.executionId" :project-id="projectId" :execution-id="item.executionId" :scope-key="scopeKey" :active="visible && item.id === selectedId" :layout-key="Boolean(modalOpen)" :can-stop="canStop" @stop="emit('stop', item.executionId!)" @controls="hide" />
          <ReadinessResourceView v-else-if="item.kind === 'readiness'" :resource="item" :project-id="projectId" :scope-key="scopeKey" :active="visible && item.id === selectedId" />
          <SessionRecordResource v-else :resource="item" :project-id="projectId" :scope-key="scopeKey" :active="visible && item.id === selectedId" />
        </section>
        <span v-if="modalOpen" class="visually-hidden" tabindex="0" aria-hidden="true" @focus="onDialogFocusEnd" />
      </section>
    </div>
  </Teleport>
</template>
