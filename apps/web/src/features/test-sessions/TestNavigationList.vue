<script setup lang="ts">
import type { Project } from "../projects/types";
import type { SidebarTestItem } from "./navigation";
import { useI18n } from "../../i18n/useI18n";
defineProps<{ items: SidebarTestItem[]; projects: Project[]; activeTestId?: string | null }>();
const emit = defineEmits<{ select: [item: SidebarTestItem] }>();
const { t } = useI18n();
</script>
<template>
  <div class="test-navigation-list">
    <button v-for="item in items" :key="item.id" type="button" class="test-navigation-list__item"
      :class="{ active: item.id === activeTestId }" :aria-current="item.id === activeTestId ? 'page' : undefined"
      @click="emit('select', item)">
      <span class="test-navigation-list__title">{{ item.title }}</span>
      <small>{{ projects.find(project => project.id === item.projectId)?.name }}</small>
      <small v-if="item.id.startsWith('request:')">{{ t('workspaces.legacy') }}</small>
      <small v-if="item.phase">{{ t(`projects.qa.focus.phase.${item.phase}`) }}</small>
    </button>
  </div>
</template>
