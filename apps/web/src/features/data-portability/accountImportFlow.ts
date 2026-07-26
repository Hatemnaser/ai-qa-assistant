import { computed, ref } from "vue";

import { t } from "../../i18n/useI18n";
import {
  commitAccountImport,
  previewAccountImport,
  type AccountImportCommitResult,
  type AccountImportPreview,
} from "./accountDataPortabilityApi";

export interface AccountImportFlowDependencies {
  commit(file: File, packageDigest: string): Promise<AccountImportCommitResult>;
  preview(file: File): Promise<AccountImportPreview>;
}

export function useAccountImportFlow(
  dependencies: AccountImportFlowDependencies = {
    commit: commitAccountImport,
    preview: previewAccountImport,
  }
) {
  const selectedFile = ref<File | null>(null);
  const preview = ref<AccountImportPreview | null>(null);
  const errorMessage = ref("");
  const isPreviewing = ref(false);
  const isCommitting = ref(false);
  let previewRequestId = 0;

  const canPreview = computed(
    () => Boolean(selectedFile.value && !isPreviewing.value && !isCommitting.value)
  );
  const canCommit = computed(() =>
    Boolean(
      selectedFile.value &&
        preview.value &&
        !isPreviewing.value &&
        !isCommitting.value
    )
  );

  function selectFile(file: File | null) {
    previewRequestId += 1;
    selectedFile.value = file;
    clearPreview();
  }

  async function previewSelectedFile() {
    const file = selectedFile.value;
    if (!file || isPreviewing.value || isCommitting.value) return null;

    const requestId = ++previewRequestId;
    isPreviewing.value = true;
    preview.value = null;
    errorMessage.value = "";

    try {
      const result = await dependencies.preview(file);

      if (selectedFile.value === file && previewRequestId === requestId) {
        preview.value = result;
      }

      return result;
    } catch (error) {
      if (selectedFile.value === file && previewRequestId === requestId) {
        errorMessage.value =
          error instanceof Error ? error.message : t("portability.errors.preview");
      }

      return null;
    } finally {
      if (previewRequestId === requestId) isPreviewing.value = false;
    }
  }

  async function commitSelectedFile() {
    const file = selectedFile.value;
    const previewResult = preview.value;

    if (!file || !previewResult || isPreviewing.value || isCommitting.value) {
      return null;
    }

    isCommitting.value = true;
    errorMessage.value = "";

    try {
      return await dependencies.commit(file, previewResult.packageDigest);
    } catch (error) {
      errorMessage.value =
        error instanceof Error ? error.message : t("portability.errors.commit");
      return null;
    } finally {
      isCommitting.value = false;
    }
  }

  function reset() {
    previewRequestId += 1;
    selectedFile.value = null;
    preview.value = null;
    errorMessage.value = "";
    isPreviewing.value = false;
    isCommitting.value = false;
  }

  function clearPreview() {
    preview.value = null;
    errorMessage.value = "";
    isPreviewing.value = false;
  }

  return {
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
  };
}
