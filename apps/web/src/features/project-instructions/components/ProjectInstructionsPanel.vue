<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";

import Icon from "../../../ui/Icon.vue";
import ProjectInstructionModal from "./ProjectInstructionModal.vue";
import type { ProjectInstruction } from "../types";

const props = defineProps<{
  errorMessage?: string;
  instruction: ProjectInstruction | null;
  isLoading?: boolean;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  save: [content: string];
}>();

const isModalOpen = ref(false);
const isPreviewTruncated = ref(false);
const previewElement = ref<HTMLElement | null>(null);
const wasSaving = ref(false);
let previewResizeObserver: ResizeObserver | null = null;

watch(
  () => props.isSaving,
  (isSaving) => {
    if (wasSaving.value && !isSaving && !props.errorMessage) {
      isModalOpen.value = false;
    }

    wasSaving.value = Boolean(isSaving);
  }
);

watch(
  () => props.instruction?.content,
  () => {
    void updatePreviewTruncation();
  }
);

onMounted(() => {
  if (typeof ResizeObserver !== "undefined") {
    previewResizeObserver = new ResizeObserver(() => {
      measurePreviewTruncation();
    });
  }

  void updatePreviewTruncation();
});

onBeforeUnmount(() => {
  previewResizeObserver?.disconnect();
});

function openInstructionModal() {
  isModalOpen.value = true;
}

function requestSave(content: string) {
  emit("save", content);
}

async function updatePreviewTruncation() {
  await nextTick();

  previewResizeObserver?.disconnect();

  if (previewElement.value) {
    previewResizeObserver?.observe(previewElement.value);
  }

  measurePreviewTruncation();
}

function measurePreviewTruncation() {
  const preview = previewElement.value;

  if (!preview) {
    isPreviewTruncated.value = false;
    return;
  }

  isPreviewTruncated.value = preview.scrollHeight > preview.clientHeight + 1;
}
</script>

<template>
  <section class="project-knowledge__section">
    <header class="project-knowledge__header">
      <h2>Instructions</h2>
      <button
        class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
        type="button"
        aria-label="Edit project instructions"
        :disabled="isLoading || isSaving"
        @click="openInstructionModal"
      >
        <Icon name="edit" />
      </button>
    </header>

    <p v-if="isLoading" class="workspace-note mb-0">Loading instructions...</p>
    <div v-else-if="instruction?.content" class="project-instructions-summary">
      <p ref="previewElement" class="project-instructions-preview mb-0">
        {{ instruction.content }}
      </p>
      <button
        v-if="isPreviewTruncated"
        class="project-instructions-more"
        type="button"
        @click="openInstructionModal"
      >
        Show more
      </button>
    </div>
    <p v-else class="workspace-note mb-0">Add instructions for chats in this project.</p>

    <ProjectInstructionModal
      :content="instruction?.content || ''"
      :error-message="errorMessage"
      :is-open="isModalOpen"
      :is-saving="Boolean(isSaving)"
      @cancel="isModalOpen = false"
      @save="requestSave"
    />
  </section>
</template>
