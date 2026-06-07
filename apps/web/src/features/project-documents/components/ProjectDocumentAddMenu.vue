<script setup lang="ts">
import Icon from "../../../ui/Icon.vue";

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  addText: [];
  upload: [];
}>();
</script>

<template>
  <div class="dropdown">
    <button
      class="ui-icon-btn ui-icon-btn--xs"
      type="button"
      aria-label="Add project document"
      data-bs-toggle="dropdown"
      aria-expanded="false"
      :disabled="disabled"
    >
      <Icon name="plus" />
    </button>

    <ul class="dropdown-menu dropdown-menu-end project-document-menu">
      <li>
        <button class="dropdown-item d-flex align-items-center gap-2" type="button" @click="emit('upload')">
          <Icon name="upload" />
          <span>Upload files</span>
        </button>
      </li>
      <li>
        <button class="dropdown-item d-flex align-items-center gap-2" type="button" @click="emit('addText')">
          <Icon name="file-text" />
          <span>Create Markdown</span>
        </button>
      </li>
    </ul>
  </div>
</template>
