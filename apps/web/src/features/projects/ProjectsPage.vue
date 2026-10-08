<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onDeactivated,
  onMounted,
  ref,
  nextTick,
  useId,
  watch,
} from "vue";

import WorkspacePanel from "./components/WorkspacePanel.vue";
import { partitionSessionList } from "../sessions/sessionListPresentation";
import SessionComposerDock from "../chat/components/SessionComposerDock.vue";
const panelToggleTarget = ref<HTMLElement | null>(null);
import type { SidebarTestItem } from "../test-sessions/navigation";
import type { QuickAction } from "../chat/constants";
import type { Chat, SelectedAttachment } from "../chat/types";
import ProjectAddChatsModal from "./components/ProjectAddChatsModal.vue";
import ProjectCard from "./components/ProjectCard.vue";
import ProjectDeleteModal from "./components/ProjectDeleteModal.vue";
import ProjectFormModal from "./components/ProjectFormModal.vue";
import Icon from "../../ui/Icon.vue";
import { useI18n } from "../../i18n/useI18n";
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
const ProjectIntegrationsDialog = defineAsyncComponent(
  () => import("./components/ProjectIntegrationsDialog.vue")
);

const props = defineProps<{
  workView?: "conversations" | "tests";
  testSessions?: SidebarTestItem[];
  isLoadingTests?: boolean;
  testLoadError?: string;
  chats: Chat[];
  addChatsToProject?: (chatIds: string[], projectId: string) => Promise<void>;
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
  "new-test": [projectId: string];
  "select-test": [item: SidebarTestItem];
  "reload-tests": [];
  "open-other-workspace": [projectId: string];
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
const isIntegrationsOpen = ref(false);
const isAddingChats = ref(false);
const addChatsErrorMessage = ref("");
const isProjectImportModalOpen = ref(false);
const isProjectModalOpen = ref(false);
const activeProjectId = ref<string | null>(null);
const openProjectMenu = ref<ProjectMenuPosition | null>(null);
const projectMenuElement = ref<HTMLElement | null>(null);
const projectMenuId = useId();
let projectMenuOpener: HTMLElement | null = null;
const projectToEdit = ref<Project | null>(null);
const projectPendingExport = ref<Project | null>(null);
const projectPendingDelete = ref<Project | null>(null);
const projectExportErrorMessage = ref("");
const portabilityWarnings = ref<string[]>([]);
let identityRevision = 0;
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
const activeProjectSessionGroup = computed(() => activeProject.value
  ? partitionSessionList({ chats: props.chats, sessions: props.testSessions, projects: projects.value })
    .projectGroups.find(group => group.project.id === activeProject.value!.id) : undefined);
const activeProjectSessions = computed(() => activeProjectSessionGroup.value?.active || []);
const archivedProjectSessions = computed(() => activeProjectSessionGroup.value?.archived || []);
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
onDeactivated(() => { isIntegrationsOpen.value = false; });
watch(activeProjectId, () => { isIntegrationsOpen.value = false; }, { flush: "sync" });

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

}


function openProject(project: Project) {
  closeProjectMenu();
  closeAddChatsModal();
  activeProjectId.value = project.id;
  emit("active-project-changed", project.id);
}

function syncRequestedProject() {
  if (!props.projectToOpenId) {
    if (!activeProjectId.value) return;

    // The owner can return to the project index without changing the route.
    // Close only detail-scoped UI; in-flight writes retain their captured target.
    closeProjectMenu();
    closeAddChatsModal();
    if (projectToEdit.value) closeProjectModal();
    projectPendingExport.value = null;
    projectExportErrorMessage.value = "";
    projectPendingDelete.value = null;
    activeProjectId.value = null;
    return;
  }

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
  addChatsErrorMessage.value = "";
  isAddChatsModalOpen.value = true;
}

function closeAddChatsModal() {
  isAddChatsModalOpen.value = false;
}

async function addChatsToActiveProject(chatIds: string[]) {
  if (!activeProject.value || chatIds.length === 0 || isAddingChats.value) return;
  const identity = captureIdentity();
  const projectId = activeProject.value.id;
  isAddingChats.value = true;
  addChatsErrorMessage.value = "";
  try {
    if (props.addChatsToProject) await props.addChatsToProject(chatIds, projectId);
    else if (!props.currentUser) emit("add-chats-to-project", chatIds, projectId);
    else throw new Error(t("projects.errors.addChats"));
    if (isCurrentIdentity(identity) && activeProjectId.value === projectId) closeAddChatsModal();
  } catch (error) {
    if (isCurrentIdentity(identity) && activeProjectId.value === projectId) {
      addChatsErrorMessage.value = error instanceof Error ? error.message : t("projects.errors.addChats");
    }
  } finally {
    if (isCurrentIdentity(identity)) isAddingChats.value = false;
  }
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

async function openProjectActionsMenu(event: MouseEvent, projectId: string) {
  const button = event.currentTarget as HTMLElement;
  const rect = button.getBoundingClientRect();

  if (openProjectMenu.value?.projectId === projectId) {
    closeProjectMenu();
    return;
  }

  const menuWidth = 200;
  projectMenuOpener = button;

  openProjectMenu.value = {
    left: Math.max(8, Math.min(rect.right - menuWidth, window.innerWidth - menuWidth - 8)),
    projectId,
    top: Math.max(8, Math.min(rect.bottom + 8, window.innerHeight - 156)),
  };
  await nextTick();
  const menu = projectMenuElement.value;
  if (!menu || !openProjectMenu.value) return;
  const menuRect = menu.getBoundingClientRect();
  openProjectMenu.value.top = Math.max(8, Math.min(openProjectMenu.value.top, window.innerHeight - menuRect.height - 8));
  menu.querySelector<HTMLButtonElement>("button")?.focus();
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

function onProjectMenuKeydown(event: KeyboardEvent) {
  if (event.key === "Escape" && !event.isComposing) {
    event.preventDefault();
    event.stopPropagation();
    closeProjectMenu();
    projectMenuOpener?.focus();
  } else if (event.key === "Tab") {
    closeProjectMenu();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    const items = [...(projectMenuElement.value?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || [])];
    if (!items.length) return;
    event.preventDefault();
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
  }
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
  isSaving.value = false;
  isDeleting.value = false;
  isExportingProject.value = false;
  isAddChatsModalOpen.value = false;
  isIntegrationsOpen.value = false;
  isAddingChats.value = false;
  addChatsErrorMessage.value = "";
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
              <span ref="panelToggleTarget" />
              <button class="btn btn-outline-secondary project-detail__integrations" type="button" @click="isIntegrationsOpen = true">{{ t('projects.integrations.title') }}</button>
              <button class="btn btn-outline-secondary" type="button" @click="openAddChatsModal">
                {{ t("projects.addChats") }}
              </button>
              <button class="btn btn-outline-secondary" type="button" @click="emit('new-test', activeProject.id)">{{ t('workspaces.newSession') }}</button>
              <button
                class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
                type="button"
                :aria-label="t('projects.optionsAria')"
                aria-haspopup="menu"
                :aria-expanded="openProjectMenu?.projectId === activeProject.id"
                :aria-controls="projectMenuId"
                @click.stop="openProjectActionsMenu($event, activeProject.id)"
              >
                &hellip;
              </button>
            </div>
          </header>

          <div class="project-detail__workspace">
            <div class="project-detail__main">
              <div class="project-detail__content">
                <div class="project-chat-list">
                  <button v-for="item in activeProjectSessions" :key="item.id" class="project-chat-item" type="button" @click="item.kind === 'chat' ? emit('open-chat', item.id) : emit('select-test', item.item)">
                    <span>{{ item.title }}</span><small v-if="item.id.startsWith('request:')">{{ t('workspaces.legacy') }}</small>
                  </button>
                  <details v-if="archivedProjectSessions.length" class="project-session-archive"><summary>{{ t('sessionTools.navigation.archive') }} · {{ archivedProjectSessions.length }}</summary><button v-for="item in archivedProjectSessions" :key="item.id" class="project-chat-item" type="button" @click="item.kind === 'chat' ? emit('open-chat', item.id) : emit('select-test', item.item)">{{ item.title }}</button></details>
                  <p v-if="!activeProjectSessions.length && !isLoadingTests" class="workspace-note">{{ t('testSessions.nav.noSessions') }}</p>
                  <p v-if="isLoadingTests" class="workspace-note" role="status">{{ t('testSessions.nav.loading') }}</p>
                  <p v-if="testLoadError" class="workspace-feedback workspace-feedback--error" role="alert">{{ testLoadError }} <button class="btn btn-link" type="button" @click="emit('reload-tests')">{{ t('testSessions.nav.retry') }}</button></p>
                </div>
              </div>
              <SessionComposerDock scroll-selector=".project-detail__content">
                <slot name="composer" :project-id="activeProject.id" />
              </SessionComposerDock>
            </div>
            <WorkspacePanel
              :toggle-target="panelToggleTarget"
              :key="`${currentUser.id}:${activeProject.id}`"
              :current-user="currentUser"
              :project-id="activeProject.id"
              :project-name="activeProject.name"
              @integrations="isIntegrationsOpen = true"
            />
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
            :menu-id="projectMenuId"
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
        ref="projectMenuElement"
        :id="projectMenuId"
        role="menu"
        :aria-label="t('projects.optionsAria')"
        @keydown="onProjectMenuKeydown"
        class="workspace-surface chat-dropdown-menu show"
        :style="{ left: `${openProjectMenu.left}px`, top: `${openProjectMenu.top}px` }"
        @click.stop
      >
        <li role="none">
          <button class="dropdown-item" role="menuitem" type="button" @click="openProjectExportModal(openMenuProject)">
            {{ t("projects.portability.export.action") }}
          </button>
        </li>
        <li role="none">
          <button class="dropdown-item" role="menuitem" type="button" @click="openEditProjectModal(openMenuProject)">
            {{ t("projects.menu.edit") }}
          </button>
        </li>
        <li role="none">
          <button
            class="dropdown-item dropdown-item-danger"
            role="menuitem"
            type="button"
            :disabled="isDeleting"
            @click="requestRemoveProject(openMenuProject)"
          >
            {{ t("projects.menu.delete") }}
          </button>
        </li>
      </ul>
    </Teleport>

    <ProjectIntegrationsDialog
      v-if="isIntegrationsOpen && currentUser && activeProject"
      :key="`${currentUser.id}:${activeProject.id}`"
      :project-id="activeProject.id"
      :project-name="activeProject.name"
      @close="isIntegrationsOpen = false"
    />
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
      :sessions="currentUser ? testSessions : undefined"
      :is-saving="isAddingChats"
      :error-message="addChatsErrorMessage"
      :is-loading="Boolean(currentUser && isLoadingTests)"
      :load-error="currentUser ? testLoadError : ''"
      :is-open="isAddChatsModalOpen"
      :project="activeProject"
      @add="addChatsToActiveProject"
      @cancel="closeAddChatsModal"
      @retry="emit('reload-tests')"
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
