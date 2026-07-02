import { computed, ref } from "vue";

import { t } from "../../i18n/useI18n";
import type { Project } from "./types";
import {
  commitProjectImport,
  previewProjectImport,
  type ProjectImportCommitResult,
  type ProjectImportPreview,
} from "./projectPortabilityApi";

export interface ProjectImportFlowDependencies {
  commit(file: File, packageDigest: string): Promise<ProjectImportCommitResult>;
  preview(file: File): Promise<ProjectImportPreview>;
}

export function useProjectImportFlow(
  dependencies: ProjectImportFlowDependencies = {
    commit: commitProjectImport,
    preview: previewProjectImport,
  }
) {
  const selectedFile = ref<File | null>(null);
  const preview = ref<ProjectImportPreview | null>(null);
  const errorMessage = ref("");
  const isPreviewing = ref(false);
  const isCommitting = ref(false);
  let previewRequestId = 0;

  const canPreview = computed(
    () => Boolean(selectedFile.value && !isPreviewing.value && !isCommitting.value)
  );
  const canCommit = computed(
    () =>
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
    preview.value = null;
    errorMessage.value = "";
    isPreviewing.value = false;
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
          error instanceof Error
            ? error.message
            : t("projects.portability.errors.preview");
      }

      return null;
    } finally {
      if (previewRequestId === requestId) {
        isPreviewing.value = false;
      }
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
        error instanceof Error
          ? error.message
          : t("projects.portability.errors.commit");
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

export async function refreshAndOpenImportedProject(
  result: ProjectImportCommitResult,
  dependencies: {
    openProject(project: Project): void;
    refreshChats(): Promise<void>;
    refreshProjects(): Promise<Project[]>;
  }
) {
  const projects = await dependencies.refreshProjects();
  const importedProject = projects.find((project) => project.id === result.projectId);

  if (!importedProject) {
    throw new Error(t("projects.portability.errors.refresh"));
  }

  await dependencies.refreshChats();
  dependencies.openProject(importedProject);

  return projects;
}
