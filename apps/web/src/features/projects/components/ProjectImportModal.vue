<script setup lang="ts">
import { ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import {
  type ProjectImportCommitResult,
} from "../projectPortabilityApi";
import { useProjectImportFlow } from "../projectPortabilityFlow";
import { localizeProjectImportWarning } from "../projectImportWarnings";

const props = defineProps<{
  isOpen: boolean;
}>();

const emit = defineEmits<{
  cancel: [];
  imported: [result: ProjectImportCommitResult];
}>();

const { t } = useI18n();
const fileInput = ref<HTMLInputElement | null>(null);
const {
  canCommit,
  canPreview,
  commitSelectedFile,
  errorMessage,
  isCommitting,
  isPreviewing,
  preview,
  previewSelectedFile,
  reset,
  selectedFile,
  selectFile,
} = useProjectImportFlow();

watch(
  () => props.isOpen,
  (isOpen) => {
    if (isOpen) return;

    reset();
    if (fileInput.value) fileInput.value.value = "";
  }
);

function requestCancel() {
  if (isPreviewing.value || isCommitting.value) return;

  reset();
  emit("cancel");
}

function openFilePicker() {
  fileInput.value?.click();
}

function handleFileSelection(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0] || null;

  if (!file) {
    selectFile(null);
    return;
  }

  if (!file.name.toLowerCase().endsWith(".zip")) {
    selectFile(null);
    errorMessage.value = t("projects.portability.import.fileType");
    input.value = "";
    return;
  }

  selectFile(file);
}

async function createImportedProject() {
  const result = await commitSelectedFile();
  if (!result) return;

  emit("imported", result);
  reset();
  if (fileInput.value) fileInput.value.value = "";
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !isPreviewing.value && !isCommitting.value,
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
      aria-labelledby="project-import-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable project-portability-dialog">
        <div class="modal-content app-modal project-portability-modal">
          <div class="modal-header">
            <h2 id="project-import-title" class="modal-title">
              {{ t("projects.portability.import.title") }}
            </h2>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isPreviewing || isCommitting"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body project-portability-modal__body">
            <input
              ref="fileInput"
              class="visually-hidden"
              type="file"
              accept=".zip,application/zip"
              data-testid="project-import-file"
              @change="handleFileSelection"
            />

            <div class="project-portability-file">
              <div>
                <strong>{{ t("projects.portability.import.chooseFile") }}</strong>
                <span>
                  {{
                    selectedFile?.name ||
                    t("projects.portability.import.noFile")
                  }}
                </span>
              </div>
              <button
                class="btn btn-outline-secondary"
                type="button"
                :disabled="isPreviewing || isCommitting"
                @click="openFilePicker"
              >
                {{ t("projects.portability.import.browse") }}
              </button>
            </div>

            <button
              class="btn btn-outline-primary project-portability-preview-action"
              type="button"
              :disabled="!canPreview"
              @click="previewSelectedFile"
            >
              {{
                isPreviewing
                  ? t("projects.portability.import.previewing")
                  : t("projects.portability.import.preview")
              }}
            </button>

            <p
              v-if="errorMessage"
              class="workspace-feedback workspace-feedback--error mb-0"
              role="alert"
            >
              {{ errorMessage }}
            </p>

            <section
              v-if="preview"
              class="project-portability-preview"
              data-testid="project-import-preview"
            >
              <dl class="project-portability-preview__identity">
                <div>
                  <dt>{{ t("projects.portability.import.sourceProject") }}</dt>
                  <dd>{{ preview.sourceProjectName }}</dd>
                </div>
                <div>
                  <dt>{{ t("projects.portability.import.newProjectName") }}</dt>
                  <dd>{{ preview.suggestedProjectName }}</dd>
                </div>
              </dl>

              <div class="project-portability-counts">
                <div>
                  <strong>{{ preview.counts.documents }}</strong>
                  <span>{{ t("projects.portability.import.documents") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.chats }}</strong>
                  <span>{{ t("projects.portability.import.chats") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.messages }}</strong>
                  <span>{{ t("projects.portability.import.messages") }}</span>
                </div>
                <div v-if="preview.counts.assets !== undefined">
                  <strong>{{ preview.counts.assets }}</strong>
                  <span>{{ t("projects.portability.import.assets") }}</span>
                </div>
              </div>

              <div v-if="preview.warnings.length > 0" class="project-portability-list">
                <h3>{{ t("projects.portability.import.warnings") }}</h3>
                <ul>
                  <li v-for="warning in preview.warnings" :key="warning">
                    {{ localizeProjectImportWarning(warning) }}
                  </li>
                </ul>
              </div>

              <div v-if="preview.unsupported.length > 0" class="project-portability-list">
                <h3>{{ t("projects.portability.import.unsupported") }}</h3>
                <ul>
                  <li v-for="item in preview.unsupported" :key="item">{{ item }}</li>
                </ul>
              </div>

              <div class="project-portability-digest">
                <span>{{ t("projects.portability.import.digest") }}</span>
                <code>{{ preview.packageDigest }}</code>
              </div>
            </section>
          </div>

          <div class="modal-footer">
            <button
              class="btn btn-outline-secondary"
              type="button"
              :disabled="isPreviewing || isCommitting"
              @click="requestCancel"
            >
              {{ t("app.actions.cancel") }}
            </button>
            <button
              class="btn btn-primary"
              type="button"
              :disabled="!canCommit"
              data-testid="project-import-commit"
              @click="createImportedProject"
            >
              {{
                isCommitting
                  ? t("projects.portability.import.creating")
                  : t("projects.portability.import.create")
              }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
