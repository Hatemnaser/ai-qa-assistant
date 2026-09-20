<script setup lang="ts">
import type { AuthUser } from "../../auth/types";
import ProjectContextContent from "./ProjectContextContent.vue";

defineProps<{
  currentUser: AuthUser | null;
  projectId: string;
  projectName: string;
}>();
</script>

<template>
  <ProjectContextContent
    v-if="currentUser && projectId"
    :key="`${currentUser.id}:${projectId}`"
    :project-id="projectId"
    :project-name="projectName"
  />
</template>
