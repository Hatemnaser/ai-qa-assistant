<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";
import Icon from "../../../ui/Icon.vue";

defineProps<{
  disabled?: boolean;
}>();

const emit = defineEmits<{
  addText: [];
  upload: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="dropdown">
    <button
      class="ui-icon-btn ui-icon-btn--xs"
      type="button"
      :aria-label="t('projects.documents.addAria')"
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
          <span>{{ t("projects.documents.uploadFiles") }}</span>
        </button>
      </li>
      <li>
        <button class="dropdown-item d-flex align-items-center gap-2" type="button" @click="emit('addText')">
          <Icon name="file-text" />
          <span>{{ t("projects.documents.createMarkdown") }}</span>
        </button>
      </li>
    </ul>
  </div>
</template>
