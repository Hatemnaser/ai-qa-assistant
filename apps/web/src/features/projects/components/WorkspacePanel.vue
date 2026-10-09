<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { AuthUser } from "../../auth/types";
import { useI18n } from "../../../i18n/useI18n";
import ProjectContextAside from "./ProjectContextAside.vue";
defineOptions({ inheritAttrs: false });

const props = defineProps<{ currentUser: AuthUser | null; projectId: string; projectName: string; hasResults?: boolean; toggleTarget?: HTMLElement | null }>();
const emit = defineEmits<{ integrations: [] }>();
const { t } = useI18n();
const tab = ref<"context" | "files" | "results">("context");
const mobileOpen = ref(false);
const mobileToggle = ref<HTMLButtonElement | null>(null);
const panelElement = ref<HTMLElement | null>(null);
const footer = ref<HTMLElement | null>(null);
const desktopToggle = ref<HTMLButtonElement | null>(null);
const collapsed = ref(false);
watch(() => props.currentUser?.id, owner => {
  try { collapsed.value = Boolean(owner && localStorage.getItem(`oddpath:panel-collapsed:${owner}`) === 'true'); } catch { collapsed.value = false; }
}, { immediate: true });
watch(() => [props.currentUser?.id, props.projectId], () => { tab.value = 'context'; mobileOpen.value = false; });
watch(() => props.hasResults, value => { if (!value && tab.value === 'results') tab.value = 'context'; });
function togglePanel() {
  collapsed.value = !collapsed.value;
  try { if (props.currentUser) localStorage.setItem(`oddpath:panel-collapsed:${props.currentUser.id}`, String(collapsed.value)); } catch { /* Optional display preference. */ }
}
let host: Element | null = null;
function openResults() { if (!props.hasResults) return; tab.value = "results"; mobileOpen.value = window.matchMedia('(max-width: 991px)').matches; collapsed.value = false; }
function openFiles() { tab.value = "files"; mobileOpen.value = window.matchMedia('(max-width: 991px)').matches; collapsed.value = false; }
function collapseForWriting(event: Event) {
  if (!mobileOpen.value || !window.matchMedia("(max-width: 991px)").matches) return;
  const target = event.target;
  if (target instanceof Element && target.closest(".chat-form, .session-composer-dock__decision, .qa-run-approval__details")) mobileOpen.value = false;
}
onMounted(() => {
  host = panelElement.value?.closest(".test-session, .project-detail, .chat-workspace") || null;
  host?.addEventListener("focusin", collapseForWriting);
});
onBeforeUnmount(() => host?.removeEventListener("focusin", collapseForWriting));
function closeMobile(event: KeyboardEvent) {
  if (!window.matchMedia("(max-width: 991px)").matches) { event.preventDefault(); event.stopPropagation(); if (!collapsed.value) togglePanel(); desktopToggle.value?.focus(); return; }
  if (!mobileOpen.value || !window.matchMedia("(max-width: 991px)").matches) return;
  event.preventDefault(); event.stopPropagation();
  mobileOpen.value = false; mobileToggle.value?.focus();
}
defineExpose({ openResults, openFiles });
</script>

<template>
  <Teleport :to="toggleTarget || 'body'" :disabled="!toggleTarget">
    <button ref="desktopToggle" type="button" class="btn btn-sm btn-outline-secondary session-panel-toggle" :aria-expanded="!collapsed" @click="togglePanel">{{ t(collapsed ? 'workspaces.showPanel' : 'workspaces.hidePanel') }}</button>
  </Teleport>
  <aside v-bind="$attrs" ref="panelElement" class="workspace-work-panel" :class="{ 'workspace-work-panel--open': mobileOpen, 'workspace-work-panel--collapsed': collapsed }" :aria-label="t('workspaces.panel')" @keydown.esc="closeMobile">
    <button ref="mobileToggle" class="workspace-work-panel__mobile-toggle" type="button" :aria-expanded="mobileOpen" @click="mobileOpen = !mobileOpen">
      {{ projectName }} · {{ t('workspaces.panel') }} <span aria-hidden="true">{{ mobileOpen ? '−' : '+' }}</span>
    </button>
    <div class="workspace-work-panel__content">
      <nav class="workspace-work-panel__tabs" :aria-label="t('workspaces.panel')">
        <button type="button" :aria-current="tab === 'context' ? 'page' : undefined" @click="tab = 'context'">{{ t('workspaces.panelContext') }}</button>
        <button type="button" :aria-current="tab === 'files' ? 'page' : undefined" @click="openFiles">{{ t('workspaces.panelFiles') }}</button>
        <button v-if="hasResults" type="button" :aria-current="tab === 'results' ? 'page' : undefined" @click="openResults">{{ t('workspaces.panelResults') }}</button>
      </nav>
      <div class="workspace-work-panel__body">
        <div v-show="tab !== 'results'">
          <ProjectContextAside :current-user="currentUser" :project-id="projectId" :project-name="projectName" :display-section="tab === 'files' ? 'files' : 'context'" :integrations-target="footer" @integrations="emit('integrations')" />
        </div>
        <div v-if="hasResults" v-show="tab === 'results'" class="workspace-work-panel__results"><slot name="results" /></div>
      </div>
      <div ref="footer" class="workspace-work-panel__footer" />
    </div>
  </aside>
</template>
