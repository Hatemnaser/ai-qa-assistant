<script setup lang="ts">
import { computed, defineAsyncComponent, nextTick, ref, useId } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import ProjectDocumentsPanel from "../../project-documents/components/ProjectDocumentsPanel.vue";
import ProjectInstructionsPanel from "../../project-instructions/components/ProjectInstructionsPanel.vue";
import ProjectMemoryPanel from "../../project-memory/components/ProjectMemoryPanel.vue";
import { useProjectMemory } from "../../project-memory/useProjectMemory";
import { useProjectKnowledge } from "../composables/useProjectKnowledge";

const ProjectIntegrationsDialog = defineAsyncComponent(() => import("./ProjectIntegrationsDialog.vue"));
const props = defineProps<{ projectId: string; projectName: string }>();
const { t } = useI18n();
const id = useId();
const root = ref<HTMLElement | null>(null);
const selectedSection = ref<"instructions" | "memory" | "files" | null>(null);
const isIntegrationsOpen = ref(false);
const projectId = computed(() => props.projectId || null);
const sections = ["instructions", "memory", "files"] as const;
const {
  addProjectDocument, documentErrorMessage, importProjectFiles, instructionErrorMessage,
  isImportingDocuments, isLoadingDocuments, isLoadingInstruction, isSavingDocument,
  isSavingInstruction, projectDocuments, projectInstruction, removeProjectDocument,
  saveProjectDocument, saveProjectInstruction,
} = useProjectKnowledge(projectId);
const {
  clearProjectMemory, isLoadingProjectMemory, isSavingProjectMemory, projectMemory,
  projectMemoryDraft, projectMemoryErrorMessage, projectMemoryStatusMessage,
  saveProjectMemory, updateProjectMemoryDraft,
} = useProjectMemory(projectId);

async function selectSection(section: typeof selectedSection.value) {
  const previousSection = selectedSection.value;
  selectedSection.value = selectedSection.value === section ? null : section;
  await nextTick();
  if (selectedSection.value) {
    root.value?.querySelector<HTMLElement>(`[data-section="${section}"] .project-context__close`)?.focus();
  } else if (previousSection) {
    root.value?.querySelector<HTMLElement>(`[data-context-trigger="${previousSection}"]`)?.focus();
  }
}

function onKeydown(event: KeyboardEvent) {
  if (event.key !== "Escape" || event.isComposing || !selectedSection.value) return;
  event.stopPropagation();
  event.preventDefault();
  void selectSection(null);
}
</script>

<template>
  <aside
    ref="root"
    class="project-context"
    :aria-label="t('projects.context.title', { project: projectName })"
    @keydown="onKeydown"
    @dragover.stop.prevent
    @drop.stop.prevent
  >
    <nav class="project-context__shortcuts" :aria-label="t('projects.context.navigation')">
      <button
        v-for="section in sections"
        :key="section"
        class="btn btn-sm btn-outline-secondary"
        type="button"
        :data-context-trigger="section"
        :aria-expanded="selectedSection === section"
        :aria-controls="`${id}-${section}`"
        @click="selectSection(section)"
      >{{ t(`projects.context.${section}`) }}</button>
    </nav>
    <div class="workspace-panel project-knowledge project-context__panels">
      <section :id="`${id}-instructions`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'instructions' }" data-section="instructions">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectInstructionsPanel
          :error-message="instructionErrorMessage" :instruction="projectInstruction"
          :is-loading="isLoadingInstruction" :is-saving="isSavingInstruction"
          @save="saveProjectInstruction"
        />
        <p v-if="instructionErrorMessage && !isSavingInstruction" class="workspace-feedback workspace-feedback--error project-context__error" role="alert">{{ instructionErrorMessage }}</p>
      </section>
      <section :id="`${id}-memory`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'memory' }" data-section="memory">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectMemoryPanel
          :draft-content="projectMemoryDraft" :error-message="projectMemoryErrorMessage"
          :is-loading="isLoadingProjectMemory" :is-saving="isSavingProjectMemory"
          :memory="projectMemory" :status-message="projectMemoryStatusMessage"
          @clear="clearProjectMemory" @save="saveProjectMemory"
          @update:draft-content="updateProjectMemoryDraft"
        />
      </section>
      <section :id="`${id}-files`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'files' }" data-section="files">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectDocumentsPanel
          :documents="projectDocuments" :error-message="documentErrorMessage"
          :is-importing="isImportingDocuments" :is-loading="isLoadingDocuments" :is-saving="isSavingDocument"
          @create="addProjectDocument" @delete="removeProjectDocument" @import="importProjectFiles" @update="saveProjectDocument"
        />
      </section>
    </div>
    <button class="btn btn-sm btn-outline-secondary project-context__integrations" type="button" @click="isIntegrationsOpen = true">{{ t('projects.integrations.title') }}</button>
    <ProjectIntegrationsDialog v-if="isIntegrationsOpen" :project-id="projectId!" :project-name="projectName" @close="isIntegrationsOpen = false" />
  </aside>
</template>
