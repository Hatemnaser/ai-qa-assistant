<script setup lang="ts">
type IconName = "edit" | "file-text" | "folder" | "folder-open" | "plus" | "search" | "upload";

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

    <template v-else-if="name === 'edit'">
      <path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10z"></path>
      <path d="m14.5 7.5 3 3"></path>
    </template>

    <template v-else-if="name === 'upload'">
      <path d="M12 16V4"></path>
      <path d="m7 9 5-5 5 5"></path>
      <path d="M5 20h14"></path>
    </template>

    <template v-else-if="name === 'file-text'">
      <path d="M6 3h8l4 4v14H6z"></path>
      <path d="M14 3v5h5"></path>
      <path d="M9 13h6"></path>
      <path d="M9 17h6"></path>
    </template>

    <template v-else-if="name === 'folder-open'">
      <path d="M3 8A2.5 2.5 0 0 1 5.5 5H9l2 2h4.5A2.5 2.5 0 0 1 18 9.5v1"></path>
      <path d="M3.5 10.5h15.8a1.5 1.5 0 0 1 1.43 1.95l-1.65 5.25A2.5 2.5 0 0 1 16.7 19H5.5A2.5 2.5 0 0 1 3 16.5V11"></path>
    </template>

    <template v-else>
      <path d="M3 7.5A2.5 2.5 0 0 1 5.5 5H9l2 2h7.5A2.5 2.5 0 0 1 21 9.5v7A2.5 2.5 0 0 1 18.5 19h-13A2.5 2.5 0 0 1 3 16.5z"></path>
    </template>
  </svg>
</template>
