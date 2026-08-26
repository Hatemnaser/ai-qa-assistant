<script setup lang="ts">
import { ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import CheckboxField from "../../../ui/CheckboxField.vue";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { Project } from "../types";

const props = defineProps<{
  errorMessage?: string;
  isExporting: boolean;
  project: Project | null;
}>();

const emit = defineEmits<{
  cancel: [];
  export: [includeChats: boolean];
}>();

const { t } = useI18n();
const includeChats = ref(true);

watch(
  () => props.project?.id,
  () => {
    includeChats.value = true;
  }
);

function requestCancel() {
  if (props.isExporting) return;

  emit("cancel");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !props.isExporting,
  isOpen: () => Boolean(props.project),
  onClose: requestCancel,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="project"
      ref="dialogRef"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-export-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered project-portability-dialog">
        <form
          class="modal-content app-modal project-portability-modal"
          @submit.prevent="emit('export', includeChats)"
        >
          <div class="modal-header">
            <h2 id="project-export-title" class="modal-title">
              {{ t("projects.portability.export.title") }}
            </h2>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isExporting"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-portability-modal__body">
            <p class="project-portability-modal__note">
              {{ t("projects.portability.export.note", { project: project.name }) }}
            </p>

            <CheckboxField
              id="project-export-include-chats"
              v-model="includeChats"
              :disabled="isExporting"
              :label="t('projects.portability.export.includeChats')"
            />

            <p
              v-if="errorMessage"
              class="workspace-feedback workspace-feedback--error mb-0"
              role="alert"
            >
              {{ errorMessage }}
            </p>
          </div>

          <div class="modal-footer">
            <button
              class="btn btn-outline-secondary"
              type="button"
              :disabled="isExporting"
              @click="requestCancel"
            >
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-primary" type="submit" :disabled="isExporting">
              {{
                isExporting
                  ? t("projects.portability.export.exporting")
                  : t("projects.portability.export.submit")
              }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="project" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
