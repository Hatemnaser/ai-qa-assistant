<script setup lang="ts">
import { computed } from "vue";

import { downloadProjectDocument } from "../projectDocumentDownload";
import { getProjectDocumentType } from "../projectDocumentTypes";
import type { ProjectDocument } from "../types";

const props = defineProps<{
  document: ProjectDocument;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  delete: [documentId: string];
  edit: [document: ProjectDocument];
  preview: [document: ProjectDocument];
}>();

const documentTypeLabel = computed(() => getProjectDocumentType(props.document).label);
const lineCount = computed(() => Math.max(1, props.document.content.split(/\r?\n/).length));

function requestEdit() {
  if (props.isBusy || props.document.source !== "USER_PROVIDED") return;

  emit("edit", props.document);
}

function requestDownload() {
  if (props.isBusy) return;

  downloadProjectDocument(props.document);
}

</script>

<template>
  <article class="project-document-card">
    <button
      class="project-document-card__open"
      type="button"
      :aria-label="`Preview ${document.title}`"
      @click="emit('preview', document)"
    ></button>

    <div class="dropdown project-document-card__menu">
      <button
        class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
        type="button"
        aria-label="Project document options"
        data-bs-toggle="dropdown"
        data-bs-boundary="viewport"
        aria-expanded="false"
        :disabled="isBusy"
      >
        &hellip;
      </button>

      <ul class="dropdown-menu dropdown-menu-end project-document-card__dropdown">
        <li>
          <button class="dropdown-item" type="button" @click="requestDownload">Download</button>
        </li>
        <li v-if="document.source === 'USER_PROVIDED'">
          <button class="dropdown-item" type="button" @click="requestEdit">Edit</button>
        </li>
        <li><hr class="dropdown-divider" /></li>
        <li>
          <button
            class="dropdown-item dropdown-item-danger"
            type="button"
            @click="emit('delete', document.id)"
          >
            Delete
          </button>
        </li>
      </ul>
    </div>
    <strong>{{ document.title }}</strong>
    <small>{{ lineCount }} {{ lineCount === 1 ? "line" : "lines" }}</small>
    <span>{{ documentTypeLabel }}</span>
  </article>
</template>
