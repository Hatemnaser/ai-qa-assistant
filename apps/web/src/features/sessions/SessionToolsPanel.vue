<script setup lang="ts">
import { computed, nextTick, onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from "vue";
import { useI18n } from "../../i18n/useI18n";
import Icon from "../../ui/Icon.vue";
import { useDialogAccessibility } from "../../ui/useDialogAccessibility";
import SessionSourcesPanel from "./SessionSourcesPanel.vue";
import type { SessionSource } from "./sessionSources";
import { sessionToolsUseDrawer } from "./sessionToolsLayout";

export type SessionTool = "sources" | "activity" | "results";
const props = defineProps<{ scopeKey: string; currentTool: SessionTool | null; sources: SessionSource[]; selectedSourceId?: string | null; openerElement?: HTMLElement | null; forceDrawer?: boolean }>();
const emit = defineEmits<{ close: []; "select-source": [id: string]; "focus-message": [messageId: string] }>();
const { t } = useI18n();
const anchor = ref<HTMLElement | null>(null);
const closeButton = ref<HTMLButtonElement | null>(null);
const drawer = ref(false);
const lifecycleActive = ref(true);
const modalOpen = computed(() => Boolean(lifecycleActive.value && props.currentTool && drawer.value));
const { dialogRef: panel, onDialogKeydown } = useDialogAccessibility({ isOpen: modalOpen, onClose: () => { void close(); } });
const title = computed(() => props.currentTool ? t(`sessionTools.${props.currentTool}`) : "");
let observer: ResizeObserver | null = null;
function measure() {
  const host = anchor.value?.closest(".test-session, .chat-workspace") || anchor.value?.parentElement;
  const width = host?.getBoundingClientRect().width || window.innerWidth;
  drawer.value = sessionToolsUseDrawer(width, window.innerWidth, props.forceDrawer);
}
async function close() {
  const opener = props.openerElement;
  emit("close");
  await nextTick();
  if (opener?.isConnected) opener.focus({ preventScroll: true });
}
function keydown(event: KeyboardEvent) {
  if (!props.currentTool || event.isComposing) return;
  if (drawer.value) { onDialogKeydown(event); return; }
  if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); void close(); return; }
}
let inertHost: HTMLElement | null = null;
let previousInert = false;
function releaseInert() { if (inertHost) { inertHost.inert = previousInert; inertHost = null; } }
watch(modalOpen, active => {
  releaseInert();
  if (active) {
    inertHost = document.getElementById("app");
    if (inertHost) { previousInert = inertHost.inert; inertHost.inert = true; }
  }
}, { flush: "post" });
watch(() => props.forceDrawer, measure);
watch(() => props.currentTool, async (tool, previous) => {
  if (!tool) return;
  measure();
  await nextTick();
  if (lifecycleActive.value && props.currentTool === tool && (!previous || drawer.value)) closeButton.value?.focus({ preventScroll: true });
});
watch(() => props.scopeKey, () => { if (props.currentTool) emit("close"); });
onMounted(() => {
  measure(); window.addEventListener("resize", measure);
  const host = anchor.value?.closest(".test-session, .chat-workspace") || anchor.value?.parentElement;
  if (host && typeof ResizeObserver !== "undefined") { observer = new ResizeObserver(measure); observer.observe(host); }
  if (props.currentTool) void nextTick(() => closeButton.value?.focus({ preventScroll: true }));
});
onBeforeUnmount(() => { releaseInert(); observer?.disconnect(); window.removeEventListener("resize", measure); });
onActivated(() => { lifecycleActive.value = true; measure(); });
onDeactivated(() => { lifecycleActive.value = false; releaseInert(); emit('close'); });
</script>

<template>
  <span ref="anchor" class="session-tools-anchor" aria-hidden="true" />
  <Teleport to="body" :disabled="!drawer">
    <div v-if="lifecycleActive && currentTool" class="workspace-surface session-tools-shell" :class="{ 'session-tools-shell--drawer': drawer }" @keydown="keydown">
      <div v-if="drawer" class="session-tools-backdrop" @click="close" />
      <section id="session-tools-panel" ref="panel" class="session-tools-panel" :role="drawer ? 'dialog' : 'complementary'" :aria-modal="drawer ? 'true' : undefined" :aria-label="title" tabindex="-1">
        <header class="session-tools-panel__header"><h2>{{ title }}</h2><button ref="closeButton" type="button" :aria-label="t('sessionTools.close')" @click="close"><Icon name="close" /></button></header>
        <div class="session-tools-panel__body">
          <SessionSourcesPanel v-if="currentTool === 'sources'" :scope-key="scopeKey" :sources="sources" :selected-source-id="selectedSourceId" @select-source="emit('select-source', $event)" @focus-message="emit('focus-message', $event)" />
          <slot v-else-if="currentTool === 'activity'" name="activity" />
          <slot v-else-if="currentTool === 'results'" name="results" />
        </div>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.session-tools-anchor { display: none; }
.session-tools-shell { width: 320px; min-width: 0; flex: 0 0 320px; height: 100%; }
.session-tools-panel { display: flex; flex-direction: column; min-height: 0; height: 100%; background: var(--surface-app, #fff); color: var(--text-main, #25251f); border-inline-start: 1px solid color-mix(in srgb, currentColor 10%, transparent); }
.session-tools-panel__header { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: .5rem; padding: .7rem .85rem; }
.session-tools-panel__header h2 { margin: 0; font-size: .94rem; font-weight: 600; }
.session-tools-panel__header button { display: grid; place-items: center; width: 44px; height: 44px; border: 0; border-radius: .5rem; background: transparent; color: inherit; }
.session-tools-panel__header button :deep(svg) { width: 18px; height: 18px; }
.session-tools-panel__header button:hover { background: color-mix(in srgb, currentColor 8%, transparent); }
.session-tools-panel__header button:focus-visible { outline: 2px solid var(--workspace-accent, #aa9362); outline-offset: 2px; }
.session-tools-panel__body { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 .85rem max(1rem, env(safe-area-inset-bottom)); }
.session-tools-shell--drawer { position: fixed; z-index: 1080; inset: 0; width: auto; height: auto; display: flex; justify-content: flex-end; }
.session-tools-backdrop { position: absolute; inset: 0; background: rgb(0 0 0 / .4); }
.session-tools-shell--drawer .session-tools-panel { position: relative; width: min(420px, 100vw); max-width: 100%; box-shadow: 0 10px 40px rgb(0 0 0 / .22); }
@media (max-width: 991px) { .session-tools-shell--drawer .session-tools-panel { width: 100%; border: 0; } }
</style>
