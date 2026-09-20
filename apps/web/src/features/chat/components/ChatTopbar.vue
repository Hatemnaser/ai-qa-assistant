<script setup lang="ts">
import { computed } from "vue";
import type { AiModelOption, ChatUsageSummary } from "../types";
import type { Project } from "../../projects/types";
import { useI18n } from "../../../i18n/useI18n";

const props = defineProps<{
  chatTitle?: string | null;
  isLoadingProjects?: boolean;
  mode?: string;
  model?: string;
  modelOptions?: AiModelOption[];
  projectError?: string;
  projectId?: string | null;
  projects?: Project[];
  usageSummary?: ChatUsageSummary | null;
}>();
const emit = defineEmits<{
  "update:projectId": [value: string | null];
  "open-projects": [];
  "open-project": [projectId: string];
}>();
const { t } = useI18n();
const selectedProject = computed(() => props.projects?.find((project) => project.id === props.projectId));
const chatTitleLabel = computed(() => !props.chatTitle || props.chatTitle === "New QA Chat" ? t("chat.title.default") : props.chatTitle);
const usageTitle = computed(() => props.usageSummary ? t("chat.topbar.usageTitle", {
  limit: props.usageSummary.limit, remaining: props.usageSummary.remaining,
  unit: props.usageSummary.unit || "credits", used: props.usageSummary.used,
}) : "");
</script>

<template>
  <header class="chat-topbar d-flex align-items-center justify-content-between">
    <div class="topbar-copy">
      <div v-if="selectedProject" class="topbar-breadcrumb">
        <button class="topbar-breadcrumb__project" type="button" @click="emit('open-project', selectedProject.id)">{{ selectedProject.name }}</button>
        <span aria-hidden="true">/</span>
      </div>
      <h1 class="topbar-title">{{ chatTitleLabel }}</h1>
    </div>
    <div class="topbar-controls d-flex align-items-center flex-wrap gap-2">
      <label class="topbar-project-select">
        <span class="visually-hidden">{{ t("sidebar.nav.projects") }}</span>
        <select class="form-select form-select-sm" :value="projectId || ''" :disabled="isLoadingProjects || Boolean(projectError)" @change="emit('update:projectId', ($event.target as HTMLSelectElement).value || null)">
          <option value="">{{ t("chat.home.noProject") }}</option>
          <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
        </select>
      </label>
      <button v-if="!projects?.length && !isLoadingProjects" class="btn btn-sm btn-outline-secondary" type="button" @click="emit('open-projects')">{{ t("chat.topbar.manageProjects") }}</button>
      <small v-if="projectError" role="status">{{ t("chat.topbar.projectsUnavailable") }}</small>
      <span v-if="usageSummary" class="topbar-status topbar-status--quota" :title="usageTitle" :aria-label="usageTitle">{{ t("chat.topbar.creditsLeft", { count: usageSummary.remaining }) }}</span>
    </div>
  </header>
</template>
