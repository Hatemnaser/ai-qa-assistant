<script setup lang="ts">
type IconName = "folder" | "plus" | "search";

defineProps<{
  name: IconName;
}>();
</script>

<template>
  <svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
    <template v-if="name === 'plus'">
      <path d="M12 5v14"></path>
      <path d="M5 12h14"></path>
    </template>

    <template v-else-if="name === 'search'">
      <circle cx="11" cy="11" r="7"></circle>
      <path d="M16.5 16.5 21 21"></path>
    </template>

    <template v-else>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path>
    </template>
  </svg>
</template>
