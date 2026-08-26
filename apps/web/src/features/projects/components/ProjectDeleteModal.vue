<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { Project } from "../types";

const props = defineProps<{
  isDeleting?: boolean;
  project: Project | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const { t } = useI18n();

function requestCancel() {
  if (props.isDeleting) return;

  emit("cancel");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !props.isDeleting,
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
      aria-labelledby="delete-project-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content app-modal">
          <div class="modal-header">
            <h5 id="delete-project-title" class="modal-title">{{ t("projects.delete.title") }}</h5>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isDeleting"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">
              {{ t("projects.delete.body", { project: project.name }) }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isDeleting" @click="requestCancel">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-danger" type="button" :disabled="isDeleting" @click="emit('confirm')">
              {{ isDeleting ? t("projects.delete.deleting") : t("app.actions.delete") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="project" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
