<script setup lang="ts">
import { computed } from "vue";

import { AI_MODELS, MODEL_RECOMMENDATION_KEYS_BY_VALUE, QA_MODES, VISUAL_REVIEW_MODEL } from "../constants";
import type { AiModelOption, ChatUsageSummary } from "../types";
import type { Project } from "../../projects/types";
import { useI18n } from "../../../i18n/useI18n";

const props = defineProps<{
  chatTitle?: string | null;
  isLoadingProjects?: boolean;
  mode: string;
  model: string;
  modelOptions?: AiModelOption[];
  projectError?: string;
  projectId?: string | null;
  projects?: Project[];
  usageSummary?: ChatUsageSummary | null;
}>();

const emit = defineEmits<{
  "update:mode": [value: string];
  "update:model": [value: string];
  "update:projectId": [value: string | null];
  "open-projects": [];
}>();

const selectedModeOption = computed(() => QA_MODES.find((option) => option.value === props.mode) || QA_MODES[0]);
const availableModelOptions = computed(() => (props.modelOptions?.length ? props.modelOptions : [...AI_MODELS]));
const availableProjects = computed(() => props.projects || []);
const selectedProjectId = computed(() => props.projectId || null);
const selectedProject = computed(
  () => availableProjects.value.find((project) => project.id === selectedProjectId.value) || null
);
const selectedModelOption = computed(
  () => availableModelOptions.value.find((option) => option.value === props.model) || availableModelOptions.value[0]
);
const { t } = useI18n();
const selectedModeLabel = computed(() => t(selectedModeOption.value.labelKey));
const selectedModelRecommendation = computed(() => getModelRecommendation(selectedModelOption.value));
const modelHint = computed(() => {
  const visualRecommendation =
    props.mode === "screenshot_review" ? t("model.hintVisual", { model: VISUAL_REVIEW_MODEL }) : "";

  return `${t("model.hint", {
    label: selectedModelOption.value.label,
    recommendedFor: selectedModelRecommendation.value,
  })}${visualRecommendation}`;
});
const chatTitleLabel = computed(() => {
  const title = props.chatTitle?.trim();

  return !title || title === "New QA Chat" ? t("chat.title.default") : title;
});
const usageLabel = computed(() => {
  if (!props.usageSummary) return "";

  const remaining = props.usageSummary.remaining;
  return t("chat.topbar.creditsLeft", { count: remaining });
});
const usageTitle = computed(() => {
  if (!props.usageSummary) return "";

  const unit = props.usageSummary.unit || "credits";

  return t("chat.topbar.usageTitle", {
    limit: props.usageSummary.limit,
    remaining: props.usageSummary.remaining,
    unit,
    used: props.usageSummary.used,
  });
});

function getModelRecommendation(modelOption: AiModelOption) {
  const recommendationKey = MODEL_RECOMMENDATION_KEYS_BY_VALUE[modelOption.value];

  return recommendationKey ? t(recommendationKey) : modelOption.recommendedFor;
}

function selectModel(value: string) {
  emit("update:model", value);
}

function selectMode(value: string) {
  emit("update:mode", value);
}

function selectProject(value: string | null) {
  emit("update:projectId", value);
}
</script>

<template>
  <header class="chat-topbar d-flex align-items-center justify-content-between">
    <div class="topbar-copy">
      <div v-if="selectedProject" class="topbar-breadcrumb">
        <button
          class="topbar-breadcrumb__project"
          type="button"
          :title="selectedProject.description || selectedProject.name"
          @click="emit('open-projects')"
        >
          {{ selectedProject.name }}
        </button>
        <span class="topbar-breadcrumb__separator" aria-hidden="true">/</span>
        <div class="dropdown">
          <button
            class="topbar-breadcrumb__chat"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            :title="chatTitleLabel"
          >
            <span>{{ chatTitleLabel }}</span>
          </button>

          <ul class="dropdown-menu topbar-select-menu">
            <li v-if="isLoadingProjects">
              <span class="dropdown-item-text text-muted">{{ t("chat.topbar.loadingProjects") }}</span>
            </li>
            <li v-else-if="projectError">
              <span class="dropdown-item-text text-muted" :title="projectError">{{ t("chat.topbar.projectsUnavailable") }}</span>
            </li>
            <template v-else>
              <li v-for="project in availableProjects" :key="project.id">
                <button
                  class="dropdown-item"
                  :class="{ active: project.id === selectedProjectId }"
                  type="button"
                  :title="project.description || project.name"
                  @click="selectProject(project.id)"
                >
                  {{ project.name }}
                </button>
              </li>
            </template>
            <li><hr class="dropdown-divider" /></li>
            <li>
              <button class="dropdown-item" type="button" @click="emit('open-projects')">
                {{ t("chat.topbar.manageProjects") }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <template v-else>
        <h2 class="topbar-title">{{ t("chat.topbar.title") }}</h2>
        <p class="topbar-subtitle">{{ t("chat.topbar.subtitle") }}</p>
      </template>
    </div>

    <div class="topbar-controls d-flex align-items-center justify-content-end flex-wrap gap-2">
      <div class="topbar-field d-flex align-items-center gap-2">
        <span class="topbar-field-label">{{ t("chat.topbar.model") }}</span>
        <div class="dropdown topbar-select-dropdown">
          <button
            class="btn btn-sm btn-outline-secondary topbar-select-btn d-inline-flex align-items-center justify-content-between text-start"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            :title="modelHint"
          >
            <span class="topbar-select-label">{{ selectedModelOption.label }}</span>
          </button>

          <ul class="dropdown-menu dropdown-menu-end topbar-select-menu">
            <li v-for="modelOption in availableModelOptions" :key="modelOption.value">
              <button
                class="dropdown-item"
                :class="{ active: modelOption.value === props.model }"
                type="button"
                :title="getModelRecommendation(modelOption)"
                @click="selectModel(modelOption.value)"
              >
                {{ modelOption.label }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <div class="topbar-field d-flex align-items-center gap-2">
        <span class="topbar-field-label">{{ t("chat.topbar.mode") }}</span>
        <div class="dropdown topbar-select-dropdown">
          <button
            class="btn btn-sm btn-outline-secondary topbar-select-btn topbar-select-btn--mode d-inline-flex align-items-center justify-content-between text-start"
            type="button"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            <span class="topbar-select-label">{{ selectedModeLabel }}</span>
          </button>

          <ul class="dropdown-menu dropdown-menu-end topbar-select-menu">
            <li v-for="modeOption in QA_MODES" :key="modeOption.value">
              <button
                class="dropdown-item"
                :class="{ active: modeOption.value === props.mode }"
                type="button"
                @click="selectMode(modeOption.value)"
              >
                {{ t(modeOption.labelKey) }}
              </button>
            </li>
          </ul>
        </div>
      </div>

      <span
        v-if="usageLabel"
        class="topbar-status topbar-status--quota d-inline-flex align-items-center"
        :aria-label="usageTitle"
        :title="usageTitle"
      >
        {{ usageLabel }}
      </span>

      <span class="topbar-status d-inline-flex align-items-center">{{ t("app.status.online") }}</span>
    </div>
  </header>
</template>
