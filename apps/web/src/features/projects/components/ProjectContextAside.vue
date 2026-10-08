<script setup lang="ts">
import type { AuthUser } from "../../auth/types";
import ProjectContextContent from "./ProjectContextContent.vue";
const emit = defineEmits<{ integrations: [] }>();

defineProps<{
  currentUser: AuthUser | null;
  projectId: string;
  projectName: string;
  focusSection?: "files" | null;
  displaySection?: "context" | "files";
  integrationsTarget?: HTMLElement | null;
}>();
</script>

<template>
  <ProjectContextContent
    v-if="currentUser && projectId"
    :key="`${currentUser.id}:${projectId}`"
    :project-id="projectId"
    :project-name="projectName"
    :focus-section="focusSection"
    :display-section="displaySection"
    :integrations-target="integrationsTarget"
    @integrations="emit('integrations')"
  />
</template>
