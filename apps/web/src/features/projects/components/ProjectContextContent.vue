<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import ProjectDocumentsPanel from "../../project-documents/components/ProjectDocumentsPanel.vue";
import ProjectInstructionsPanel from "../../project-instructions/components/ProjectInstructionsPanel.vue";
import ProjectMemoryPanel from "../../project-memory/components/ProjectMemoryPanel.vue";
import { useProjectMemory } from "../../project-memory/useProjectMemory";
import { useProjectKnowledge } from "../composables/useProjectKnowledge";

const props = defineProps<{ projectId: string; projectName: string; focusSection?: "files" | null; displaySection?: "context" | "files"; integrationsTarget?: HTMLElement | null }>();
const emit = defineEmits<{ integrations: [] }>();
const { t } = useI18n();
const id = useId();
const root = ref<HTMLElement | null>(null);
const selectedSection = ref<"instructions" | "memory" | "files" | null>(null);
watch(() => props.focusSection, value => { selectedSection.value = value || null; });
const projectId = computed(() => props.projectId || null);
const sections = computed(() => props.displaySection ? ["instructions", "memory"] as const : ["instructions", "memory", "files"] as const);
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
  if (props.displaySection && section) {
    const element = root.value?.querySelector<HTMLElement>(`[data-section="${section}"]`);
    element?.focus({ preventScroll: true }); element?.scrollIntoView({ block: 'nearest' }); return;
  }
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
    :class="{ 'project-context--filtered': displaySection }"
    :aria-label="t('projects.context.title', { project: projectName })"
    @keydown="onKeydown"
    @dragover.stop.prevent
    @drop.stop.prevent
  >
    <h2 class="project-context__caption">{{ t('workspaces.currentContext') }}</h2>
    <nav v-show="displaySection !== 'files'" class="project-context__shortcuts" :aria-label="t('projects.context.navigation')">
      <button
        v-for="section in sections"
        :key="section"
        class="btn btn-sm btn-outline-secondary"
        type="button"
        :data-context-trigger="section"
        :aria-expanded="displaySection ? undefined : selectedSection === section"
        :aria-controls="`${id}-${section}`"
        @click="selectSection(section)"
      >{{ t(`projects.context.${section}`) }}</button>
    </nav>
    <div class="workspace-panel project-knowledge project-context__panels">
      <section v-show="displaySection !== 'files'" :id="`${id}-instructions`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'instructions' }" data-section="instructions" tabindex="-1">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectInstructionsPanel
          :error-message="instructionErrorMessage" :instruction="projectInstruction"
          :is-loading="isLoadingInstruction" :is-saving="isSavingInstruction"
          @save="saveProjectInstruction"
        />
        <p v-if="instructionErrorMessage && !isSavingInstruction" class="workspace-feedback workspace-feedback--error project-context__error" role="alert">{{ instructionErrorMessage }}</p>
      </section>
      <section v-show="displaySection !== 'files'" :id="`${id}-memory`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'memory' }" data-section="memory" tabindex="-1">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectMemoryPanel
          :draft-content="projectMemoryDraft" :error-message="projectMemoryErrorMessage"
          :is-loading="isLoadingProjectMemory" :is-saving="isSavingProjectMemory"
          :memory="projectMemory" :status-message="projectMemoryStatusMessage"
          @clear="clearProjectMemory" @save="saveProjectMemory"
          @update:draft-content="updateProjectMemoryDraft"
        />
      </section>
      <section v-show="!displaySection || displaySection === 'files'" :id="`${id}-files`" class="project-context__section" :class="{ 'is-selected': selectedSection === 'files' }" data-section="files">
        <button class="btn btn-sm btn-link project-context__close" type="button" @click="selectSection(null)">{{ t('projects.context.close') }}</button>
        <ProjectDocumentsPanel
          :documents="projectDocuments" :error-message="documentErrorMessage"
          :is-importing="isImportingDocuments" :is-loading="isLoadingDocuments" :is-saving="isSavingDocument"
          @create="addProjectDocument" @delete="removeProjectDocument" @import="importProjectFiles" @update="saveProjectDocument"
        />
      </section>
    </div>
    <Teleport :to="integrationsTarget || 'body'" :disabled="!integrationsTarget"><button class="btn btn-sm btn-outline-secondary project-context__integrations" type="button" @click="emit('integrations')">{{ t('projects.integrations.title') }}</button></Teleport>
  </aside>
</template>
