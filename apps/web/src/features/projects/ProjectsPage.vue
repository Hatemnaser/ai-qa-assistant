<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from "vue";

import ProjectDocumentsPanel from "../project-documents/components/ProjectDocumentsPanel.vue";
import ProjectInstructionsPanel from "../project-instructions/components/ProjectInstructionsPanel.vue";
import ProjectMemoryPanel from "../project-memory/components/ProjectMemoryPanel.vue";
import { useProjectMemory } from "../project-memory/useProjectMemory";
import ChatComposer from "../chat/components/ChatComposer.vue";
import type { QuickAction } from "../chat/constants";
import type { Chat, SelectedAttachment } from "../chat/types";
import ProjectAddChatsModal from "./components/ProjectAddChatsModal.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectChatList from "./components/ProjectChatList.vue";
import ProjectDeleteModal from "./components/ProjectDeleteModal.vue";
import ProjectFormModal from "./components/ProjectFormModal.vue";
import Icon from "../../ui/Icon.vue";
import { useI18n } from "../../i18n/useI18n";
import { useProjectKnowledge } from "./composables/useProjectKnowledge";
import { downloadProjectExport } from "./projectPortabilityDownload";
import {
  exportProjectZip,
  type ProjectImportCommitResult,
} from "./projectPortabilityApi";
import { refreshAndOpenImportedProject } from "./projectPortabilityFlow";
import { createProject, deleteProject, updateProject } from "./projectsApi";
import type { Project, ProjectInput } from "./types";
import type { AuthUser } from "../auth/types";

type SortKey = "activity" | "updated" | "created";
type ProjectMenuPosition = {
  left: number;
  projectId: string;
  top: number;
};

const ProjectExportModal = defineAsyncComponent(
  () => import("./components/ProjectExportModal.vue")
);
const ProjectImportModal = defineAsyncComponent(
  () => import("./components/ProjectImportModal.vue")
);

const props = defineProps<{
  chats: Chat[];
  currentUser?: AuthUser | null;
  disabled?: boolean;
  disabledMessage?: string;
  isLoadingProjects: boolean;
  isSending: boolean;
  message: string;
  mode: string;
  projectLoadError?: string;
  projectToOpenId?: string | null;
  projects: Project[];
  refreshChats: () => Promise<void>;
  refreshProjects: () => Promise<Project[]>;
  selectedAttachments: SelectedAttachment[];
}>();

const emit = defineEmits<{
  "active-project-changed": [projectId: string | null];
  "add-chats-to-project": [chatIds: string[], projectId: string];
  "attachments-selected": [files: File[]];
  "disabled-click": [];
  "open-chat": [chatId: string];
  "open-selected-attachment": [index: number];
  "projects-changed": [projects: Project[]];
  "quick-action": [action: QuickAction];
  "remove-selected-attachment": [index: number];
  "sign-in": [];
  "submit-project-message": [projectId: string];
  "update:message": [value: string];
}>();

const { t } = useI18n();
const sortOptions = computed<Array<{ key: SortKey; label: string }>>(() => [
  { key: "activity", label: t("projects.sort.activity") },
  { key: "updated", label: t("projects.sort.updated") },
  { key: "created", label: t("projects.sort.created") },
]);

const projects = computed(() => props.projects);
const searchQuery = ref("");
const sortKey = ref<SortKey>("activity");
const errorMessage = ref("");
const successMessage = ref("");
const modalErrorMessage = ref("");
const isSaving = ref(false);
const isDeleting = ref(false);
const isExportingProject = ref(false);
const isAddChatsModalOpen = ref(false);
const isProjectImportModalOpen = ref(false);
const isProjectModalOpen = ref(false);
const hasOpenedEmptyCreateModal = ref(false);
const activeProjectId = ref<string | null>(null);
const openProjectMenu = ref<ProjectMenuPosition | null>(null);
const projectToEdit = ref<Project | null>(null);
const projectPendingExport = ref<Project | null>(null);
const projectPendingDelete = ref<Project | null>(null);
const projectExportErrorMessage = ref("");
const portabilityWarnings = ref<string[]>([]);
let identityRevision = 0;
const {
  addProjectDocument,
  documentErrorMessage,
  importProjectFiles,
  instructionErrorMessage,
  isImportingDocuments,
  isLoadingDocuments,
  isLoadingInstruction,
  isSavingDocument,
  isSavingInstruction,
  projectDocuments,
  projectInstruction,
  removeProjectDocument,
  saveProjectDocument,
  saveProjectInstruction,
} = useProjectKnowledge(activeProjectId);
const {
  clearProjectMemory,
  isLoadingProjectMemory,
  isSavingProjectMemory,
  projectMemory,
  projectMemoryDraft,
  projectMemoryErrorMessage,
  projectMemoryStatusMessage,
  saveProjectMemory,
  updateProjectMemoryDraft,
} = useProjectMemory(activeProjectId);

const selectedSortLabel = computed(() => {
  if (sortKey.value === "activity") return t("projects.sort.activityShort");

  return sortOptions.value.find((option) => option.key === sortKey.value)?.label || t("projects.sort.activityShort");
});
const openMenuProject = computed(() => {
  if (!openProjectMenu.value) return null;

  return projects.value.find((project) => project.id === openProjectMenu.value?.projectId) || null;
});
const activeProject = computed(() =>
  activeProjectId.value ? projects.value.find((project) => project.id === activeProjectId.value) || null : null
);
const activeProjectChats = computed(() => {
  if (!activeProject.value) return [];

  return props.chats
    .filter((chat) => chat.projectId === activeProject.value?.id)
    .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime());
});
const filteredProjects = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  const matchedProjects = query
    ? projects.value.filter((project) => {
        const description = project.description || "";

        return `${project.name} ${description}`.toLowerCase().includes(query);
      })
    : [...projects.value];

  return matchedProjects.sort((first, second) => {
    const firstDate = getSortDate(first, sortKey.value);
    const secondDate = getSortDate(second, sortKey.value);

    return secondDate - firstDate;
  });
});
const visibleErrorMessage = computed(() => errorMessage.value || props.projectLoadError || "");

onMounted(() => {
  document.addEventListener("click", closeProjectMenu);
  document.addEventListener("scroll", closeProjectMenu, true);

  syncProjectsFromOwner();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeProjectMenu);
  document.removeEventListener("scroll", closeProjectMenu, true);
});

watch(
  () => props.currentUser?.id,
  () => {
    identityRevision += 1;
    resetAccountScopedState();
    syncProjectsFromOwner();
  },
  { flush: "sync" }
);

watch(
  [() => props.projects, () => props.isLoadingProjects],
  () => {
    syncProjectsFromOwner();
  }
);

watch(
  () => props.projectToOpenId,
  () => {
    syncRequestedProject();
  }
);

function syncProjectsFromOwner() {
  syncActiveProject();
  syncRequestedProject();

  if (props.currentUser && !props.isLoadingProjects && !props.projectLoadError) {
    openCreateModalForEmptyWorkspace();
  }
}

function openCreateModalForEmptyWorkspace() {
  if (projects.value.length > 0 || hasOpenedEmptyCreateModal.value) return;

  hasOpenedEmptyCreateModal.value = true;
  openCreateProjectModal();
}

function openProject(project: Project) {
  closeProjectMenu();
  closeAddChatsModal();
  activeProjectId.value = project.id;
  emit("active-project-changed", project.id);
}

function syncRequestedProject() {
  if (!props.projectToOpenId) return;

  if (projects.value.some((project) => project.id === props.projectToOpenId)) {
    activeProjectId.value = props.projectToOpenId;
    emit("active-project-changed", props.projectToOpenId);
  }
}

function closeActiveProject() {
  closeProjectMenu();
  closeAddChatsModal();
  activeProjectId.value = null;
  emit("active-project-changed", null);
}

function openAddChatsModal() {
  closeProjectMenu();
  isAddChatsModalOpen.value = true;
}

function closeAddChatsModal() {
  isAddChatsModalOpen.value = false;
}

function addChatsToActiveProject(chatIds: string[]) {
  if (!activeProject.value || chatIds.length === 0) return;

  emit("add-chats-to-project", chatIds, activeProject.value.id);
  closeAddChatsModal();
}

function openCreateProjectModal() {
  closeProjectMenu();
  projectToEdit.value = null;
  modalErrorMessage.value = "";
  isProjectModalOpen.value = true;
}

function openProjectImportModal() {
  closeProjectMenu();
  errorMessage.value = "";
  successMessage.value = "";
  portabilityWarnings.value = [];

  if (!props.currentUser) {
    emit("sign-in");
    return;
  }

  isProjectImportModalOpen.value = true;
}

function closeProjectImportModal() {
  isProjectImportModalOpen.value = false;
}

function openProjectExportModal(project: Project) {
  closeProjectMenu();
  errorMessage.value = "";
  successMessage.value = "";
  projectExportErrorMessage.value = "";
  portabilityWarnings.value = [];
  projectPendingExport.value = project;
}

function closeProjectExportModal() {
  if (isExportingProject.value) return;

  projectPendingExport.value = null;
  projectExportErrorMessage.value = "";
}

function openEditProjectModal(project: Project) {
  closeProjectMenu();
  projectToEdit.value = project;
  modalErrorMessage.value = "";
  isProjectModalOpen.value = true;
}

function closeProjectModal() {
  isProjectModalOpen.value = false;
  projectToEdit.value = null;
  modalErrorMessage.value = "";
}

function cancelProjectModal() {
  closeProjectModal();
}

async function saveProject(input: ProjectInput) {
  const identity = captureIdentity();
  if (!identity.userId) {
    emit("sign-in");
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  modalErrorMessage.value = "";
  successMessage.value = "";

  try {
    const isEditing = Boolean(projectToEdit.value);
    const savedProject = projectToEdit.value
      ? await updateProject(projectToEdit.value.id, input)
      : await createProject(input);

    if (!isCurrentIdentity(identity)) return;

    upsertProject(savedProject);
    closeProjectModal();
    successMessage.value = isEditing ? t("projects.success.updated") : t("projects.success.created");

    if (!isEditing) {
      openProject(savedProject);
    }
  } catch (error) {
    if (isCurrentIdentity(identity)) {
      modalErrorMessage.value = error instanceof Error ? error.message : t("projects.errors.save");
    }
  } finally {
    if (isCurrentIdentity(identity)) {
      isSaving.value = false;
    }
  }
}

function requestRemoveProject(project: Project) {
  if (isDeleting.value) return;

  closeProjectMenu();
  projectPendingDelete.value = project;
}

function openProjectActionsMenu(event: MouseEvent, projectId: string) {
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();

  if (openProjectMenu.value?.projectId === projectId) {
    closeProjectMenu();
    return;
  }

  const menuWidth = 200;

  openProjectMenu.value = {
    left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
    projectId,
    top: rect.bottom + 8,
  };
}

async function exportPendingProject(includeChats: boolean) {
  const project = projectPendingExport.value;
  const identity = captureIdentity();
  if (!identity.userId || !project || isExportingProject.value) return;

  isExportingProject.value = true;
  projectExportErrorMessage.value = "";
  errorMessage.value = "";
  successMessage.value = "";
  portabilityWarnings.value = [];

  try {
    const archive = await exportProjectZip(project.id, {
      includeChats,
    });

    if (!isCurrentIdentity(identity)) return;

    downloadProjectExport(archive, project.name);
    projectPendingExport.value = null;
    successMessage.value = t("projects.portability.export.success");
  } catch (error) {
    if (isCurrentIdentity(identity)) {
      projectExportErrorMessage.value =
        error instanceof Error
          ? error.message
          : t("projects.portability.errors.export");
    }
  } finally {
    if (isCurrentIdentity(identity)) {
      isExportingProject.value = false;
    }
  }
}

async function handleProjectImported(result: ProjectImportCommitResult) {
  const identity = captureIdentity();
  if (!identity.userId) return;

  isProjectImportModalOpen.value = false;
  errorMessage.value = "";
  successMessage.value = "";
  portabilityWarnings.value = [...result.warnings];

  try {
    await refreshAndOpenImportedProject(result, {
      refreshProjects: props.refreshProjects,
      openProject(project) {
        if (isCurrentIdentity(identity)) {
          openProject(project);
        }
      },
      refreshChats: props.refreshChats,
    });

    if (!isCurrentIdentity(identity)) return;

    successMessage.value = t("projects.portability.import.success", {
      project: result.projectName,
    });
  } catch (error) {
    if (isCurrentIdentity(identity)) {
      errorMessage.value =
        error instanceof Error
          ? error.message
          : t("projects.portability.errors.refresh");
    }
  }
}

function closeProjectMenu() {
  openProjectMenu.value = null;
}

function cancelRemoveProject() {
  projectPendingDelete.value = null;
}

async function confirmRemoveProject() {
  if (!projectPendingDelete.value || isDeleting.value) return;

  const project = projectPendingDelete.value;
  const identity = captureIdentity();
  if (!identity.userId) return;

  isDeleting.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await deleteProject(project.id);
    if (!isCurrentIdentity(identity)) return;

    const nextProjects = projects.value.filter((item) => item.id !== project.id);
    emitProjectsChanged(nextProjects);
    closeAddChatsModal();
    syncActiveProject(nextProjects);
    successMessage.value = t("projects.success.deleted");
    projectPendingDelete.value = null;
  } catch (error) {
    if (isCurrentIdentity(identity)) {
      errorMessage.value = error instanceof Error ? error.message : t("projects.errors.delete");
    }
  } finally {
    if (isCurrentIdentity(identity)) {
      isDeleting.value = false;
    }
  }
}

function upsertProject(project: Project) {
  const existingIndex = projects.value.findIndex((item) => item.id === project.id);

  if (existingIndex === -1) {
    emitProjectsChanged([project, ...projects.value]);
    return;
  }

  const nextProjects = projects.value.map((item) => (item.id === project.id ? project : item));
  emitProjectsChanged(nextProjects);
  syncActiveProject(nextProjects);
}

function emitProjectsChanged(projects: Project[]) {
  emit("projects-changed", [...projects]);
}

function syncActiveProject(availableProjects: Project[] = projects.value) {
  if (!activeProjectId.value) return;

  if (!availableProjects.some((project) => project.id === activeProjectId.value)) {
    closeAddChatsModal();
    activeProjectId.value = null;
    emit("active-project-changed", null);
  }
}

function resetAccountScopedState() {
  activeProjectId.value = null;
  errorMessage.value = "";
  successMessage.value = "";
  modalErrorMessage.value = "";
  projectExportErrorMessage.value = "";
  portabilityWarnings.value = [];
  hasOpenedEmptyCreateModal.value = false;
  isSaving.value = false;
  isDeleting.value = false;
  isExportingProject.value = false;
  isAddChatsModalOpen.value = false;
  isProjectImportModalOpen.value = false;
  isProjectModalOpen.value = false;
  openProjectMenu.value = null;
  projectToEdit.value = null;
  projectPendingExport.value = null;
  projectPendingDelete.value = null;
  emit("active-project-changed", null);
}

function captureIdentity() {
  return {
    revision: identityRevision,
    userId: props.currentUser?.id || null,
  };
}

function isCurrentIdentity(identity: { revision: number; userId: string | null }) {
  return identityRevision === identity.revision && (props.currentUser?.id || null) === identity.userId;
}

function getSortDate(project: Project, key: SortKey) {
  if (key === "created") return new Date(project.createdAt).getTime();

  return new Date(project.updatedAt).getTime();
}

</script>

<template>
  <section class="workspace-page projects-page" :class="{ 'projects-page--detail': activeProject }">
    <header v-if="!activeProject" class="workspace-header projects-page__header">
      <div>
        <h1 class="workspace-title mb-0">{{ t("projects.title") }}</h1>
      </div>

      <div class="projects-page__actions">
        <span class="projects-page__sort-label">{{ t("projects.sort.by") }}</span>
        <div class="dropdown">
          <button
            class="btn btn-outline-secondary dropdown-toggle"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            {{ selectedSortLabel }}
          </button>
          <ul class="dropdown-menu dropdown-menu-end">
            <li v-for="option in sortOptions" :key="option.key">
              <button
                class="dropdown-item d-flex align-items-center justify-content-between gap-3"
                :class="{ active: option.key === sortKey }"
                type="button"
                @click="sortKey = option.key"
              >
                <span>{{ option.label }}</span>
                <span v-if="option.key === sortKey" aria-hidden="true">&#10003;</span>
              </button>
            </li>
          </ul>
        </div>

        <button class="btn btn-outline-primary" type="button" @click="openProjectImportModal">
          {{ t("projects.portability.import.action") }}
        </button>

        <button class="btn btn-primary" type="button" @click="openCreateProjectModal">
          {{ t("projects.new") }}
        </button>
      </div>
    </header>

    <section v-if="!currentUser" class="workspace-panel projects-page__auth">
      <h2 class="workspace-section-title">{{ t("projects.signInRequired") }}</h2>
      <p class="workspace-note mb-3">{{ t("projects.signInNote") }}</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">{{ t("app.actions.signIn") }}</button>
    </section>

    <template v-else>
      <div v-if="visibleErrorMessage || successMessage || portabilityWarnings.length > 0" class="project-portability-feedback">
        <p v-if="visibleErrorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
          {{ visibleErrorMessage }}
        </p>
        <p v-if="successMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
          {{ successMessage }}
        </p>
        <div v-if="portabilityWarnings.length > 0" class="project-portability-feedback__warnings">
          <strong>{{ t("projects.portability.import.warnings") }}</strong>
          <ul>
            <li v-for="warning in portabilityWarnings" :key="warning">{{ warning }}</li>
          </ul>
        </div>
      </div>

      <template v-if="activeProject">
        <section class="project-detail">
          <button class="btn btn-link project-detail__back" type="button" @click="closeActiveProject">
            &larr; {{ t("projects.all") }}
          </button>

          <header class="project-detail__header">
            <div>
              <h1>{{ activeProject.name }}</h1>
              <p v-if="activeProject.description">{{ activeProject.description }}</p>
            </div>

            <div class="project-detail__actions">
              <button class="btn btn-outline-secondary" type="button" @click="openAddChatsModal">
                {{ t("projects.addChats") }}
              </button>
              <button
                class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
                type="button"
                :aria-label="t('projects.optionsAria')"
                @click.stop="openProjectActionsMenu($event, activeProject.id)"
              >
                &hellip;
              </button>
            </div>
          </header>

          <div class="project-detail__workspace">
            <div class="project-detail__main">
              <div class="project-detail__composer">
                <ChatComposer
                  :disabled="disabled"
                  :disabled-message="disabledMessage"
                  :is-sending="isSending"
                  :message="message"
                  :mode="mode"
                  :selected-attachments="selectedAttachments"
                  @attachments-selected="emit('attachments-selected', $event)"
                  @disabled-click="emit('disabled-click')"
                  @open-selected-attachment="emit('open-selected-attachment', $event)"
                  @quick-action="emit('quick-action', $event)"
                  @remove-selected-attachment="emit('remove-selected-attachment', $event)"
                  @submit="emit('submit-project-message', activeProject.id)"
                  @update:message="emit('update:message', $event)"
                />
              </div>

              <ProjectChatList :chats="activeProjectChats" @open-chat="emit('open-chat', $event)" />
            </div>

            <aside class="workspace-panel project-knowledge">
              <ProjectInstructionsPanel
                :error-message="instructionErrorMessage"
                :instruction="projectInstruction"
                :is-loading="isLoadingInstruction"
                :is-saving="isSavingInstruction"
                @save="saveProjectInstruction"
              />

              <ProjectMemoryPanel
                :draft-content="projectMemoryDraft"
                :error-message="projectMemoryErrorMessage"
                :is-loading="isLoadingProjectMemory"
                :is-saving="isSavingProjectMemory"
                :memory="projectMemory"
                :status-message="projectMemoryStatusMessage"
                @clear="clearProjectMemory"
                @save="saveProjectMemory"
                @update:draft-content="updateProjectMemoryDraft"
              />

              <ProjectDocumentsPanel
                :documents="projectDocuments"
                :error-message="documentErrorMessage"
                :is-importing="isImportingDocuments"
                :is-loading="isLoadingDocuments"
                :is-saving="isSavingDocument"
                @create="addProjectDocument"
                @delete="removeProjectDocument"
                @import="importProjectFiles"
                @update="saveProjectDocument"
              />
            </aside>
          </div>
        </section>
      </template>

      <template v-else>
        <div class="projects-search">
          <Icon name="search" />
          <input
            v-model="searchQuery"
            type="search"
            :placeholder="t('projects.searchPlaceholder')"
            :aria-label="t('projects.searchAria')"
          />
        </div>

        <div v-if="isLoadingProjects" class="workspace-empty">{{ t("projects.loading") }}</div>

        <div v-else-if="projects.length === 0" class="projects-empty">
          <h2>{{ t("projects.emptyTitle") }}</h2>
          <p>{{ t("projects.emptyBody") }}</p>
        </div>

        <div v-else-if="filteredProjects.length === 0" class="projects-empty">
          <h2>{{ t("projects.noMatchesTitle") }}</h2>
          <p>{{ t("projects.noMatchesBody") }}</p>
        </div>

        <div v-else class="project-card-grid">
          <ProjectCard
            v-for="project in filteredProjects"
            :key="project.id"
            :is-menu-open="openProjectMenu?.projectId === project.id"
            :project="project"
            @open="openProject"
            @open-menu="openProjectActionsMenu"
          />
        </div>
      </template>
    </template>

    <Teleport to="body">
      <ul
        v-if="openProjectMenu && openMenuProject"
        class="chat-dropdown-menu show"
        :style="{ left: `${openProjectMenu.left}px`, top: `${openProjectMenu.top}px` }"
        @click.stop
      >
        <li>
          <button class="dropdown-item" type="button" @click="openProjectExportModal(openMenuProject)">
            {{ t("projects.portability.export.action") }}
          </button>
        </li>
        <li>
          <button class="dropdown-item" type="button" @click="openEditProjectModal(openMenuProject)">
            {{ t("projects.menu.edit") }}
          </button>
        </li>
        <li>
          <button
            class="dropdown-item dropdown-item-danger"
            type="button"
            :disabled="isDeleting"
            @click="requestRemoveProject(openMenuProject)"
          >
            {{ t("projects.menu.delete") }}
          </button>
        </li>
      </ul>
    </Teleport>

    <ProjectFormModal
      :error-message="modalErrorMessage"
      :is-open="isProjectModalOpen"
      :is-saving="isSaving"
      :project="projectToEdit"
      @cancel="cancelProjectModal"
      @save="saveProject"
    />
    <ProjectAddChatsModal
      :chats="chats"
      :is-open="isAddChatsModalOpen"
      :project="activeProject"
      @add="addChatsToActiveProject"
      @cancel="closeAddChatsModal"
    />
    <ProjectDeleteModal
      :is-deleting="isDeleting"
      :project="projectPendingDelete"
      @cancel="cancelRemoveProject"
      @confirm="confirmRemoveProject"
    />
    <ProjectExportModal
      v-if="projectPendingExport"
      :error-message="projectExportErrorMessage"
      :is-exporting="isExportingProject"
      :project="projectPendingExport"
      @cancel="closeProjectExportModal"
      @export="exportPendingProject"
    />
    <ProjectImportModal
      v-if="isProjectImportModalOpen"
      :is-open="true"
      @cancel="closeProjectImportModal"
      @imported="handleProjectImported"
    />
  </section>
</template>
