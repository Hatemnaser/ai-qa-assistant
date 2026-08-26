<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
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
const { t } = useI18n();
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

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !props.isSaving,
  isOpen: () => props.isOpen,
  onClose: requestCancel,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen"
      ref="dialogRef"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-document-text-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered project-document-text-dialog">
        <form class="modal-content app-modal project-document-text-modal" @submit.prevent="requestSave">
          <div class="modal-header">
            <h2 id="project-document-text-title" class="modal-title">
              {{ isEditing ? t("projects.documents.textEditTitle") : t("projects.documents.textAddTitle") }}
            </h2>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isSaving"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-document-text-modal__body">
            <label class="project-form-modal__field">
              <span class="form-label">{{ t("projects.documents.titleLabel") }}</span>
              <input
                v-model="form.title"
                class="form-control"
                maxlength="160"
                :placeholder="t('projects.documents.titlePlaceholder')"
                autofocus
              />
            </label>

            <label class="project-form-modal__field">
              <span class="form-label">{{ t("projects.documents.contentLabel") }}</span>
              <textarea
                v-model="form.content"
                class="form-control"
                maxlength="50000"
                :placeholder="t('projects.documents.contentPlaceholder')"
              ></textarea>
            </label>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
              {{ errorMessage }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-primary" type="submit" :disabled="!canSave">
              {{
                isSaving
                  ? t("projects.form.saving")
                  : isEditing
                    ? t("projects.form.saveChanges")
                    : t("projects.documents.addContent")
              }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
