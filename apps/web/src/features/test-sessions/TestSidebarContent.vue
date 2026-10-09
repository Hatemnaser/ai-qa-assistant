<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "../projects/types";
import { filterTestNavigation, type SidebarTestItem } from "./navigation";
import TestNavigationList from "./TestNavigationList.vue";
import { useI18n } from "../../i18n/useI18n";
const props = defineProps<{ projects: Project[]; items: SidebarTestItem[]; activeTestId?: string | null;
  projectFilter: string; loading?: boolean; error?: string; hideFilter?: boolean }>();
const emit = defineEmits<{ select: [item: SidebarTestItem]; reload: []; "update:project-filter": [id: string] }>();
const { t } = useI18n();
const recent = computed(() => filterTestNavigation(props.items, props.projectFilter));
const archived = computed(() => filterTestNavigation(props.items, props.projectFilter, true));
</script>
<template>
  <section class="sidebar-section test-navigation">
    <label v-if="!hideFilter" class="test-navigation__filter">{{ t('workspaces.projectFilter') }}
      <select class="form-select" :value="projectFilter" @change="emit('update:project-filter', ($event.target as HTMLSelectElement).value)">
        <option value="">{{ t('workspaces.allProjects') }}</option>
        <option v-for="project in projects" :key="project.id" :value="project.id">{{ project.name }}</option>
      </select>
    </label>
    <p v-if="loading" class="sidebar-empty" role="status">{{ t('testSessions.nav.loading') }}</p>
    <div v-else-if="error" class="sidebar-empty" role="alert">{{ error }}
      <button type="button" class="btn btn-secondary" @click="emit('reload')">{{ t('testSessions.retry') }}</button>
    </div>
    <template v-else>
      <h2 class="test-navigation__heading">{{ t('testSessions.nav.recent') }}</h2>
      <TestNavigationList :items="recent" :projects="projects" :active-test-id="activeTestId" @select="emit('select', $event)" />
      <p v-if="!recent.length" class="sidebar-empty">{{ t('testSessions.nav.noSessions') }}</p>
      <details v-if="archived.length" class="test-navigation__archive">
        <summary>{{ t('testSessions.nav.archived') }} ({{ archived.length }})</summary>
        <TestNavigationList :items="archived" :projects="projects" :active-test-id="activeTestId" @select="emit('select', $event)" />
      </details>
    </template>
  </section>
</template>
