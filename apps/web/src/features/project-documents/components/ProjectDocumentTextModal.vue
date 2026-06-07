<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import type { ProjectDocument, ProjectDocumentInput } from "../types";

const props = defineProps<{
  document: ProjectDocument | null;
  errorMessage?: string;
  isOpen: boolean;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [input: ProjectDocumentInput];
}>();

const form = reactive({
  content: "",
  title: "",
});
const isEditing = computed(() => Boolean(props.document));
const canSave = computed(() => Boolean(form.title.trim() && form.content.trim() && !props.isSaving));

watch(
  () => [props.isOpen, props.document] as const,
  () => {
    form.title = props.document?.title || "";
    form.content = props.document?.content || "";
  },
  { immediate: true }
);

function requestCancel() {
  if (props.isSaving) return;

  emit("cancel");
}

function requestSave() {
  if (!canSave.value) return;

  emit("save", {
    content: form.content.trim(),
    mimeType: "text/markdown",
    title: form.title.trim(),
  });
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
      aria-labelledby="project-document-text-title"
      @click.self="requestCancel"
    >
      <div class="modal-dialog modal-dialog-centered project-document-text-dialog">
        <form class="modal-content app-modal project-document-text-modal" @submit.prevent="requestSave">
          <div class="modal-header">
            <h2 id="project-document-text-title" class="modal-title">
              {{ isEditing ? "Edit text content" : "Add text content" }}
            </h2>
            <button class="btn-close" type="button" aria-label="Close" :disabled="isSaving" @click="requestCancel"></button>
          </div>

          <div class="modal-body project-document-text-modal__body">
            <label class="project-form-modal__field">
              <span class="form-label">Title</span>
              <input
                v-model="form.title"
                class="form-control"
                maxlength="160"
                placeholder="Name your content"
                autofocus
              />
            </label>

            <label class="project-form-modal__field">
              <span class="form-label">Content</span>
              <textarea
                v-model="form.content"
                class="form-control"
                maxlength="50000"
                placeholder="Type or paste text here."
              ></textarea>
            </label>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
              {{ errorMessage }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">
              Cancel
            </button>
            <button class="btn btn-primary" type="submit" :disabled="!canSave">
              {{ isSaving ? "Saving..." : isEditing ? "Save changes" : "Add content" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
