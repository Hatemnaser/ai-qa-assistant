<script setup lang="ts">
import type { Project } from "../types";

const props = defineProps<{
  isDeleting?: boolean;
  project: Project | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

function requestCancel() {
  if (props.isDeleting) return;

  emit("cancel");
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="project"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-project-title"
      @click.self="requestCancel"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content app-modal">
          <div class="modal-header">
            <h5 id="delete-project-title" class="modal-title">Delete project?</h5>
            <button class="btn-close" type="button" aria-label="Close" :disabled="isDeleting" @click="requestCancel"></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">
              This will delete "{{ project.name }}". Assigned chats stay saved and move back to no project.
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isDeleting" @click="requestCancel">
              Cancel
            </button>
            <button class="btn btn-danger" type="button" :disabled="isDeleting" @click="emit('confirm')">
              {{ isDeleting ? "Deleting..." : "Delete" }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="project" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
