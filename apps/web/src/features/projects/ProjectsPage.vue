<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";

import ProjectDocumentsPanel from "../project-documents/components/ProjectDocumentsPanel.vue";
import ProjectInstructionsPanel from "../project-instructions/components/ProjectInstructionsPanel.vue";
import ChatComposer from "../chat/components/ChatComposer.vue";
import type { QuickAction } from "../chat/constants";
import type { Chat, SelectedAttachment } from "../chat/types";
import ProjectAddChatsModal from "./components/ProjectAddChatsModal.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectChatList from "./components/ProjectChatList.vue";
import ProjectDeleteModal from "./components/ProjectDeleteModal.vue";
import ProjectFormModal from "./components/ProjectFormModal.vue";
import Icon from "../../ui/Icon.vue";
import { useProjectKnowledge } from "./composables/useProjectKnowledge";
import { createProject, deleteProject, fetchProjects, updateProject } from "./projectsApi";
import type { Project, ProjectInput } from "./types";
import type { AuthUser } from "../auth/types";

type SortKey = "activity" | "updated" | "created";
type ProjectMenuPosition = {
  left: number;
  projectId: string;
  top: number;
};

const props = defineProps<{
  chats: Chat[];
  currentUser?: AuthUser | null;
  disabled?: boolean;
  disabledMessage?: string;
  isSending: boolean;
  message: string;
  mode: string;
  projectToOpenId?: string | null;
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

const sortOptions: Array<{ key: SortKey; label: string }> = [
  { key: "activity", label: "Last activity" },
  { key: "updated", label: "Last edited" },
  { key: "created", label: "Created date" },
];

const projects = ref<Project[]>([]);
const searchQuery = ref("");
const sortKey = ref<SortKey>("activity");
const errorMessage = ref("");
const successMessage = ref("");
const modalErrorMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const isDeleting = ref(false);
const isAddChatsModalOpen = ref(false);
const isProjectModalOpen = ref(false);
const hasOpenedEmptyCreateModal = ref(false);
const activeProjectId = ref<string | null>(null);
const openProjectMenu = ref<ProjectMenuPosition | null>(null);
const projectToEdit = ref<Project | null>(null);
const projectPendingDelete = ref<Project | null>(null);
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

const selectedSortLabel = computed(() => {
  if (sortKey.value === "activity") return "Activity";

  return sortOptions.find((option) => option.key === sortKey.value)?.label || "Activity";
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

onMounted(() => {
  document.addEventListener("click", closeProjectMenu);
  document.addEventListener("scroll", closeProjectMenu, true);

  void loadProjects();
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeProjectMenu);
  document.removeEventListener("scroll", closeProjectMenu, true);
});

watch(
  () => props.currentUser?.id,
  () => {
    hasOpenedEmptyCreateModal.value = false;
    void loadProjects();
  }
);

watch(
  () => props.projectToOpenId,
  () => {
    syncRequestedProject();
  }
);

async function loadProjects() {
  errorMessage.value = "";
  successMessage.value = "";

  if (!props.currentUser) {
    projects.value = [];
    activeProjectId.value = null;
    closeAddChatsModal();
    closeProjectModal();
    emitProjectsChanged();
    return;
  }

  isLoading.value = true;

  try {
    projects.value = await fetchProjects();
    syncActiveProject();
    syncRequestedProject();
    emitProjectsChanged();
    openCreateModalForEmptyWorkspace();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not load projects.";
  } finally {
    isLoading.value = false;
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
  if (!props.currentUser) {
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

    upsertProject(savedProject);
    closeProjectModal();
    successMessage.value = isEditing ? "Project updated." : "Project created.";

    if (!isEditing) {
      openProject(savedProject);
    }
  } catch (error) {
    modalErrorMessage.value = error instanceof Error ? error.message : "Could not save this project.";
  } finally {
    isSaving.value = false;
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

  const menuWidth = 168;

  openProjectMenu.value = {
    left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
    projectId,
    top: rect.bottom + 8,
  };
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

  isDeleting.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await deleteProject(project.id);
    projects.value = projects.value.filter((item) => item.id !== project.id);
    closeAddChatsModal();
    syncActiveProject();
    emitProjectsChanged();
    successMessage.value = "Project deleted.";
    projectPendingDelete.value = null;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not delete this project.";
  } finally {
    isDeleting.value = false;
  }
}

function upsertProject(project: Project) {
  const existingIndex = projects.value.findIndex((item) => item.id === project.id);

  if (existingIndex === -1) {
    projects.value = [project, ...projects.value];
    emitProjectsChanged();
    return;
  }

  projects.value = projects.value.map((item) => (item.id === project.id ? project : item));
  syncActiveProject();
  emitProjectsChanged();
}

function emitProjectsChanged() {
  emit("projects-changed", [...projects.value]);
}

function syncActiveProject() {
  if (!activeProjectId.value) return;

  if (!projects.value.some((project) => project.id === activeProjectId.value)) {
    closeAddChatsModal();
    activeProjectId.value = null;
    emit("active-project-changed", null);
  }
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
        <h1 class="workspace-title mb-0">Projects</h1>
      </div>

      <div class="projects-page__actions">
        <span class="projects-page__sort-label">Sort by</span>
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

        <button class="btn btn-primary" type="button" @click="openCreateProjectModal">
          New Project
        </button>
      </div>
    </header>

    <section v-if="!currentUser" class="workspace-panel projects-page__auth">
      <h2 class="workspace-section-title">Sign in required</h2>
      <p class="workspace-note mb-3">Projects are saved to your account with your persisted chats.</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">Sign in</button>
    </section>

    <template v-else>
      <template v-if="activeProject">
        <section class="project-detail">
          <button class="btn btn-link project-detail__back" type="button" @click="closeActiveProject">
            &larr; All Projects
          </button>

          <header class="project-detail__header">
            <div>
              <h1>{{ activeProject.name }}</h1>
              <p v-if="activeProject.description">{{ activeProject.description }}</p>
            </div>

            <div class="project-detail__actions">
              <button class="btn btn-outline-secondary" type="button" @click="openAddChatsModal">
                Add Chats
              </button>
              <button
                class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
                type="button"
                aria-label="Project options"
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
          <input v-model="searchQuery" type="search" placeholder="Search projects ..." aria-label="Search projects" />
        </div>

        <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="successMessage" class="workspace-feedback workspace-feedback--success" role="status">
          {{ successMessage }}
        </p>

        <div v-if="isLoading" class="workspace-empty">Loading projects...</div>

        <div v-else-if="projects.length === 0" class="projects-empty">
          <h2>No projects yet</h2>
          <p>Create your first project to organize QA chats by product, release, or test area.</p>
        </div>

        <div v-else-if="filteredProjects.length === 0" class="projects-empty">
          <h2>No matching projects</h2>
          <p>Try a different search term.</p>
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
          <button class="dropdown-item" type="button" @click="openEditProjectModal(openMenuProject)">
            Edit
          </button>
        </li>
        <li>
          <button
            class="dropdown-item dropdown-item-danger"
            type="button"
            :disabled="isDeleting"
            @click="requestRemoveProject(openMenuProject)"
          >
            Delete
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
  </section>
</template>
