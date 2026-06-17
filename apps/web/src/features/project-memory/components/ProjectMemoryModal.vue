<script setup lang="ts">
import { computed, ref, watch } from "vue";

import type { ProjectMemory } from "../types";

const props = defineProps<{
  draftContent: string;
  errorMessage?: string;
  isLoading: boolean;
  isOpen: boolean;
  isSaving: boolean;
  memory: ProjectMemory | null;
  statusMessage?: string;
}>();

const emit = defineEmits<{
  cancel: [];
  clear: [];
  save: [];
  "update:draft-content": [value: string];
}>();

const isClearConfirmationVisible = ref(false);
const savedContent = computed(() => props.memory?.content || "");
const hasUnsavedChanges = computed(
  () => props.draftContent.trim() !== savedContent.value.trim()
);
const canSave = computed(
  () => !props.isLoading && !props.isSaving && hasUnsavedChanges.value
);
const isBusy = computed(() => props.isLoading || props.isSaving);

watch(
  () => [props.isOpen, props.memory?.content] as const,
  () => {
    isClearConfirmationVisible.value = false;
  }
);

function requestCancel() {
  if (props.isSaving) return;

  emit("cancel");
}

function requestSave() {
  if (!canSave.value) return;

  if (savedContent.value && !props.draftContent.trim()) {
    isClearConfirmationVisible.value = true;
    return;
  }

  emit("save");
}

function updateDraft(event: Event) {
  emit("update:draft-content", (event.target as HTMLTextAreaElement).value);
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
      aria-labelledby="project-memory-title"
      @click.self="requestCancel"
    >
      <div class="modal-dialog modal-dialog-centered project-memory-dialog">
        <div class="modal-content app-modal project-memory-modal">
          <div class="modal-header">
            <div>
              <h2 id="project-memory-title" class="modal-title">Project memory</h2>
              <p class="workspace-note mb-0">
                Short project facts, decisions, and constraints the assistant should remember.
              </p>
            </div>
            <button
              class="btn-close"
              type="button"
              aria-label="Close"
              :disabled="isSaving"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-memory-modal__body">
            <section class="project-memory-editor">
              <div class="project-memory-editor__heading">
                <div>
                  <h3>Memory</h3>
                  <p class="workspace-note mb-0">
                    {{ hasUnsavedChanges ? "Unsaved edits" : memory ? "Saved memory" : "No saved memory yet" }}
                  </p>
                </div>
                <span class="project-memory-character-count">
                  {{ draftContent.length }} / 6000
                </span>
              </div>

              <textarea
                class="form-control"
                :value="draftContent"
                maxlength="6000"
                :disabled="isLoading"
                placeholder="## Stack&#10;&#10;## Decisions&#10;&#10;## Constraints&#10;&#10;## Risks&#10;&#10;## Conventions&#10;&#10;## Open Questions"
                @input="updateDraft"
              ></textarea>

              <p class="workspace-note mb-0">
                Saved memory is used by the assistant. Changes here stay as a draft until you click Save memory.
              </p>

              <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
                {{ errorMessage }}
              </p>
              <p v-else-if="statusMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
                {{ statusMessage }}
              </p>

              <div v-if="isClearConfirmationVisible" class="project-memory-confirmation" role="alert">
                <span>Clear the saved project memory? This cannot be undone.</span>
                <div>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    type="button"
                    @click="isClearConfirmationVisible = false"
                  >
                    Cancel
                  </button>
                  <button class="btn btn-sm btn-danger" type="button" @click="emit('clear')">
                    Clear memory
                  </button>
                </div>
              </div>

              <div class="project-memory-editor__actions">
                <button
                  class="btn btn-outline-danger"
                  type="button"
                  :disabled="isBusy || !memory"
                  @click="isClearConfirmationVisible = true"
                >
                  Clear memory
                </button>
                <button class="btn btn-primary" type="button" :disabled="!canSave" @click="requestSave">
                  {{ isSaving ? "Saving..." : "Save memory" }}
                </button>
              </div>
            </section>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">
              Close
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
