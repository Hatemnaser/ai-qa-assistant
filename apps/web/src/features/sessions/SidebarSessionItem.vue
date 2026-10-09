<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { useI18n } from '../../i18n/useI18n';
import type { Project } from '../projects/types';
import type { SidebarTestItem } from '../test-sessions/navigation';
import type { TestSessionDetail } from '../test-sessions/types';
import type { ExportFormat } from '../chat/types';
import { exportChatByFormat } from '../chat/chatExport';
import { testSessionTranscript } from '../test-sessions/sessionPresentation';
import * as api from './sessionApi';

const props = defineProps<{ item: SidebarTestItem; active: boolean; projectName?: string; projects: Project[]; beforeAdopt?: (id: string) => Promise<void>; moveSession?: (id: string, from: string, to: string) => Promise<void> }>();
const emit = defineEmits<{ select: [item: SidebarTestItem]; updated: [] }>();
const { t } = useI18n();
const trigger = ref<HTMLButtonElement | null>(null);
const menu = ref<HTMLElement | null>(null);
const menuOpen = ref(false);
const menuStyle = ref<Record<string, string>>({});
const renameInput = ref<HTMLInputElement | null>(null);
const detail = ref<TestSessionDetail | null>(null);
const busy = ref(false), error = ref(''), title = ref(''), rename = ref(false), confirmingDelete = ref(false);
let revision = 0;
onBeforeUnmount(() => { revision++; removeListeners(); });
watch(() => props.item.id, () => { revision++; detail.value = null; close(); });
function close(restoreFocus = true) {
  revision++; menuOpen.value = false; busy.value = false;
  rename.value = false; confirmingDelete.value = false; removeListeners();
  if (restoreFocus) trigger.value?.focus();
}
function positionMenu() {
  const anchor = trigger.value?.getBoundingClientRect();
  if (!anchor) return;
  const width = Math.min(272, window.innerWidth - 24);
  const height = Math.min(menu.value?.scrollHeight || 400, window.innerHeight - 24);
  const rtl = document.documentElement.dir === 'rtl';
  const left = Math.max(12, Math.min(window.innerWidth - width - 12, rtl ? anchor.left : anchor.right - width));
  const top = Math.max(12, Math.min(anchor.bottom + 4, window.innerHeight - height - 12));
  menuStyle.value = { left: `${left}px`, top: `${top}px`, width: `${width}px`, maxHeight: `${window.innerHeight - top - 12}px` };
}
function outside(event: PointerEvent) {
  if (!menu.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close(false);
}
function resized() { close(); }
function scrolled(event: Event) { if (!menu.value?.contains(event.target as Node)) close(false); }
function removeListeners() {
  document.removeEventListener('pointerdown', outside, true);
  document.removeEventListener('scroll', scrolled, true);
  window.removeEventListener('resize', resized);
}
async function toggleMenu() {
  if (menuOpen.value) return close();
  menuOpen.value = true; positionMenu();
  document.addEventListener('pointerdown', outside, true);
  document.addEventListener('scroll', scrolled, true);
  window.addEventListener('resize', resized);
  await read();
  await nextTick();
  if (menuOpen.value) { positionMenu(); menu.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus(); }
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
  if (event.key !== 'Tab') return;
  const elements = [...(menu.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)') || [])];
  const first = elements[0], last = elements.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
async function toggleRename() { rename.value = !rename.value; await nextTick(); if (rename.value) { renameInput.value?.focus(); renameInput.value?.select(); } positionMenu(); }
async function read() {
  if (!menuOpen.value || props.item.id.startsWith('request:')) return;
  const token = ++revision;
  busy.value = true; error.value = '';
  try { const value = await api.fetchTestSession(props.item.projectId, props.item.id); if (token === revision) { detail.value = value; title.value = value.title; } }
  catch (failure) { if (token === revision) error.value = failure instanceof Error ? failure.message : t('testSessions.errors.request'); }
  finally { if (token === revision) busy.value = false; }
}
async function act(operation: (value: TestSessionDetail) => Promise<unknown>) {
  if (!detail.value || busy.value) return;
  const token = ++revision; busy.value = true; error.value = '';
  try {
    let value = detail.value;
    if (value.managed === false) { await props.beforeAdopt?.(value.id); value = await api.fetchTestSession(value.projectId, value.id); }
    if (token !== revision) return;
    await operation(value);
    if (token === revision) { emit('updated'); close(); }
  } catch (failure) { if (token === revision) error.value = failure instanceof Error ? failure.message : t('testSessions.errors.request'); }
  finally { if (token === revision) busy.value = false; }
}
function update(input: { title?: string; archived?: boolean; projectId?: string | null }) {
  void act(value => input.projectId !== undefined && props.moveSession
    ? props.moveSession(value.id, value.projectId, input.projectId || '')
    : api.updateTestSession(value.projectId, value.id, { ...input, expectedSessionVersion: value.version, expectedUpdatedAt: value.updatedAt }));
}
function exportTranscript(format: ExportFormat) { if (detail.value) { exportChatByFormat(testSessionTranscript(detail.value, t('testSessions.exportNote')), format); close(); } }
</script>
<template>
  <div class="sidebar-session-row ui-row ui-row--compact ui-row--interactive" :class="{ active }">
    <button class="ui-row__button ui-row__button--with-action" type="button" :aria-current="active ? 'page' : undefined" @click="emit('select', item)"><span class="ui-row__copy"><span class="ui-row__title">{{ item.title === 'New QA Chat' ? t('chat.title.default') : item.title }}</span><small v-if="projectName" class="sidebar-chat-project">{{ projectName }}</small><small v-if="item.id.startsWith('request:')">{{ t('workspaces.legacy') }}</small></span></button>
    <div v-if="!item.id.startsWith('request:')" class="ui-row__action sidebar-session-menu">
      <button ref="trigger" type="button" class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost" :aria-label="t('sidebar.chat.menu', { title: item.title })" aria-haspopup="dialog" :aria-expanded="menuOpen" @click.stop="toggleMenu">⋯</button>
      <Teleport to="body">
      <div v-if="menuOpen" ref="menu" class="workspace-surface sidebar-session-menu__body" :style="menuStyle" role="dialog" :aria-label="t('sidebar.chat.menu', { title: item.title })" @keydown="menuKeydown">
        <p v-if="busy" role="status">{{ t('testSessions.loading') }}</p>
        <p v-if="error" role="alert">{{ error }} <button type="button" @click="read">{{ t('testSessions.retry') }}</button></p>
        <template v-if="detail">
          <button type="button" :disabled="busy" @click="toggleRename">{{ t('chat.menu.rename') }}</button>
          <form v-if="rename" @submit.prevent="update({ title: title.trim() })"><input ref="renameInput" v-model="title" :aria-label="t('chat.menu.rename')" maxlength="180" /><button :disabled="busy || !title.trim()">{{ t('testSessions.save') }}</button></form>
          <label v-if="!detail.requests.length">{{ t('testSessions.project') }}<select :value="detail.projectId" :disabled="busy" @change="update({ projectId: ($event.target as HTMLSelectElement).value || null })"><option value="">{{ t('chat.home.noProject') }}</option><option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option></select></label>
          <button type="button" :disabled="busy" @click="update({ archived: !detail.archivedAt })">{{ t(detail.archivedAt ? 'testSessions.restore' : 'testSessions.archive') }}</button>
          <button v-for="format in (['json', 'md', 'txt', 'csv'] as const)" :key="format" type="button" :disabled="busy" @click="exportTranscript(format)">{{ t('testSessions.export') }} · {{ format.toUpperCase() }}</button>
          <button v-if="!detail.requests.length" type="button" :disabled="busy" @click="confirmingDelete = !confirmingDelete">{{ t('testSessions.deleteDraft') }}</button>
          <div v-if="confirmingDelete" role="alert"><p>{{ t('testSessions.deleteConfirm') }}</p><button type="button" :disabled="busy" @click="act(value => api.deleteTestSession(value.projectId, value.id, value.version, value.updatedAt))">{{ t('testSessions.deleteDraft') }}</button><button type="button" :disabled="busy" @click="confirmingDelete = false">{{ t('testSessions.close') }}</button></div>
        </template>
      </div>
      </Teleport>
    </div>
  </div>
</template>
<style scoped>
.sidebar-session-row { position: relative; }
.sidebar-session-menu { margin-inline-end: 4px; }
.sidebar-session-menu__body { position: fixed; z-index: 1200; padding: 10px; display: grid; gap: 8px; border: 1px solid var(--bs-border-color); border-radius: 10px; color: var(--bs-body-color); background: var(--bs-body-bg); box-shadow: 0 8px 28px #0003; overflow: auto; }
.sidebar-session-menu__body button, input, select { width: 100%; border: 1px solid var(--bs-border-color); border-radius: 6px; padding: 8px; color: inherit; background: var(--bs-body-bg); text-align: start; min-height: 40px; }
.sidebar-session-menu__body p { white-space: normal; overflow-wrap: anywhere; }
</style>
