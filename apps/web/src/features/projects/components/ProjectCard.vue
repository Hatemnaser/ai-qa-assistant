<script setup lang="ts">
import type { Project } from "../types";
import { formatRelativeDate } from "../projectDate";
import { useI18n } from "../../../i18n/useI18n";

defineProps<{
  isMenuOpen?: boolean;
  project: Project;
}>();

const emit = defineEmits<{
  open: [project: Project];
  "open-menu": [event: MouseEvent, projectId: string];
}>();

const { t } = useI18n();
</script>

<template>
  <article class="workspace-panel project-card" :class="{ 'project-card--menu-open': isMenuOpen }">
    <button class="project-card__body" type="button" @click="emit('open', project)">
      <h2>{{ project.name }}</h2>
      <p v-if="project.description">{{ project.description }}</p>
      <small>{{ t("projects.card.updated", { date: formatRelativeDate(project.updatedAt) }) }}</small>
    </button>

    <div class="project-card__menu-action">
      <button
        class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
        type="button"
        :aria-label="t('projects.optionsAria')"
        @click.stop="emit('open-menu', $event, project.id)"
      >
        &hellip;
      </button>
    </div>
  </article>
</template>
