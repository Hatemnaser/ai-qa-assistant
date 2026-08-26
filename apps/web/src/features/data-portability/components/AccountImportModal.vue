<script setup lang="ts">
import { ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { AccountImportCommitResult } from "../accountDataPortabilityApi";
import { useAccountImportFlow } from "../accountImportFlow";
import { localizeAccountImportWarning } from "../accountImportWarnings";

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{
  cancel: [];
  imported: [result: AccountImportCommitResult];
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
} = useAccountImportFlow();

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) resetFileState();
  }
);

function requestCancel() {
  if (isPreviewing.value || isCommitting.value) return;
  resetFileState();
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
    errorMessage.value = t("portability.import.fileType");
    input.value = "";
    return;
  }

  selectFile(file);
}

async function importAccount() {
  const result = await commitSelectedFile();
  if (!result) return;

  emit("imported", result);
  resetFileState();
}

function resetFileState() {
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
      aria-labelledby="account-import-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable account-import-dialog">
        <div class="modal-content app-modal account-import-modal">
          <div class="modal-header">
            <h2 id="account-import-title" class="modal-title">
              {{ t("portability.import.title") }}
            </h2>
            <button
              class="btn-close"
              type="button"
              :aria-label="t('app.actions.close')"
              :disabled="isPreviewing || isCommitting"
              @click="requestCancel"
            ></button>
          </div>

          <div class="modal-body account-import-modal__body">
            <p class="account-import-note">{{ t("portability.import.autoDetectNote") }}</p>

            <input
              ref="fileInput"
              class="visually-hidden"
              type="file"
              accept=".zip,application/zip"
              data-testid="account-import-file"
              @change="handleFileSelection"
            />

            <div class="account-import-file">
              <div>
                <strong>{{ t("portability.import.chooseFile") }}</strong>
                <span>{{ selectedFile?.name || t("portability.import.noFile") }}</span>
              </div>
              <button
                class="btn btn-outline-secondary"
                type="button"
                :disabled="isPreviewing || isCommitting"
                @click="openFilePicker"
              >
                {{ t("portability.import.browse") }}
              </button>
            </div>

            <button
              class="btn btn-outline-primary account-import-preview-action"
              type="button"
              :disabled="!canPreview"
              @click="previewSelectedFile"
            >
              {{
                isPreviewing
                  ? t("portability.import.previewing")
                  : t("portability.import.preview")
              }}
            </button>

            <p
              v-if="errorMessage"
              class="workspace-feedback workspace-feedback--error mb-0"
              role="alert"
            >
              {{ errorMessage }}
            </p>

            <section v-if="preview" class="account-import-preview">
              <div class="account-import-counts">
                <div>
                  <strong>{{ preview.counts.projects }}</strong>
                  <span>{{ t("portability.import.projects") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.documents }}</strong>
                  <span>{{ t("portability.import.documents") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.chats }}</strong>
                  <span>{{ t("portability.import.chats") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.messages }}</strong>
                  <span>{{ t("portability.import.messages") }}</span>
                </div>
                <div>
                  <strong>{{ preview.counts.accountMemories }}</strong>
                  <span>{{ t("portability.import.accountMemories") }}</span>
                </div>
                <div v-if="preview.counts.binaryAssets !== undefined">
                  <strong>{{ preview.counts.binaryAssets }}</strong>
                  <span>{{ t("portability.import.assets") }}</span>
                </div>
              </div>

              <div v-if="preview.warnings.length" class="account-import-warnings">
                <h3>{{ t("portability.import.warnings") }}</h3>
                <ul>
                  <li v-for="warning in preview.warnings" :key="warning">
                    {{ localizeAccountImportWarning(warning) }}
                  </li>
                </ul>
              </div>

              <div class="account-import-digest">
                <span>{{ t("portability.import.digest") }}</span>
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
              data-testid="account-import-commit"
              @click="importAccount"
            >
              {{
                isCommitting
                  ? t("portability.import.importing")
                  : t("portability.import.commit")
              }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="isOpen" class="modal-backdrop fade show"></div>
  </Teleport>
</template>

<style lang="scss">
.account-import-dialog {
  max-width: 720px;
}

.account-import-modal {
  overflow: hidden;
}

.account-import-modal__body,
.account-import-preview {
  display: grid;
  gap: var(--space-4);
}

.account-import-note {
  margin: 0;
  color: var(--text-muted);
  line-height: var(--line-height-readable);
}

.account-import-file {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--surface-app);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.account-import-file > div,
.account-import-digest {
  display: grid;
  gap: var(--space-1);
  min-width: 0;
}

.account-import-file span {
  overflow: hidden;
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.account-import-preview-action {
  justify-self: start;
}

.account-import-preview {
  padding-top: var(--space-2);
  border-top: 1px solid var(--border);
}

.account-import-counts {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--space-3);
}

.account-import-counts > div {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-3);
  background: var(--surface-app);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}

.account-import-counts strong {
  color: var(--text-main);
  font-size: var(--font-size-lg);
}

.account-import-counts span {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
}

.account-import-warnings {
  padding: var(--space-3);
  color: var(--status-warning-text);
  background: var(--status-warning-bg);
  border: 1px solid var(--status-warning);
  border-radius: var(--radius-md);
}

.account-import-warnings h3 {
  margin: 0 0 var(--space-2);
  font-size: var(--font-size-sm);
}

.account-import-warnings ul {
  margin: 0;
  padding-inline-start: var(--space-5);
}

.account-import-digest > span {
  color: var(--text-subtle);
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-bold);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.account-import-digest code {
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

@media (max-width: 575px) {
  .account-import-file {
    align-items: stretch;
    flex-direction: column;
  }

  .account-import-counts {
    grid-template-columns: 1fr 1fr;
  }
}
</style>
