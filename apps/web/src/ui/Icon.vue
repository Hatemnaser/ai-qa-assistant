<script setup lang="ts">
type IconName =
  | "arrow-up"
  | "chevron-down"
  | "chevron-right"
  | "close"
  | "edit"
  | "file-text"
  | "folder"
  | "folder-open"
  | "menu"
  | "paperclip"
  | "plus"
  | "search"
  | "upload";

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

    <template v-else-if="name === 'arrow-up'">
      <path d="M12 20V4"></path>
      <path d="m6 10 6-6 6 6"></path>
    </template>

    <template v-else-if="name === 'paperclip'">
      <path d="m20 11-8.5 8.5a5 5 0 0 1-7.1-7.1l9-9a3.5 3.5 0 0 1 5 5L9.8 17a2 2 0 0 1-2.8-2.8l8-8"></path>
    </template>

    <template v-else-if="name === 'menu'">
      <path d="M4 6h16M4 12h16M4 18h16"></path>
    </template>

    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M6 18 18 6"></path>
    </template>

    <template v-else-if="name === 'chevron-down'">
      <path d="m6 9 6 6 6-6"></path>
    </template>

    <template v-else-if="name === 'chevron-right'">
      <path d="m9 6 6 6-6 6"></path>
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
