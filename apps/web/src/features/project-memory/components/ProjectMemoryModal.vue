<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
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
const { t } = useI18n();
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
              <h2 id="project-memory-title" class="modal-title">{{ t("projects.memory.modalTitle") }}</h2>
              <p class="workspace-note mb-0">
                {{ t("projects.memory.modalNote") }}
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

          <div class="modal-body project-memory-modal__body">
            <section class="project-memory-editor">
              <div class="project-memory-editor__heading">
                <div>
                  <h3>{{ t("projects.memory.title") }}</h3>
                  <p class="workspace-note mb-0">
                    {{
                      hasUnsavedChanges
                        ? t("projects.memory.unsavedEdits")
                        : memory
                          ? t("projects.memory.savedMemory")
                          : t("projects.memory.noSavedMemory")
                    }}
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
                :placeholder="t('projects.memory.placeholder')"
                @input="updateDraft"
              ></textarea>

              <p class="workspace-note mb-0">
                {{ t("projects.memory.draftNote") }}
              </p>

              <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
                {{ errorMessage }}
              </p>
              <p v-else-if="statusMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
                {{ statusMessage }}
              </p>

              <div v-if="isClearConfirmationVisible" class="project-memory-confirmation" role="alert">
                <span>{{ t("projects.memory.clearConfirm") }}</span>
                <div>
                  <button
                    class="btn btn-sm btn-outline-secondary"
                    type="button"
                    @click="isClearConfirmationVisible = false"
                  >
                    {{ t("app.actions.cancel") }}
                  </button>
                  <button class="btn btn-sm btn-danger" type="button" @click="emit('clear')">
                    {{ t("projects.memory.clear") }}
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
                  {{ t("projects.memory.clear") }}
                </button>
                <button class="btn btn-primary" type="button" :disabled="!canSave" @click="requestSave">
                  {{ isSaving ? t("projects.form.saving") : t("projects.memory.save") }}
                </button>
              </div>
            </section>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="requestCancel">
              {{ t("app.actions.close") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
