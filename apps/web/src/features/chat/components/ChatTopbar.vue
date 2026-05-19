<script setup lang="ts">
import { computed, ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { GEMINI_MODELS, QA_MODES, getModelHint } from "../constants";
import type { ExportFormat } from "../types";

const props = defineProps<{
  currentUser?: AuthUser | null;
  mode: string;
  model: string;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "update:mode": [value: string];
  "update:model": [value: string];
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "sign-in": [];
  "toggle-theme": [];
}>();

const importChatInput = ref<HTMLInputElement | null>(null);

const selectedModeOption = computed(() => QA_MODES.find((option) => option.value === props.mode) || QA_MODES[0]);
const selectedModelOption = computed(
  () => GEMINI_MODELS.find((option) => option.value === props.model) || GEMINI_MODELS[0]
);
const modelHint = computed(() => getModelHint(props.model, props.mode));

function openImportChatPicker() {
  importChatInput.value?.click();
}

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
            <li v-for="modelOption in GEMINI_MODELS" :key="modelOption.value">
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

      <div class="dropdown">
        <button
          class="btn btn-sm btn-outline-secondary topbar-icon-btn d-inline-flex align-items-center justify-content-center"
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
          <li v-if="props.currentUser">
            <hr class="dropdown-divider" />
          </li>
          <li v-if="props.currentUser">
            <button class="dropdown-item disabled text-truncate" type="button" disabled>
              {{ props.currentUser.name || props.currentUser.email }}
            </button>
          </li>
          <li v-if="props.currentUser">
            <button class="dropdown-item" type="button" @click="emit('logout')">Sign out</button>
          </li>
          <li v-else>
            <button class="dropdown-item" type="button" @click="emit('sign-in')">Sign in</button>
          </li>
        </ul>
      </div>

      <span class="topbar-status d-inline-flex align-items-center">Online</span>

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
