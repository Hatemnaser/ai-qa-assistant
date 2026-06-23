<script setup lang="ts">
import { ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import Icon from "../../../ui/Icon.vue";
import type { ProjectDocument } from "../types";
import ProjectDocumentAddMenu from "./ProjectDocumentAddMenu.vue";
import ProjectDocumentCard from "./ProjectDocumentCard.vue";

const props = defineProps<{
  documents: ProjectDocument[];
  errorMessage?: string;
  isBusy?: boolean;
  isOpen: boolean;
}>();

const emit = defineEmits<{
  addText: [];
  cancel: [];
  delete: [documentId: string];
  edit: [document: ProjectDocument];
  import: [files: File[]];
  preview: [document: ProjectDocument];
  requestUpload: [];
}>();

const dragDepth = ref(0);
const isDraggingOver = ref(false);
const { t } = useI18n();

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) resetDragState();
  }
);

function handleDragEnter() {
  dragDepth.value += 1;
  isDraggingOver.value = true;
}

function handleDragLeave() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  isDraggingOver.value = dragDepth.value > 0;
}

function handleDrop(event: DragEvent) {
  resetDragState();

  const files = Array.from(event.dataTransfer?.files || []);

  if (files.length > 0) {
    emit("import", files);
  }
}

function resetDragState() {
  dragDepth.value = 0;
  isDraggingOver.value = false;
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-documents-title"
      @click.self="emit('cancel')"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable project-documents-dialog">
        <div
          class="modal-content app-modal project-documents-modal"
          :class="{ 'is-dragging': isDraggingOver }"
          @dragenter.prevent="handleDragEnter"
          @dragover.prevent="isDraggingOver = true"
          @dragleave.prevent="handleDragLeave"
          @drop.prevent="handleDrop"
        >
          <div class="modal-header">
            <div>
              <h2 id="project-documents-title" class="modal-title">{{ t("projects.documents.modalTitle") }}</h2>
              <p class="workspace-note mb-0">
                {{
                  t(documents.length === 1 ? "projects.documents.countOne" : "projects.documents.countMany", {
                    count: documents.length,
                  })
                }}
              </p>
            </div>
            <div class="project-documents-modal__header-actions">
              <ProjectDocumentAddMenu
                :disabled="isBusy"
                @add-text="emit('addText')"
                @upload="emit('requestUpload')"
              />
              <button class="btn-close" type="button" :aria-label="t('app.actions.close')" @click="emit('cancel')"></button>
            </div>
          </div>

          <div class="modal-body">
            <div v-if="isDraggingOver" class="project-documents-modal__drag-feedback" aria-hidden="true">
              <Icon name="upload" />
              <span>{{ t("projects.documents.dropFiles") }}</span>
            </div>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
              {{ errorMessage }}
            </p>

            <div class="project-document-grid project-document-grid--library">
              <ProjectDocumentCard
                v-for="document in documents"
                :key="document.id"
                :document="document"
                :is-busy="isBusy"
                @delete="emit('delete', $event)"
                @edit="emit('edit', $event)"
                @preview="emit('preview', $event)"
              />
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="emit('cancel')">
              {{ t("app.actions.close") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
