import { ref, watch } from "vue";
import type { Ref } from "vue";

import { prepareProjectDocumentFiles } from "../../project-documents/projectDocumentFiles";
import {
  createProjectDocument,
  deleteProjectDocument,
  fetchProjectDocuments,
  importProjectDocuments,
  updateProjectDocument,
} from "../../project-documents/projectDocumentsApi";
import type {
  ProjectDocument,
  ProjectDocumentInput,
} from "../../project-documents/types";
import {
  fetchProjectInstruction,
  saveProjectInstruction,
} from "../../project-instructions/projectInstructionsApi";
import type { ProjectInstruction } from "../../project-instructions/types";

export interface ProjectKnowledgeDependencies {
  createDocument: typeof createProjectDocument;
  deleteDocument: typeof deleteProjectDocument;
  fetchDocuments: typeof fetchProjectDocuments;
  fetchInstruction: typeof fetchProjectInstruction;
  importDocuments: typeof importProjectDocuments;
  prepareFiles: typeof prepareProjectDocumentFiles;
  saveInstruction: typeof saveProjectInstruction;
  updateDocument: typeof updateProjectDocument;
}

const defaultDependencies: ProjectKnowledgeDependencies = {
  createDocument: createProjectDocument,
  deleteDocument: deleteProjectDocument,
  fetchDocuments: fetchProjectDocuments,
  fetchInstruction: fetchProjectInstruction,
  importDocuments: importProjectDocuments,
  prepareFiles: prepareProjectDocumentFiles,
  saveInstruction: saveProjectInstruction,
  updateDocument: updateProjectDocument,
};

export function useProjectKnowledge(
  activeProjectId: Ref<string | null>,
  dependencies: ProjectKnowledgeDependencies = defaultDependencies
) {
  const instructionErrorMessage = ref("");
  const documentErrorMessage = ref("");
  const isLoadingInstruction = ref(false);
  const isLoadingDocuments = ref(false);
  const isImportingDocuments = ref(false);
  const isSavingInstruction = ref(false);
  const isSavingDocument = ref(false);
  const projectInstruction = ref<ProjectInstruction | null>(null);
  const projectDocuments = ref<ProjectDocument[]>([]);
  let projectGeneration = 0;

  watch(
    activeProjectId,
    (projectId) => {
      const generation = ++projectGeneration;

      resetProjectKnowledge();

      if (!projectId) return;

      void loadProjectInstruction(projectId, generation);
      void loadProjectDocuments(projectId, generation);
    },
    { immediate: true }
  );

  async function loadProjectInstruction(projectId: string, generation: number) {
    isLoadingInstruction.value = true;

    try {
      const instruction = await dependencies.fetchInstruction(projectId);

      if (isCurrentProject(projectId, generation)) {
        projectInstruction.value = instruction;
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        instructionErrorMessage.value = toErrorMessage(error, "Could not load project instructions.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isLoadingInstruction.value = false;
      }
    }
  }

  async function loadProjectDocuments(projectId: string, generation: number) {
    isLoadingDocuments.value = true;

    try {
      const documents = await dependencies.fetchDocuments(projectId);

      if (isCurrentProject(projectId, generation)) {
        projectDocuments.value = documents;
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        documentErrorMessage.value = toErrorMessage(error, "Could not load project documents.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isLoadingDocuments.value = false;
      }
    }
  }

  async function saveInstruction(content: string) {
    const projectId = activeProjectId.value;

    if (!projectId) return;

    const generation = projectGeneration;
    isSavingInstruction.value = true;
    instructionErrorMessage.value = "";

    try {
      const instruction = await dependencies.saveInstruction(projectId, content);

      if (isCurrentProject(projectId, generation)) {
        projectInstruction.value = instruction;
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        instructionErrorMessage.value = toErrorMessage(error, "Could not save project instructions.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isSavingInstruction.value = false;
      }
    }
  }

  async function addDocument(input: ProjectDocumentInput) {
    await runDocumentMutation(
      "Could not save project document.",
      async (projectId) => dependencies.createDocument(projectId, input),
      (document) => {
        projectDocuments.value = [document, ...projectDocuments.value];
      }
    );
  }

  async function importFiles(files: File[]) {
    const projectId = activeProjectId.value;

    if (!projectId) return;

    const generation = projectGeneration;
    isImportingDocuments.value = true;
    documentErrorMessage.value = "";

    try {
      const preparedFiles = await dependencies.prepareFiles(files);
      const documents = await dependencies.importDocuments(projectId, preparedFiles);

      if (isCurrentProject(projectId, generation)) {
        projectDocuments.value = [...documents, ...projectDocuments.value];
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        documentErrorMessage.value = toErrorMessage(error, "Could not import project files.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isImportingDocuments.value = false;
      }
    }
  }

  async function saveDocument(documentId: string, input: ProjectDocumentInput) {
    await runDocumentMutation(
      "Could not update project document.",
      async (projectId) => dependencies.updateDocument(projectId, documentId, input),
      (document) => {
        projectDocuments.value = projectDocuments.value.map((item) =>
          item.id === document.id ? document : item
        );
      }
    );
  }

  async function removeDocument(documentId: string) {
    await runDocumentMutation(
      "Could not delete project document.",
      async (projectId) => {
        await dependencies.deleteDocument(projectId, documentId);
        return documentId;
      },
      (deletedDocumentId) => {
        projectDocuments.value = projectDocuments.value.filter(
          (document) => document.id !== deletedDocumentId
        );
      }
    );
  }

  async function runDocumentMutation<T>(
    fallbackMessage: string,
    operation: (projectId: string) => Promise<T>,
    applyResult: (result: T) => void
  ) {
    const projectId = activeProjectId.value;

    if (!projectId) return;

    const generation = projectGeneration;
    isSavingDocument.value = true;
    documentErrorMessage.value = "";

    try {
      const result = await operation(projectId);

      if (isCurrentProject(projectId, generation)) {
        applyResult(result);
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        documentErrorMessage.value = toErrorMessage(error, fallbackMessage);
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isSavingDocument.value = false;
      }
    }
  }

  function resetProjectKnowledge() {
    instructionErrorMessage.value = "";
    documentErrorMessage.value = "";
    isLoadingInstruction.value = false;
    isLoadingDocuments.value = false;
    isImportingDocuments.value = false;
    isSavingInstruction.value = false;
    isSavingDocument.value = false;
    projectInstruction.value = null;
    projectDocuments.value = [];
  }

  function isCurrentProject(projectId: string, generation: number) {
    return activeProjectId.value === projectId && projectGeneration === generation;
  }

  return {
    addProjectDocument: addDocument,
    documentErrorMessage,
    importProjectFiles: importFiles,
    instructionErrorMessage,
    isImportingDocuments,
    isLoadingDocuments,
    isLoadingInstruction,
    isSavingDocument,
    isSavingInstruction,
    projectDocuments,
    projectInstruction,
    removeProjectDocument: removeDocument,
    saveProjectDocument: saveDocument,
    saveProjectInstruction: saveInstruction,
  };
}

function toErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}
