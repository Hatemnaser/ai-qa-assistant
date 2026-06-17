<script setup lang="ts">
import { ref } from "vue";

import type { ProjectMemory } from "../types";
import ProjectMemoryModal from "./ProjectMemoryModal.vue";

defineProps<{
  draftContent: string;
  errorMessage?: string;
  isLoading: boolean;
  isSaving: boolean;
  memory: ProjectMemory | null;
  statusMessage?: string;
}>();

const emit = defineEmits<{
  clear: [];
  save: [];
  "update:draft-content": [value: string];
}>();

const isModalOpen = ref(false);
</script>

<template>
  <section class="project-knowledge__section">
    <header class="project-knowledge__header">
      <h2>Memory</h2>
    </header>

    <p class="workspace-note mb-0">
      Key project facts and decisions remembered by the assistant.
    </p>

    <p v-if="isLoading" class="workspace-note mb-0">Loading project memory...</p>
    <p
      v-else-if="errorMessage"
      class="workspace-feedback workspace-feedback--error mb-0"
      role="alert"
    >
      {{ errorMessage }}
    </p>
    <div v-else-if="memory?.content" class="project-memory-summary">
      <p class="project-memory-preview mb-0">{{ memory.content }}</p>
      <button class="project-instructions-more" type="button" @click="isModalOpen = true">
        Review memory
      </button>
    </div>
    <div v-else class="project-memory-empty-state">
      <p class="workspace-note mb-0">No memory saved yet.</p>
      <button class="project-memory-empty" type="button" @click="isModalOpen = true">
        Review memory
      </button>
    </div>

    <ProjectMemoryModal
      :draft-content="draftContent"
      :error-message="errorMessage"
      :is-loading="isLoading"
      :is-open="isModalOpen"
      :is-saving="isSaving"
      :memory="memory"
      :status-message="statusMessage"
      @cancel="isModalOpen = false"
      @clear="emit('clear')"
      @save="emit('save')"
      @update:draft-content="emit('update:draft-content', $event)"
    />
  </section>
</template>
