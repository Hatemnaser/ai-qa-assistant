<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { fetchUsageSummary } from "./usageApi";
import type { UsageSummary } from "./types";

const emit = defineEmits<{
  "back-to-chat": [];
}>();

const summary = ref<UsageSummary | null>(null);
const errorMessage = ref("");
const isLoading = ref(false);

const usagePercent = computed(() => {
  if (!summary.value || summary.value.limit <= 0) return 0;

  return Math.min(100, Math.round((summary.value.used / summary.value.limit) * 100));
});
const usageWindowLabel = computed(() => `${summary.value?.windowHours || 24}h window`);
const sinceLabel = computed(() => {
  if (!summary.value) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(summary.value.since));
});

onMounted(() => {
  void loadUsageSummary();
});

async function loadUsageSummary() {
  isLoading.value = true;
  errorMessage.value = "";

  try {
    summary.value = await fetchUsageSummary();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not load usage summary.";
  } finally {
    isLoading.value = false;
  }
}

function formatStatus(status: string) {
  return status
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}
</script>

<template>
  <section class="usage-page">
    <header class="usage-header d-flex align-items-start justify-content-between gap-3">
      <div>
        <p class="usage-eyebrow text-uppercase fw-bold mb-1">My Usage</p>
        <h2 class="usage-title mb-1">Credits and model activity</h2>
        <p class="usage-subtitle mb-0">Track your AI usage across credits, models, and request status.</p>
      </div>

      <div class="d-flex gap-2">
        <button class="btn btn-outline-secondary" type="button" @click="loadUsageSummary">
          Refresh
        </button>
        <button class="btn btn-outline-secondary" type="button" @click="emit('back-to-chat')">
          Back
        </button>
      </div>
    </header>

    <div v-if="isLoading" class="usage-panel">Loading usage...</div>
    <div v-else-if="errorMessage" class="usage-panel usage-panel--error">{{ errorMessage }}</div>

    <template v-else-if="summary">
      <div class="usage-grid">
        <section class="usage-panel">
          <span class="usage-metric-label">Credits used</span>
          <strong class="usage-metric-value">{{ summary.used }} / {{ summary.limit }}</strong>
          <div class="usage-progress" aria-hidden="true">
            <span :style="{ width: `${usagePercent}%` }"></span>
          </div>
          <p class="usage-note mb-0">{{ summary.remaining }} {{ summary.unit }} remaining · {{ usageWindowLabel }}</p>
        </section>

        <section class="usage-panel">
          <span class="usage-metric-label">Identity</span>
          <strong class="usage-metric-value text-capitalize">{{ summary.identityType }}</strong>
          <p class="usage-note mb-0">Counting usage since {{ sinceLabel }}.</p>
        </section>

        <section class="usage-panel">
          <span class="usage-metric-label">Requests</span>
          <strong class="usage-metric-value">
            {{ summary.statusTotals.reduce((total, item) => total + item.requests, 0) }}
          </strong>
          <p class="usage-note mb-0">Completed, failed, and reserved requests in the current window.</p>
        </section>
      </div>

      <section class="usage-panel">
        <div class="usage-section-heading">
          <h3>By Model</h3>
        </div>

        <div v-if="summary.modelTotals.length === 0" class="usage-empty">No usage recorded yet.</div>
        <div v-else class="usage-table">
          <div class="usage-table-row usage-table-row--head">
            <span>Model</span>
            <span>Requests</span>
            <span>Credits</span>
            <span>Tokens</span>
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
          <h3>Request Status</h3>
        </div>

        <div class="usage-status-list">
          <div v-for="item in summary.statusTotals" :key="item.status" class="usage-status-item">
            <span>{{ formatStatus(item.status) }}</span>
            <strong>{{ item.credits }} credits</strong>
            <small>{{ item.requests }} requests</small>
          </div>
        </div>
      </section>

      <section class="usage-panel">
        <div class="usage-section-heading">
          <h3>Recent Events</h3>
        </div>

        <div v-if="summary.recentEvents.length === 0" class="usage-empty">No recent usage events.</div>
        <div v-else class="usage-event-list">
          <div v-for="event in summary.recentEvents" :key="`${event.createdAt}:${event.model}:${event.status}`" class="usage-event">
            <div>
              <strong>{{ event.workflowIntent || event.mode || "chat" }}</strong>
              <small>{{ formatDate(event.createdAt) }} · {{ event.model || "unknown model" }}</small>
            </div>
            <span>{{ event.credits }} credits</span>
          </div>
        </div>
      </section>
    </template>
  </section>
</template>
