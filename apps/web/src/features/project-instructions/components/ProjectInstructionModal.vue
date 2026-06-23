<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";

const props = defineProps<{
  content: string;
  errorMessage?: string;
  isOpen: boolean;
  isSaving: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [content: string];
}>();

const draftContent = ref("");
const { t } = useI18n();
const canSave = computed(() => !props.isSaving && draftContent.value.trim() !== props.content.trim());

watch(
  () => [props.isOpen, props.content] as const,
  () => {
    draftContent.value = props.content;
  },
  { immediate: true }
);

function requestCancel() {
  if (props.isSaving) return;

  emit("cancel");
}

function requestSave() {
  if (!canSave.value) return;

  emit("save", draftContent.value.trim());
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
      aria-labelledby="project-instruction-title"
      @click.self="requestCancel"
    >
      <div class="modal-dialog modal-dialog-centered project-instruction-dialog">
        <form class="modal-content app-modal project-instruction-modal" @submit.prevent="requestSave">
          <div class="modal-header">
            <div>
              <h2 id="project-instruction-title" class="modal-title">{{ t("projects.instructions.modalTitle") }}</h2>
              <p class="workspace-note mb-0">
                {{ t("projects.instructions.modalNote") }}
              </p>
            </div>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isSaving"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-instruction-modal__body">
            <textarea
              v-model="draftContent"
              class="form-control"
              maxlength="12000"
              :placeholder="t('projects.instructions.placeholder')"
              autofocus
            ></textarea>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
              {{ errorMessage }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-primary" type="submit" :disabled="!canSave">
              {{ isSaving ? t("projects.form.saving") : t("projects.instructions.save") }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
