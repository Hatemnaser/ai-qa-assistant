<script setup lang="ts">
import { computed } from "vue";

import { AI_MODELS, QA_MODES, getModelHint } from "../constants";
import type { ChatUsageSummary } from "../types";

const props = defineProps<{
  mode: string;
  model: string;
  usageSummary?: ChatUsageSummary | null;
}>();

const emit = defineEmits<{
  "update:mode": [value: string];
  "update:model": [value: string];
}>();

const selectedModeOption = computed(() => QA_MODES.find((option) => option.value === props.mode) || QA_MODES[0]);
const selectedModelOption = computed(
  () => AI_MODELS.find((option) => option.value === props.model) || AI_MODELS[0]
);
const modelHint = computed(() => getModelHint(props.model, props.mode));
const usageLabel = computed(() => {
  if (!props.usageSummary) return "";

  const remaining = props.usageSummary.remaining;
  return `${remaining} messages left today`;
});

function selectModel(value: string) {
  emit("update:model", value);
}

function selectMode(value: string) {
  emit("update:mode", value);
}
</script>

<template>
  <header class="chat-topbar d-flex align-items-center justify-content-between">
    <div>
      <h2 class="topbar-title">QA Chat</h2>
      <p class="topbar-subtitle">Describe a feature, bug, or user story.</p>
    </div>

    <div class="topbar-controls d-flex align-items-center justify-content-end flex-wrap gap-2">
      <div class="topbar-field d-flex align-items-center gap-2">
        <span class="topbar-field-label">Model</span>
        <div class="dropdown topbar-select-dropdown">
          <button
            class="btn btn-sm btn-outline-secondary topbar-select-btn d-inline-flex align-items-center justify-content-between text-start"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            :title="modelHint"
          >
            {{ selectedModelOption.label }}
          </button>

          <ul class="dropdown-menu dropdown-menu-end topbar-select-menu">
            <li v-for="modelOption in AI_MODELS" :key="modelOption.value">
              <button
                class="dropdown-item"
                :class="{ active: modelOption.value === props.model }"
                type="button"
                :title="modelOption.recommendedFor"
                @click="selectModel(modelOption.value)"
              >
                {{ modelOption.label }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div class="topbar-field d-flex align-items-center gap-2">
        <span class="topbar-field-label">Mode</span>
        <div class="dropdown topbar-select-dropdown">
          <button
            class="btn btn-sm btn-outline-secondary topbar-select-btn topbar-select-btn--mode d-inline-flex align-items-center justify-content-between text-start"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            {{ selectedModeOption.label }}
          </button>

          <ul class="dropdown-menu dropdown-menu-end topbar-select-menu">
            <li v-for="modeOption in QA_MODES" :key="modeOption.value">
              <button
                class="dropdown-item"
                :class="{ active: modeOption.value === props.mode }"
                type="button"
                @click="selectMode(modeOption.value)"
              >
                {{ modeOption.label }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <span v-if="usageLabel" class="topbar-status topbar-status--quota d-inline-flex align-items-center">
        {{ usageLabel }}
      </span>

      <span class="topbar-status d-inline-flex align-items-center">Online</span>
    </div>
  </header>
</template>
