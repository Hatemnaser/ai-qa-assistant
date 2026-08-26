<script setup lang="ts">
import { computed } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import { renderMarkdown } from "../../../ui/content/renderMarkdown";
import {
  canUseRichProjectDocumentPreview,
  getProjectDocumentHighlightedHtml,
  getProjectDocumentLineNumbers,
} from "../projectDocumentPreview";
import { getProjectDocumentType } from "../projectDocumentTypes";
import type { ProjectDocument } from "../types";

const props = defineProps<{
  document: ProjectDocument | null;
}>();

const emit = defineEmits<{
  cancel: [];
}>();

const { t } = useI18n();
const documentType = computed(() => (props.document ? getProjectDocumentType(props.document) : null));
const canUseRichPreview = computed(() =>
  props.document ? canUseRichProjectDocumentPreview(props.document) : false
);
const highlightedHtml = computed(() =>
  props.document ? getProjectDocumentHighlightedHtml(props.document) : ""
);
const lineNumbers = computed(() =>
  props.document ? getProjectDocumentLineNumbers(props.document.content) : "1"
);
const markdownHtml = computed(() => {
  if (!props.document || documentType.value?.previewKind !== "markdown" || !canUseRichPreview.value) {
    return "";
  }

  return renderMarkdown(props.document.content);
});
const usesSourcePreview = computed(
  () => documentType.value?.previewKind !== "markdown" || !canUseRichPreview.value
);

function requestCancel() {
  emit("cancel");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  isOpen: () => Boolean(props.document),
  onClose: requestCancel,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="document"
      ref="dialogRef"
      class="modal fade show d-block project-document-preview"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-document-preview-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered project-document-preview-dialog">
        <section class="modal-content app-modal project-document-preview-modal">
          <header class="modal-header">
            <div class="project-document-preview__heading">
              <h2 id="project-document-preview-title" class="modal-title">{{ document.title }}</h2>
              <span>{{ documentType?.label || t("projects.documents.fallbackType") }}</span>
            </div>
            <button class="btn-close" type="button" :aria-label="t('app.actions.close')" @click="requestCancel"></button>
          </header>

          <div class="modal-body project-document-preview__body">
            <p v-if="!canUseRichPreview" class="project-document-preview__notice mb-0">
              {{ t("projects.documents.previewPlainNotice") }}
            </p>

            <div
              v-if="documentType?.previewKind === 'markdown' && canUseRichPreview"
              class="answer project-document-preview__markdown"
              v-html="markdownHtml"
            ></div>

            <div
              v-else-if="usesSourcePreview"
              class="project-document-preview__code"
              :class="{ 'project-document-preview__code--plain': !lineNumbers }"
            >
              <pre v-if="lineNumbers" class="project-document-preview__lines" aria-hidden="true">{{ lineNumbers }}</pre>
              <pre class="project-document-preview__source"><code
                v-if="highlightedHtml"
                :class="`language-${documentType?.highlightLanguage || 'plaintext'}`"
                v-html="highlightedHtml"
              ></code><code v-else>{{ document.content }}</code></pre>
            </div>
          </div>
        </section>
      </div>
    </div>

    <div v-if="document" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
