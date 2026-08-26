<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useI18n } from "../../i18n/useI18n";
import { fetchUsageSummary } from "./usageApi";
import { getUsageStatusTranslationKey } from "./usageStatus";
import type { UsageSummary } from "./types";

const emit = defineEmits<{
  "back-to-chat": [];
}>();
const props = defineProps<{
  identityKey: string;
}>();

const summary = ref<UsageSummary | null>(null);
const errorMessage = ref("");
const isLoading = ref(false);
const { formatDate: formatLocaleDate, t } = useI18n();
let loadRevision = 0;

const usagePercent = computed(() => {
  if (!summary.value || summary.value.limit <= 0) return 0;

  return Math.min(100, Math.round((summary.value.used / summary.value.limit) * 100));
});
const usageWindowLabel = computed(() => t("usage.window", { hours: summary.value?.windowHours || 24 }));
const sinceLabel = computed(() => {
  if (!summary.value) return "";

  return formatLocaleDate(summary.value.since, {
    dateStyle: "medium",
    timeStyle: "short",
  });
});

watch(
  () => props.identityKey,
  () => {
    summary.value = null;
    errorMessage.value = "";
    isLoading.value = false;
    loadRevision += 1;

    void loadUsageSummary();
  },
  { immediate: true }
);

async function loadUsageSummary() {
  const identityKey = props.identityKey;
  const requestRevision = ++loadRevision;

  summary.value = null;
  errorMessage.value = "";
  isLoading.value = true;

  try {
    const nextSummary = await fetchUsageSummary();

    if (isCurrentRequest(identityKey, requestRevision)) {
      summary.value = nextSummary;
    }
  } catch (error) {
    if (isCurrentRequest(identityKey, requestRevision)) {
      errorMessage.value = error instanceof Error ? error.message : t("usage.loadError");
    }
  } finally {
    if (isCurrentRequest(identityKey, requestRevision)) {
      isLoading.value = false;
    }
  }
}

function isCurrentRequest(identityKey: string, requestRevision: number) {
  return props.identityKey === identityKey && loadRevision === requestRevision;
}

function formatStatus(status: string) {
  return t(getUsageStatusTranslationKey(status));
}

function formatDate(value: string) {
  return formatLocaleDate(value, {
    hour: "2-digit",
    minute: "2-digit",
  });
}
</script>

<template>
  <section class="usage-page">
    <header class="usage-header d-flex align-items-start justify-content-between gap-3">
      <div>
        <p class="usage-eyebrow text-uppercase fw-bold mb-1">{{ t("usage.eyebrow") }}</p>
        <h2 class="usage-title mb-1">{{ t("usage.title") }}</h2>
        <p class="usage-subtitle mb-0">{{ t("usage.subtitle") }}</p>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" type="button" @click="loadUsageSummary">
          {{ t("usage.refresh") }}
        </button>
        <button class="btn btn-outline-secondary" type="button" @click="emit('back-to-chat')">
          {{ t("app.actions.back") }}
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="usage-panel">{{ t("usage.loading") }}</div>
    <div v-else-if="errorMessage" class="usage-panel usage-panel--error">{{ errorMessage }}</div>

    <template v-else-if="summary">
      <div class="usage-grid">
        <section class="usage-panel">
          <span class="usage-metric-label">{{ t("usage.creditsUsed") }}</span>
          <strong class="usage-metric-value">{{ summary.used }} / {{ summary.limit }}</strong>
          <div class="usage-progress" aria-hidden="true">
            <span :style="{ width: `${usagePercent}%` }"></span>
          </div>
          <p class="usage-note mb-0">{{ t("usage.remaining", { remaining: summary.remaining, unit: summary.unit }) }} · {{ usageWindowLabel }}</p>
        </section>

        <section class="usage-panel">
          <span class="usage-metric-label">{{ t("usage.identity") }}</span>
          <strong class="usage-metric-value text-capitalize">{{ summary.identityType }}</strong>
          <p class="usage-note mb-0">{{ t("usage.countingSince", { date: sinceLabel }) }}</p>
        </section>

        <section class="usage-panel">
          <span class="usage-metric-label">{{ t("usage.requests") }}</span>
          <strong class="usage-metric-value">
            {{ summary.statusTotals.reduce((total, item) => total + item.requests, 0) }}
          </strong>
          <p class="usage-note mb-0">{{ t("usage.requestsNote") }}</p>
        </section>
      </div>

      <section class="usage-panel">
        <div class="usage-section-heading">
          <h3>{{ t("usage.byModel") }}</h3>
        </div>

        <div v-if="summary.modelTotals.length === 0" class="usage-empty">{{ t("usage.noUsage") }}</div>
        <div v-else class="usage-table">
          <div class="usage-table-row usage-table-row--head">
            <span>{{ t("usage.model") }}</span>
            <span>{{ t("usage.requests") }}</span>
            <span>{{ t("usage.credits") }}</span>
            <span>{{ t("usage.tokens") }}</span>
          </div>
          <div v-for="item in summary.modelTotals" :key="`${item.provider}:${item.model}`" class="usage-table-row">
            <span>
              <strong>{{ item.model }}</strong>
              <small>{{ item.provider }}</small>
            </span>
            <span>{{ item.requests }}</span>
            <span>{{ item.credits }}</span>
            <span>{{ item.totalTokens || "-" }}</span>
          </div>
        </div>
      </section>

      <section class="usage-panel">
        <div class="usage-section-heading">
          <h3>{{ t("usage.requestStatus") }}</h3>
        </div>

        <div class="usage-status-list">
          <div v-for="item in summary.statusTotals" :key="item.status" class="usage-status-item">
            <span>{{ formatStatus(item.status) }}</span>
            <strong>{{ t("usage.creditsCount", { count: item.credits }) }}</strong>
            <small>{{ t("usage.requestsCount", { count: item.requests }) }}</small>
          </div>
        </div>
      </section>

      <section class="usage-panel">
        <div class="usage-section-heading">
          <h3>{{ t("usage.recentEvents") }}</h3>
        </div>

        <div v-if="summary.recentEvents.length === 0" class="usage-empty">{{ t("usage.noEvents") }}</div>
        <div v-else class="usage-event-list">
          <div v-for="event in summary.recentEvents" :key="`${event.createdAt}:${event.model}:${event.status}`" class="usage-event">
            <div>
              <strong>{{ event.workflowIntent || event.mode || t("usage.chat") }}</strong>
              <small>{{ formatDate(event.createdAt) }} · {{ event.model || t("usage.unknownModel") }}</small>
            </div>
            <span>{{ t("usage.creditsCount", { count: event.credits }) }}</span>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>
