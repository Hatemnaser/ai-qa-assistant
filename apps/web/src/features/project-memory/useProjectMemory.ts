import { computed, ref, watch } from "vue";
import type { Ref } from "vue";

import { fetchProjectMemory, saveProjectMemory } from "./projectMemoryApi";
import type { ProjectMemory } from "./types";

export interface ProjectMemoryDependencies {
  fetchMemory: typeof fetchProjectMemory;
  saveMemory: typeof saveProjectMemory;
}

const defaultDependencies: ProjectMemoryDependencies = {
  fetchMemory: fetchProjectMemory,
  saveMemory: saveProjectMemory,
};

export function useProjectMemory(
  activeProjectId: Ref<string | null>,
  dependencies: ProjectMemoryDependencies = defaultDependencies
) {
  const memory = ref<ProjectMemory | null>(null);
  const memoryDraft = ref("");
  const memoryErrorMessage = ref("");
  const memoryStatusMessage = ref("");
  const isLoadingMemory = ref(false);
  const isSavingMemory = ref(false);
  let projectGeneration = 0;

  const hasUnsavedMemoryChanges = computed(
    () => memoryDraft.value.trim() !== (memory.value?.content || "").trim()
  );

  watch(
    activeProjectId,
    (projectId) => {
      const generation = ++projectGeneration;

      resetState();

      if (projectId) {
        void loadMemory(projectId, generation);
      }
    },
    { immediate: true }
  );

  async function loadMemory(projectId: string, generation: number) {
    isLoadingMemory.value = true;

    try {
      const loadedMemory = await dependencies.fetchMemory(projectId);

      if (isCurrentProject(projectId, generation)) {
        memory.value = loadedMemory;
        memoryDraft.value = loadedMemory?.content || "";
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        memoryErrorMessage.value = toErrorMessage(error, "Could not load project memory.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isLoadingMemory.value = false;
      }
    }
  }

  async function saveMemoryDraft() {
    const projectId = activeProjectId.value;

    if (!projectId || isSavingMemory.value) return;

    const generation = projectGeneration;
    const content = memoryDraft.value.trim();

    if (!content) return;

    isSavingMemory.value = true;
    memoryErrorMessage.value = "";
    memoryStatusMessage.value = "";

    try {
      const savedMemory = await dependencies.saveMemory(projectId, content);

      if (isCurrentProject(projectId, generation)) {
        memory.value = savedMemory;
        memoryDraft.value = savedMemory?.content || "";
        memoryStatusMessage.value = savedMemory
          ? "Project memory saved."
          : "Project memory cleared.";
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        memoryErrorMessage.value = toErrorMessage(error, "Could not save project memory.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isSavingMemory.value = false;
      }
    }
  }

  async function clearMemory() {
    const projectId = activeProjectId.value;

    if (!projectId || isSavingMemory.value) return;

    const generation = projectGeneration;

    isSavingMemory.value = true;
    memoryErrorMessage.value = "";
    memoryStatusMessage.value = "";

    try {
      await dependencies.saveMemory(projectId, "");

      if (isCurrentProject(projectId, generation)) {
        memory.value = null;
        memoryDraft.value = "";
        memoryStatusMessage.value = "Project memory cleared.";
      }
    } catch (error) {
      if (isCurrentProject(projectId, generation)) {
        memoryErrorMessage.value = toErrorMessage(error, "Could not clear project memory.");
      }
    } finally {
      if (isCurrentProject(projectId, generation)) {
        isSavingMemory.value = false;
      }
    }
  }

  function updateMemoryDraft(content: string) {
    memoryDraft.value = content;
    memoryErrorMessage.value = "";
    memoryStatusMessage.value = "";
  }

  function resetState() {
    memory.value = null;
    memoryDraft.value = "";
    memoryErrorMessage.value = "";
    memoryStatusMessage.value = "";
    isLoadingMemory.value = false;
    isSavingMemory.value = false;
  }

  function isCurrentProject(projectId: string, generation: number) {
    return activeProjectId.value === projectId && projectGeneration === generation;
  }

  return {
    clearProjectMemory: clearMemory,
    hasUnsavedMemoryChanges,
    isLoadingProjectMemory: isLoadingMemory,
    isSavingProjectMemory: isSavingMemory,
    projectMemory: memory,
    projectMemoryDraft: memoryDraft,
    projectMemoryErrorMessage: memoryErrorMessage,
    projectMemoryStatusMessage: memoryStatusMessage,
    saveProjectMemory: saveMemoryDraft,
    updateProjectMemoryDraft: updateMemoryDraft,
  };
}

function toErrorMessage(error: unknown, fallbackMessage: string) {
  return error instanceof Error ? error.message : fallbackMessage;
}
