<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

import { createProject, deleteProject, fetchProjects, updateProject } from "./projectsApi";
import type { Project } from "./types";
import type { AuthUser } from "../auth/types";

const props = defineProps<{
  currentUser?: AuthUser | null;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  "sign-in": [];
}>();

const projects = ref<Project[]>([]);
const errorMessage = ref("");
const successMessage = ref("");
const isLoading = ref(false);
const isSaving = ref(false);
const isDeleting = ref(false);
const editingProjectId = ref<string | null>(null);
const form = reactive({
  description: "",
  name: "",
});

const selectedProject = computed(() =>
  editingProjectId.value ? projects.value.find((project) => project.id === editingProjectId.value) || null : null
);
const canSave = computed(() => Boolean(props.currentUser && form.name.trim() && !isLoading.value && !isSaving.value));
const saveLabel = computed(() => {
  if (isSaving.value) return selectedProject.value ? "Saving..." : "Creating...";

  return selectedProject.value ? "Save changes" : "Create project";
});

onMounted(() => {
  void loadProjects();
});

watch(
  () => props.currentUser?.id,
  () => void loadProjects()
);

async function loadProjects() {
  errorMessage.value = "";
  successMessage.value = "";
  resetForm();

  if (!props.currentUser) {
    projects.value = [];
    return;
  }

  isLoading.value = true;

  try {
    projects.value = await fetchProjects();
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not load projects.";
  } finally {
    isLoading.value = false;
  }
}

async function saveProject() {
  if (!props.currentUser) {
    emit("sign-in");
    return;
  }

  if (!form.name.trim()) return;

  isSaving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const projectToEdit = selectedProject.value;
    const input = {
      description: form.description.trim() || null,
      name: form.name.trim(),
    };
    const savedProject = projectToEdit
      ? await updateProject(projectToEdit.id, input)
      : await createProject(input);

    upsertProject(savedProject);
    resetForm();
    successMessage.value = projectToEdit ? "Project updated." : "Project created.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not save this project.";
  } finally {
    isSaving.value = false;
  }
}

async function removeProject(project: Project) {
  if (isDeleting.value) return;
  if (!window.confirm(`Delete "${project.name}"?`)) return;

  isDeleting.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    await deleteProject(project.id);
    projects.value = projects.value.filter((item) => item.id !== project.id);

    if (editingProjectId.value === project.id) {
      resetForm();
    }

    successMessage.value = "Project deleted.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not delete this project.";
  } finally {
    isDeleting.value = false;
  }
}

function editProject(project: Project) {
  editingProjectId.value = project.id;
  form.name = project.name;
  form.description = project.description || "";
  errorMessage.value = "";
  successMessage.value = "";
}

function resetForm() {
  editingProjectId.value = null;
  form.name = "";
  form.description = "";
}

function upsertProject(project: Project) {
  const existingIndex = projects.value.findIndex((item) => item.id === project.id);

  if (existingIndex === -1) {
    projects.value = [project, ...projects.value];
    return;
  }

  projects.value = projects.value.map((item) => (item.id === project.id ? project : item));
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(new Date(value));
}
</script>

<template>
  <section class="workspace-page">
    <header class="workspace-header d-flex align-items-start justify-content-between gap-3">
      <div>
        <p class="workspace-eyebrow text-uppercase fw-bold mb-1">Projects</p>
        <h2 class="workspace-title mb-1">QA project spaces</h2>
        <p class="workspace-subtitle mb-0">Group account chats around products, releases, or test areas.</p>
      </div>

      <button class="btn btn-outline-secondary" type="button" @click="emit('back-to-chat')">
        Back
      </button>
    </header>

    <section v-if="!currentUser" class="workspace-panel">
      <h3 class="workspace-section-title">Sign in required</h3>
      <p class="workspace-note mb-3">Projects are saved to your account with your persisted chats.</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">Sign in</button>
    </section>

    <template v-else>
      <section class="workspace-panel project-editor">
        <form class="project-form" @submit.prevent="saveProject">
          <div class="settings-grid">
            <label class="settings-field">
              <span class="form-label">Name</span>
              <input v-model="form.name" class="form-control" maxlength="120" placeholder="Mobile app QA" />
            </label>

            <label class="settings-field settings-field--wide">
              <span class="form-label">Description</span>
              <textarea
                v-model="form.description"
                class="form-control project-description"
                maxlength="1000"
                placeholder="Release scope, test areas, or project notes"
              ></textarea>
            </label>
          </div>

          <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
            {{ errorMessage }}
          </p>
          <p v-else-if="successMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
            {{ successMessage }}
          </p>

          <div class="d-flex align-items-center justify-content-between gap-3">
            <p class="workspace-note mb-0">
              <span v-if="selectedProject">Editing {{ selectedProject.name }}</span>
              <span v-else>{{ projects.length }} projects in your workspace</span>
            </p>

            <div class="d-flex gap-2">
              <button
                v-if="selectedProject"
                class="btn btn-outline-secondary"
                type="button"
                :disabled="isSaving"
                @click="resetForm"
              >
                Cancel
              </button>
              <button class="btn btn-primary" type="submit" :disabled="!canSave">
                {{ saveLabel }}
              </button>
            </div>
          </div>
        </form>
      </section>

      <section class="workspace-panel project-list-panel">
        <div v-if="isLoading" class="workspace-note">Loading projects...</div>
        <div v-else-if="projects.length === 0" class="workspace-empty">No projects yet.</div>

        <div v-else class="project-list">
          <article v-for="project in projects" :key="project.id" class="project-row">
            <div>
              <h3>{{ project.name }}</h3>
              <p v-if="project.description">{{ project.description }}</p>
              <small>{{ project.role }} · Updated {{ formatDate(project.updatedAt) }}</small>
            </div>

            <div class="project-row-actions">
              <button class="btn btn-outline-secondary btn-sm" type="button" @click="editProject(project)">
                Edit
              </button>
              <button
                class="btn btn-outline-danger btn-sm"
                type="button"
                :disabled="isDeleting"
                @click="removeProject(project)"
              >
                Delete
              </button>
            </div>
          </article>
        </div>
      </section>
    </template>
  </section>
</template>
