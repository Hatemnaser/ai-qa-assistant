<script setup lang="ts">
import { computed, reactive, watch } from "vue";

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

const isEditing = computed(() => Boolean(props.project));
const title = computed(() => (isEditing.value ? "Edit project" : "Create project"));
const submitLabel = computed(() => {
  if (props.isSaving) return isEditing.value ? "Saving..." : "Creating...";

  return isEditing.value ? "Save changes" : "Create project";
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
            <button class="btn-close" type="button" aria-label="Close" :disabled="isSaving" @click="requestCancel"></button>
          </div>

          <div class="modal-body project-form-modal__body">
            <label class="project-form-modal__field">
              <span class="form-label">What are you working on?</span>
              <input
                v-model="form.name"
                class="form-control"
                maxlength="120"
                placeholder="Name your project"
                autofocus
              />
            </label>

            <label class="project-form-modal__field">
              <span class="form-label">What do you want to achieve?</span>
              <textarea
                v-model="form.description"
                class="form-control"
                maxlength="1000"
                placeholder="Describe your project, goals, or scope."
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
