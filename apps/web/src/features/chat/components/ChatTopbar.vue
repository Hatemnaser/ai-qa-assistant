<script setup lang="ts">
import { computed, ref } from "vue";

import { GEMINI_MODELS, QA_MODES, getModelHint } from "../constants";
import type { ExportFormat } from "../types";

const props = defineProps<{
  mode: string;
  model: string;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "update:mode": [value: string];
  "update:model": [value: string];
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  "toggle-theme": [];
}>();

const importChatInput = ref<HTMLInputElement | null>(null);

const selectedMode = computed({
  get: () => props.mode,
  set: (value: string) => emit("update:mode", value),
});

const selectedModel = computed({
  get: () => props.model,
  set: (value: string) => emit("update:model", value),
});
const modelHint = computed(() => getModelHint(props.model, props.mode));

function openImportChatPicker() {
  importChatInput.value?.click();
}
</script>

<template>
  <header class="chat-topbar d-flex align-items-center justify-content-between position-sticky top-0 z-3 px-4 py-3">
    <div>
      <h2 class="h5 fw-bold mb-1">QA Chat</h2>
      <p class="small text-secondary mb-0">Describe a feature, bug, or user story.</p>
    </div>

    <div class="topbar-controls d-flex align-items-center gap-2 flex-wrap justify-content-end">
      <label class="topbar-field">
        <span class="topbar-field-label">Model</span>
        <select v-model="selectedModel" class="form-select form-select-sm topbar-select" :title="modelHint">
          <option
            v-for="modelOption in GEMINI_MODELS"
            :key="modelOption.value"
            :title="modelOption.recommendedFor"
            :value="modelOption.value"
          >
            {{ modelOption.label }}
          </option>
        </select>
      </label>

      <label class="topbar-field">
        <span class="topbar-field-label">Mode</span>
        <select id="qa-mode" v-model="selectedMode" class="form-select form-select-sm">
          <option v-for="modeOption in QA_MODES" :key="modeOption.value" :value="modeOption.value">
            {{ modeOption.label }}
          </option>
        </select>
      </label>

      <div class="dropdown">
        <button
          id="topbar-actions-btn"
          class="btn btn-sm btn-outline-secondary topbar-icon-btn"
          type="button"
          data-bs-toggle="dropdown"
          aria-expanded="false"
          aria-label="Chat actions"
        >
          ⋯
        </button>

        <ul class="dropdown-menu dropdown-menu-end topbar-actions-menu">
          <li>
            <button class="dropdown-item" type="button" @click="emit('export-active-chat', 'json')">
              Export Chat
            </button>
          </li>
          <li>
            <button class="dropdown-item" type="button" @click="openImportChatPicker">
              Import Chat
            </button>
          </li>
          <li>
            <button class="dropdown-item" type="button" @click="emit('toggle-theme')">
              {{ props.themeToggleLabel }}
            </button>
          </li>
        </ul>
      </div>

      <span class="badge rounded-pill status">Online</span>

      <input
        ref="importChatInput"
        type="file"
        accept="application/json,.json"
        hidden
        @change="emit('import-chat', $event)"
      />
    </div>
  </header>
</template>
