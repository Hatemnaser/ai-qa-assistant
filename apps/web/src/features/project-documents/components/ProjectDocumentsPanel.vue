<script setup lang="ts">
import { computed, ref, watch } from "vue";

import Icon from "../../../ui/Icon.vue";
import { PROJECT_DOCUMENT_FILE_ACCEPT } from "../projectDocumentFiles";
import type { ProjectDocument, ProjectDocumentInput } from "../types";
import ProjectDocumentAddMenu from "./ProjectDocumentAddMenu.vue";
import ProjectDocumentCard from "./ProjectDocumentCard.vue";
import ProjectDocumentPreviewModal from "./ProjectDocumentPreviewModal.vue";
import ProjectDocumentsModal from "./ProjectDocumentsModal.vue";
import ProjectDocumentTextModal from "./ProjectDocumentTextModal.vue";

const props = defineProps<{
  documents: ProjectDocument[];
  errorMessage?: string;
  isImporting?: boolean;
  isLoading?: boolean;
  isSaving?: boolean;
}>();

const emit = defineEmits<{
  create: [input: ProjectDocumentInput];
  delete: [documentId: string];
  import: [files: File[]];
  update: [documentId: string, input: ProjectDocumentInput];
}>();

const fileInput = ref<HTMLInputElement | null>(null);
const documentToEdit = ref<ProjectDocument | null>(null);
const documentToPreview = ref<ProjectDocument | null>(null);
const isDraggingOver = ref(false);
const isLibraryModalOpen = ref(false);
const isTextModalOpen = ref(false);
const shouldReturnToLibrary = ref(false);
const wasSaving = ref(false);

const isBusy = computed(() => Boolean(props.isImporting || props.isSaving));
const hasDocumentOverflow = computed(() => props.documents.length > 4);
const hiddenDocumentCount = computed(() => Math.max(0, props.documents.length - 3));
const previewDocuments = computed(() =>
  hasDocumentOverflow.value ? props.documents.slice(0, 3) : props.documents.slice(0, 4)
);

watch(
  () => props.isSaving,
  (isSaving) => {
    if (wasSaving.value && !isSaving && !props.errorMessage) {
      closeTextModal();
    }

    wasSaving.value = Boolean(isSaving);
  }
);

watch(
  () => props.documents.length,
  (documentCount) => {
    if (documentCount <= 4) {
      isLibraryModalOpen.value = false;
    }
  }
);

function openFilePicker() {
  if (isBusy.value) return;

  fileInput.value?.click();
}

function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  input.value = "";
  importFiles(files);
}

function handleDrop(event: DragEvent) {
  isDraggingOver.value = false;
  importFiles(Array.from(event.dataTransfer?.files || []));
}

function importFiles(files: File[]) {
  if (files.length === 0 || isBusy.value) return;

  emit("import", files);
}

function openCreateTextModal() {
  if (isBusy.value) return;

  documentToEdit.value = null;
  isTextModalOpen.value = true;
}

function openCreateTextFromLibrary() {
  isLibraryModalOpen.value = false;
  openCreateTextModal();
}

function openEditTextModal(document: ProjectDocument) {
  if (isBusy.value || document.source !== "USER_PROVIDED") return;

  isLibraryModalOpen.value = false;
  documentToEdit.value = document;
  isTextModalOpen.value = true;
}

function openDocumentPreview(document: ProjectDocument, fromLibrary = false) {
  shouldReturnToLibrary.value = fromLibrary;
  isLibraryModalOpen.value = false;
  documentToPreview.value = document;
}

function closeDocumentPreview() {
  documentToPreview.value = null;

  if (shouldReturnToLibrary.value && props.documents.length > 4) {
    isLibraryModalOpen.value = true;
  }

  shouldReturnToLibrary.value = false;
}

function closeTextModal() {
  if (props.isSaving) return;

  isTextModalOpen.value = false;
  documentToEdit.value = null;
}

function saveTextContent(input: ProjectDocumentInput) {
  if (documentToEdit.value) {
    emit("update", documentToEdit.value.id, input);
    return;
  }

  emit("create", input);
}

</script>

<template>
  <section
    class="project-knowledge__section project-documents-section"
    :class="{ 'is-dragging': isDraggingOver }"
    @dragenter.prevent="isDraggingOver = true"
    @dragover.prevent="isDraggingOver = true"
    @dragleave.prevent="isDraggingOver = false"
    @drop.prevent="handleDrop"
  >
    <header class="project-knowledge__header">
      <h2>Documents</h2>

      <ProjectDocumentAddMenu :disabled="isBusy" @add-text="openCreateTextModal" @upload="openFilePicker" />

      <input
        ref="fileInput"
        type="file"
        :accept="PROJECT_DOCUMENT_FILE_ACCEPT"
        multiple
        hidden
        @change="handleFileChange"
      />
    </header>

    <p v-if="errorMessage && !isTextModalOpen" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="isLoading" class="project-documents-empty">Loading documents...</div>

    <button
      v-else-if="documents.length === 0"
      class="project-documents-empty"
      type="button"
      :disabled="isBusy"
      @click="openFilePicker"
    >
      <Icon name="upload" />
      <span>{{ isImporting ? "Importing files..." : "Drop files here or choose files to upload" }}</span>
      <small>Text, Markdown, data, HTML, CSS, JavaScript, or TypeScript. Up to 1MB each.</small>
    </button>

    <div v-else class="project-document-grid">
      <ProjectDocumentCard
        v-for="document in previewDocuments"
        :key="document.id"
        :document="document"
        :is-busy="isBusy"
        @delete="emit('delete', $event)"
        @edit="openEditTextModal"
        @preview="openDocumentPreview"
      />
      <button
        v-if="hasDocumentOverflow"
        class="project-document-more"
        type="button"
        :aria-label="`View all ${documents.length} project documents`"
        @click="isLibraryModalOpen = true"
      >
        <span>+{{ hiddenDocumentCount }}</span>
        <small>View all files</small>
      </button>
    </div>

    <ProjectDocumentsModal
      :documents="documents"
      :error-message="errorMessage"
      :is-busy="isBusy"
      :is-open="isLibraryModalOpen"
      @add-text="openCreateTextFromLibrary"
      @cancel="isLibraryModalOpen = false"
      @delete="emit('delete', $event)"
      @edit="openEditTextModal"
      @import="importFiles"
      @preview="openDocumentPreview($event, true)"
      @request-upload="openFilePicker"
    />

    <ProjectDocumentPreviewModal :document="documentToPreview" @cancel="closeDocumentPreview" />

    <ProjectDocumentTextModal
      :document="documentToEdit"
      :error-message="errorMessage"
      :is-open="isTextModalOpen"
      :is-saving="Boolean(isSaving)"
      @cancel="closeTextModal"
      @save="saveTextContent"
    />
  </section>
</template>
