<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { ATTACHMENT_INPUT_ACCEPT } from "../chatAttachments";
import { COMPOSER_PLACEHOLDER_KEYS_BY_MODE, QUICK_ACTIONS } from "../constants";
import type { QuickAction } from "../constants";
import type { SelectedAttachment } from "../types";
import { useI18n } from "../../../i18n/useI18n";

const props = defineProps<{
  disabled?: boolean;
  disabledMessage?: string;
  isSending: boolean;
  message: string;
  mode: string;
  selectedAttachments: SelectedAttachment[];
}>();

const emit = defineEmits<{
  "update:message": [value: string];
  submit: [];
  "attachments-selected": [files: File[]];
  "open-selected-attachment": [index: number];
  "remove-selected-attachment": [index: number];
  "quick-action": [action: QuickAction];
  "disabled-click": [];
}>();

const textareaInput = ref<HTMLTextAreaElement | null>(null);
const isDraggingOver = ref(false);
const { t } = useI18n();

const draftMessage = computed({
  get: () => props.message,
  set: (value: string) => {
    emit("update:message", value);
    void nextTick(autoResizeTextarea);
  },
});
const composerPlaceholder = computed(
  () => t(COMPOSER_PLACEHOLDER_KEYS_BY_MODE[props.mode] || COMPOSER_PLACEHOLDER_KEYS_BY_MODE.general)
);
const isComposerDisabled = computed(() => Boolean(props.disabled));

onMounted(autoResizeTextarea);
watch(
  () => props.message,
  () => void nextTick(autoResizeTextarea)
);

function autoResizeTextarea() {
  const textarea = textareaInput.value;

  if (!textarea) return;

  textarea.style.height = "auto";
  textarea.style.height = `${textarea.scrollHeight}px`;
}

function showDragOver() {
  if (isComposerDisabled.value) return;

  isDraggingOver.value = true;
}

function hideDragOver() {
  isDraggingOver.value = false;
}

function handleAttachmentChange(event: Event) {
  if (isComposerDisabled.value) return;

  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  input.value = "";
  emit("attachments-selected", files);
}

function handleDrop(event: DragEvent) {
  hideDragOver();

  if (isComposerDisabled.value) {
    emit("disabled-click");
    return;
  }

  emit("attachments-selected", Array.from(event.dataTransfer?.files || []));
}

function handlePaste(event: ClipboardEvent) {
  if (isComposerDisabled.value) return;

  const clipboardFiles = Array.from(event.clipboardData?.files || []);
  const itemFiles = Array.from(event.clipboardData?.items || [])
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter((file): file is File => Boolean(file));
  const files = clipboardFiles.length > 0 ? clipboardFiles : itemFiles;

  if (files.length === 0) return;

  event.preventDefault();
  emit("attachments-selected", files);
}

function requestSubmit() {
  if (isComposerDisabled.value) {
    emit("disabled-click");
    return;
  }

  emit("submit");
}

function handleComposerClick() {
  if (isComposerDisabled.value) {
    emit("disabled-click");
  }
}
</script>

<template>
  <form class="chat-form" @submit.prevent="requestSubmit">
    <div
      class="composer d-flex flex-column justify-content-center"
      :class="{ 'drag-over': isDraggingOver, 'is-disabled': isComposerDisabled }"
      @click="handleComposerClick"
      @dragenter.prevent="showDragOver"
      @dragover.prevent="showDragOver"
      @dragleave.prevent="hideDragOver"
      @drop.prevent="handleDrop"
      @paste="handlePaste"
    >
      <div v-if="selectedAttachments.length" id="attachment-preview" class="attachment-preview">
        <div
          v-for="(selectedAttachment, index) in selectedAttachments"
          :key="`${selectedAttachment.name}-${index}`"
          class="attachment-preview-card d-flex align-items-center"
          @click="emit('open-selected-attachment', index)"
        >
          <img
            v-if="selectedAttachment.type === 'image' && selectedAttachment.previewUrl"
            :src="selectedAttachment.previewUrl"
            :alt="selectedAttachment.name"
          />
          <div class="attachment-preview-info">
            <div class="attachment-preview-name">{{ selectedAttachment.name }}</div>
            <div class="attachment-preview-type">
              {{ selectedAttachment.type === "image" ? t("app.common.image") : t("app.common.file") }}
            </div>
          </div>
          <button
            class="attachment-remove-btn"
            type="button"
            :aria-label="t('chat.composer.removeAttachment')"
            :disabled="isComposerDisabled"
            @click.stop="emit('remove-selected-attachment', index)"
          >
            &times;
          </button>
        </div>
      </div>

      <div class="composer-row d-flex align-items-end">
        <div class="dropup">
          <button
            class="ui-icon-btn composer-icon-btn"
            type="button"
            :aria-label="t('chat.composer.attachFile')"
            data-bs-toggle="dropdown"
            aria-expanded="false"
            :disabled="isComposerDisabled"
          >
            +
          </button>

          <ul class="dropdown-menu composer-menu">
            <li>
              <label class="dropdown-item mb-0" for="attachment-input">{{ t("chat.composer.upload") }}</label>
            </li>
          </ul>
        </div>

        <textarea
          ref="textareaInput"
          v-model="draftMessage"
          class="composer-textarea"
          rows="1"
          :placeholder="composerPlaceholder"
          :readonly="isComposerDisabled"
          @input="autoResizeTextarea"
          @keydown.enter.exact.prevent="requestSubmit"
        />

        <button
          class="ui-icon-btn ui-icon-btn--send composer-send-btn"
          type="submit"
          :disabled="isSending || isComposerDisabled"
        >
          &uarr;
        </button>
      </div>

      <input
        id="attachment-input"
        type="file"
        :accept="ATTACHMENT_INPUT_ACCEPT"
        multiple
        hidden
        @change="handleAttachmentChange"
      />
    </div>

    <p v-if="isComposerDisabled && disabledMessage" class="composer-disabled-note mb-0">
      {{ disabledMessage }}
    </p>

    <section class="quick-actions d-flex flex-wrap gap-2">
      <button
        v-for="action in QUICK_ACTIONS"
        :key="action.label"
        class="btn btn-sm btn-outline-primary"
        type="button"
        :disabled="isComposerDisabled"
        @click="emit('quick-action', action)"
      >
        {{ t(action.labelKey) }}
      </button>
    </section>
  </form>
</template>
