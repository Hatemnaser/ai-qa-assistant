<script setup lang="ts">
import { nextTick, onActivated, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";
import { useI18n } from "../../../i18n/useI18n";
import { sessionScrollGutters } from "../sessionScrollGutters";
import { sessionReaderPosition } from "../sessionReaderPosition";

const props = defineProps<{
  scrollSelector: string;
  readerKey?: string;
  decisionTitle?: string;
  decisionSummary?: string;
  decisionKey?: string;
  detailsTarget?: HTMLElement | null;
}>();
const { t } = useI18n();
const decisionId = `session-decision-${useId()}`;
const dock = ref<HTMLElement | null>(null);
const writer = ref<HTMLElement | null>(null);
const decision = ref<HTMLElement | null>(null);
const trigger = ref<HTMLButtonElement | null>(null);
const compact = ref(false);
const expanded = ref(false);
const following = ref(true);
const newerOutsideView = ref(false);
let host: HTMLElement | null = null;
let scroll: HTMLElement | null = null;
let resize: ResizeObserver | undefined;
let mutation: MutationObserver | undefined;
let frame = 0;
let fullDecisionHeight = 0;
let disposed = false;
const readerEntrySelector = '[data-message-id], .chat-message-turn, .test-session__saved-status, .test-session__action, .session-composer-dock__decision--expanded, .qa-run-approval__details, .test-session__results-link';

function readerContentBottom(source: HTMLElement) {
  if (!scroll) return null;
  const origin = source.getBoundingClientRect().top + source.clientTop;
  let bottom: number | null = null;
  for (const element of scroll.querySelectorAll<HTMLElement>(readerEntrySelector)) {
    const rect = element.getBoundingClientRect();
    if (!rect.height || !rect.width) continue;
    bottom = Math.max(bottom ?? 0, rect.bottom - origin + source.scrollTop);
  }
  if (bottom === null) return null;
  // In flow mode the writer is part of the scroller, not an overlay.
  return bottom + (source === scroll ? dock.value?.getBoundingClientRect().height || 0 : 0);
}

function latest() {
  following.value = true;
  const source = host?.classList.contains("session-canvas--flow") ? host : scroll;
  if (scroll) scroll.dataset.followLatest = "true";
  if (source && readerContentBottom(source) !== null) source.scrollTop = source.scrollHeight;
  updateReaderPosition(false);
}
function updateReaderPosition(updateFollowing = true) {
  const source = host?.classList.contains("session-canvas--flow") ? host : scroll;
  if (!source) return;
  const position = sessionReaderPosition(source.scrollHeight, source.clientHeight, source.scrollTop, readerContentBottom(source));
  newerOutsideView.value = position.newerOutsideView;
  if (updateFollowing) following.value = position.following;
  if (scroll) scroll.dataset.followLatest = String(following.value);
}
function onScroll() { updateReaderPosition(); }
async function showDetails() {
  following.value = false;
  if (scroll) scroll.dataset.followLatest = 'false';
  expanded.value = !expanded.value;
  await nextTick();
  if (expanded.value) {
    decision.value?.focus({ preventScroll: true });
    decision.value?.scrollIntoView({ block: "center" });
  } else trigger.value?.focus({ preventScroll: true });
}
function onTranscriptFocus(event: FocusEvent) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || !target.closest('[data-message-id], .chat-message-turn, .test-session__saved-status, .test-session__action, .session-composer-dock__decision--expanded, .qa-run-approval__details')) return;
  // Explicitly inspecting a decision/message takes precedence over following
  // updates, including ResizeObserver work queued by the same click.
  following.value = false;
  if (scroll) scroll.dataset.followLatest = 'false';
}
function closeDetails(event: KeyboardEvent) {
  if (!compact.value || !expanded.value) return;
  event.preventDefault(); event.stopPropagation(); expanded.value = false;
  trigger.value?.focus({ preventScroll: true });
}
function schedule() {
  if (frame || disposed) return;
  frame = requestAnimationFrame(() => { frame = 0; void measure(); });
}
async function measure() {
  if (!host || !dock.value || !writer.value || !scroll) return;
  const wasFollowing = following.value;
  const viewport = window.visualViewport;
  if (viewport && viewport.scale === 1 && viewport.height < window.innerHeight - 100) {
    host.style.maxHeight = `${Math.max(160, viewport.height + viewport.offsetTop - host.getBoundingClientRect().top)}px`;
  } else host.style.removeProperty('max-height');
  const scrollStyle = getComputedStyle(scroll);
  const gutters = sessionScrollGutters({
    offsetWidth: scroll.offsetWidth, clientWidth: scroll.clientWidth, clientLeft: scroll.clientLeft,
    borderLeft: parseFloat(scrollStyle.borderLeftWidth) || 0,
    borderRight: parseFloat(scrollStyle.borderRightWidth) || 0,
    overflowing: scroll.scrollHeight > scroll.clientHeight,
    rtl: scrollStyle.direction === "rtl",
  });
  host.style.setProperty("--session-scrollbar-left", `${gutters.left}px`);
  host.style.setProperty("--session-scrollbar-right", `${gutters.right}px`);
  // Headers belong to the host too. Measuring the whole host overestimates
  // the actual reading/writing space on wrapped mobile headers.
  const headerHeight = Math.max(0, scroll.getBoundingClientRect().top - host.getBoundingClientRect().top + host.scrollTop - host.clientTop);
  const available = Math.max(0, host.clientHeight - headerHeight);
  const writing = writer.value.getBoundingClientRect().height;
  if (!compact.value || expanded.value) fullDecisionHeight = decision.value?.getBoundingClientRect().height || 0;
  const requested = writing + fullDecisionHeight + 24;
  const nextCompact = Boolean(props.decisionTitle && props.detailsTarget && (requested > available * .45 || available - requested < 160));
  const focused = document.activeElement instanceof HTMLElement && decision.value?.contains(document.activeElement) ? document.activeElement : null;
  if (nextCompact !== compact.value) {
    compact.value = nextCompact;
    // Moving an existing subtree never recreates its approval state.
    if (focused) expanded.value = true;
    await nextTick();
    focused?.focus({ preventScroll: true });
  }
  const height = dock.value.getBoundingClientRect().height;
  host.classList.toggle("session-canvas--flow", available < 350 || available - height < 160);
  host.style.setProperty("--session-dock-height", `${Math.ceil(height)}px`);
  if (wasFollowing) latest();
  else updateReaderPosition(false);
}
watch(() => props.decisionKey, () => { fullDecisionHeight = 0; compact.value = false; expanded.value = false; void nextTick(schedule); });
watch(() => props.detailsTarget, () => void nextTick(schedule));
watch(() => props.readerKey, () => {
  void nextTick(() => {
    if (disposed) return;
    // KeepAlive shares the dock, not the preceding session's reading position.
    if (scroll) scroll.scrollTop = 0;
    if (host?.classList.contains('session-canvas--flow')) host.scrollTop = 0;
    latest(); schedule();
  });
});
onMounted(() => {
  host = dock.value?.parentElement || null;
  scroll = host?.querySelector<HTMLElement>(props.scrollSelector) || null;
  host?.classList.add("session-canvas"); scroll?.classList.add("session-canvas__scroll");
  if (scroll) scroll.dataset.followLatest = "true";
  scroll?.addEventListener("scroll", onScroll, { passive: true });
  scroll?.addEventListener('focusin', onTranscriptFocus);
  host?.addEventListener("scroll", onScroll, { passive: true });
  resize = new ResizeObserver(schedule);
  // Observe the transcript's content box too: native gutters can appear or
  // change width without changing the outer workspace dimensions.
  for (const element of [host, scroll, dock.value, writer.value, decision.value]) if (element) resize.observe(element);
  mutation = new MutationObserver(schedule);
  if (scroll) mutation.observe(scroll, { childList: true, subtree: true, characterData: true });
  window.visualViewport?.addEventListener("resize", schedule);
  schedule();
});
onActivated(schedule);
onBeforeUnmount(() => {
  disposed = true; cancelAnimationFrame(frame); resize?.disconnect(); mutation?.disconnect();
  scroll?.removeEventListener("scroll", onScroll); host?.removeEventListener("scroll", onScroll);
  scroll?.removeEventListener('focusin', onTranscriptFocus);
  window.visualViewport?.removeEventListener("resize", schedule);
});
</script>

<template>
  <div ref="dock" class="session-composer-dock">
    <button v-if="newerOutsideView" class="session-composer-dock__latest btn btn-secondary" type="button" @click="latest">↓ {{ t('workspaces.latest') }}</button>
    <div v-if="compact && decisionTitle" class="session-composer-dock__summary">
      <div><strong>{{ decisionTitle }}</strong><small v-if="decisionSummary">{{ decisionSummary }}</small></div>
      <button ref="trigger" type="button" class="btn btn-secondary" :aria-expanded="expanded" :aria-controls="decisionId" @click="showDetails">{{ t(expanded ? 'workspaces.hideDecision' : 'workspaces.openDecision') }}</button>
    </div>
    <Teleport :to="detailsTarget || 'body'" :disabled="!compact || !detailsTarget">
      <div v-show="!compact || expanded" :id="decisionId" ref="decision" class="session-composer-dock__decision" :class="{ 'session-composer-dock__decision--expanded': compact }" tabindex="-1" @keydown.esc="closeDetails">
        <slot name="decision" />
      </div>
    </Teleport>
    <div ref="writer" class="session-composer-dock__writer"><slot /></div>
  </div>
</template>
