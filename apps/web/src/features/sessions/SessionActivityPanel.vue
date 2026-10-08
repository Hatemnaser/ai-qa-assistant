<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../i18n/useI18n";
import type { QaRequestDetail } from "../qa/types";
import type { TestSessionDetail } from "../test-sessions/types";
import { sessionActivityPresentation } from "./sessionActivityPresentation";

const props = defineProps<{
  session: TestSessionDetail | null;
  request: QaRequestDetail | null;
  loading?: boolean;
  readError?: string | boolean;
  disabled?: boolean;
  retryDisabled?: boolean;
}>();
const emit = defineEmits<{ "select-request": [id: string]; retry: [] }>();
const { t, formatDate } = useI18n();
const activity = computed(() => sessionActivityPresentation({
  session: props.session, request: props.request, loading: props.loading, readError: Boolean(props.readError),
}));
const groups = computed(() => (["active", "attention", "completed"] as const)
  .map(id => ({ id, items: activity.value[id] })));
const interactionsBlocked = computed(() => props.disabled || activity.value.loading || activity.value.readError);
function selectRequest(id: string) {
  if (!interactionsBlocked.value && activity.value.requests.some(request => request.id === id)) emit("select-request", id);
}
function eventDate(value: string) {
  return Number.isFinite(Date.parse(value)) ? formatDate(value, { dateStyle: "short", timeStyle: "short" }) : "";
}
</script>

<template>
  <section class="session-activity" :aria-label="t('sessionTools.activity.title')" :aria-busy="loading || undefined">
    <p v-if="loading" class="session-activity__notice" role="status">{{ t('sessionTools.activity.loading') }}</p>
    <div v-if="readError" class="session-activity__notice session-activity__notice--error" role="alert">
      <p>{{ t('sessionTools.activity.readError') }}</p>
      <p v-if="typeof readError === 'string'">{{ readError }}</p>
      <button type="button" class="btn btn-secondary" :disabled="loading || retryDisabled" @click="emit('retry')">{{ t('sessionTools.activity.retry') }}</button>
    </div>
    <p v-if="!loading && !readError && !activity.requests.length && !session?.turnStatus" class="session-activity__notice">{{ t('sessionTools.activity.empty') }}</p>
    <section v-for="group in groups" :key="group.id" class="session-activity__group" :data-group="group.id">
      <h3>{{ t(`sessionTools.activity.${group.id}`) }} <span>{{ group.items.length }}</span></h3>
      <p v-if="!group.items.length" class="session-activity__empty">{{ t('sessionTools.activity.none') }}</p>
      <ul v-else class="session-activity__items">
        <li v-for="item in group.items" :key="item.id" :data-kind="item.kind">
          <div class="session-activity__item-heading">
            <strong>{{ item.labelKey ? t(item.labelKey) : item.title }}</strong>
            <span class="session-activity__state">{{ t(item.statusKey) }}</span>
          </div>
          <p v-if="item.labelKey && item.title" class="session-activity__request-title">{{ item.title }}</p>
          <p v-if="item.current || item.viewed" class="session-activity__scope">
            <span v-if="item.current">{{ t('sessionTools.activity.current') }}</span>
            <span v-if="item.viewed && !item.current">{{ t('sessionTools.activity.viewed') }}</span>
          </p>
          <p v-if="item.outcome" class="session-activity__outcome">{{ t('sessionTools.activity.outcome') }} <strong>{{ item.outcome }}</strong></p>
          <p v-if="item.errorCode" class="session-activity__error"><code dir="ltr">{{ item.errorCode }}</code></p>
          <div v-if="item.progress" class="session-activity__progress">
            <progress :value="item.progress.completed" :max="item.progress.total" :aria-label="t('sessionTools.activity.progress')" />
            <span>{{ item.progress.completed }}/{{ item.progress.total }}</span>
          </div>
          <time v-if="item.timestamp" :datetime="item.timestamp">{{ formatDate(item.timestamp, { dateStyle: 'short', timeStyle: 'short' }) }}</time>
          <button v-if="item.requestId" type="button" class="btn btn-link" :disabled="interactionsBlocked" @click="selectRequest(item.requestId)">{{ t('sessionTools.activity.openRequest') }}</button>
        </li>
      </ul>
    </section>
    <details v-if="activity.events.length" class="session-activity__history">
      <summary>{{ t('sessionTools.activity.history') }} <span>{{ activity.events.length }}</span></summary>
      <ol>
        <li v-for="event in activity.events" :key="event.id">
          <strong>{{ t(event.labelKey) }}</strong>
          <p>{{ event.title }}</p>
          <small v-if="event.current || event.viewed">{{ t(event.current ? 'sessionTools.activity.current' : 'sessionTools.activity.viewed') }}</small>
          <time v-if="eventDate(event.createdAt)" :datetime="event.createdAt">{{ eventDate(event.createdAt) }}</time>
          <details class="session-activity__technical"><summary>{{ t('sessionTools.activity.eventDetails') }}</summary><code dir="ltr">{{ event.type }} · {{ event.id }} · {{ event.sequence }}</code></details>
          <button type="button" class="btn btn-link" :disabled="interactionsBlocked" @click="selectRequest(event.requestId)">{{ t('sessionTools.activity.openRequest') }}</button>
        </li>
      </ol>
    </details>
  </section>
</template>

<style scoped>
.session-activity { min-width: 0; color: inherit; overflow-wrap: anywhere; }
.session-activity__notice { margin: 0 0 1rem; font-size: .875rem; }
.session-activity__notice--error, .session-activity__error { color: var(--bs-danger-text-emphasis, #b44c42); }
.session-activity__group { margin-block-end: 1.5rem; }
.session-activity__group h3 { display: flex; align-items: center; gap: .5rem; font-size: .875rem; font-weight: 600; margin-block-end: .625rem; }
.session-activity__group h3 span, .session-activity__empty { opacity: .65; font-size: .8rem; }
.session-activity__items { list-style: none; padding: 0; margin: 0; }
.session-activity__items li { border-bottom: 1px solid color-mix(in srgb, currentColor 12%, transparent); padding-block: .625rem; }
.session-activity__item-heading { display: flex; flex-wrap: wrap; align-items: baseline; gap: .4rem .75rem; font-size: .875rem; }
.session-activity__state { font-size: .75rem; opacity: .75; }
.session-activity__request-title, .session-activity__scope, .session-activity__outcome, .session-activity__error { margin-block: .4rem 0; font-size: .8rem; }
.session-activity__scope { opacity: .75; }
.session-activity time { display: block; font-size: .75rem; opacity: .65; margin-block-start: .3rem; }
.session-activity .btn-link { padding: .4rem 0; min-height: 44px; text-align: start; font-size: .8rem; color: inherit; }
.session-activity__progress { display: flex; align-items: center; gap: .5rem; margin-block-start: .5rem; font-size: .75rem; }
.session-activity__progress progress { flex: 1; min-width: 0; height: .4rem; accent-color: currentColor; }
.session-activity__history { font-size: .875rem; }
.session-activity__history summary { cursor: pointer; min-height: 44px; }
.session-activity__history ol { padding-inline-start: 1.25rem; }
.session-activity__history li { padding-block: .6rem; }
.session-activity__history p { margin-block: .4rem; font-size: .8rem; }
.session-activity__technical { margin-block-start: .4rem; font-size: .75rem; }
.session-activity__technical summary { min-height: 32px; }
.session-activity__technical code { white-space: normal; color: inherit; }
.session-activity button:focus-visible, .session-activity summary:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
