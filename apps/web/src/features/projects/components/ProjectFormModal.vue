<script setup lang="ts">
import { computed, reactive, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import type { Project, ProjectInput } from "../types";

const props = defineProps<{
  errorMessage?: string;
  isOpen: boolean;
  isSaving: boolean;
  project: Project | null;
}>();

const emit = defineEmits<{
  cancel: [];
  save: [input: ProjectInput];
}>();

const form = reactive({
  description: "",
  name: "",
});

const { t } = useI18n();
const isEditing = computed(() => Boolean(props.project));
const title = computed(() => (isEditing.value ? t("projects.form.editTitle") : t("projects.form.createTitle")));
const submitLabel = computed(() => {
  if (props.isSaving) return isEditing.value ? t("projects.form.saving") : t("projects.form.creating");

  return isEditing.value ? t("projects.form.saveChanges") : t("projects.form.createSubmit");
});
const canSubmit = computed(() => Boolean(form.name.trim() && !props.isSaving));

watch(
  () => [props.isOpen, props.project] as const,
  () => {
    form.name = props.project?.name || "";
    form.description = props.project?.description || "";
  },
  { immediate: true }
);

function requestCancel() {
  if (props.isSaving) return;

  emit("cancel");
}

function submitProject() {
  if (!canSubmit.value) return;

  emit("save", {
    description: form.description.trim() || null,
    name: form.name.trim(),
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
      aria-labelledby="project-form-title"
      @click.self="requestCancel"
    >
      <div class="modal-dialog modal-dialog-centered project-form-dialog">
        <form class="modal-content app-modal project-form-modal" @submit.prevent="submitProject">
          <div class="modal-header">
            <h2 id="project-form-title" class="modal-title">{{ title }}</h2>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isSaving"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-form-modal__body">
            <label class="project-form-modal__field">
              <span class="form-label">{{ t("projects.form.nameLabel") }}</span>
              <input
                v-model="form.name"
                class="form-control"
                maxlength="120"
                :placeholder="t('projects.form.namePlaceholder')"
                autofocus
              />
            </label>

            <label class="project-form-modal__field">
              <span class="form-label">{{ t("projects.form.descriptionLabel") }}</span>
              <textarea
                v-model="form.description"
                class="form-control"
                maxlength="1000"
                :placeholder="t('projects.form.descriptionPlaceholder')"
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
            <button class="btn btn-primary" type="submit" :disabled="!canSubmit">
              {{ submitLabel }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
