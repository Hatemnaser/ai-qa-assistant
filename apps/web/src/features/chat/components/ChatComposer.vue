<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from "vue";

import { ATTACHMENT_INPUT_ACCEPT } from "../chatAttachments";
import { AI_MODELS, COMPOSER_PLACEHOLDER_KEYS_BY_MODE, DEFAULT_MODEL, QA_MODES, QUICK_ACTIONS, VISUAL_REVIEW_MODEL } from "../constants";
import { pastedFiles, shouldSubmitComposerKey } from "../composerInteractions";
import type { QuickAction } from "../constants";
import type { AiModelOption, SelectedAttachment } from "../types";
import { useI18n } from "../../../i18n/useI18n";
import Icon from "../../../ui/Icon.vue";

const props = defineProps<{
  disabled?: boolean;
  disabledMessage?: string;
  isSending: boolean;
  message: string;
  mode: string;
  model?: string;
  modelOptions?: readonly AiModelOption[];
  showStarters?: boolean;
  selectedAttachments: SelectedAttachment[];
}>();

const emit = defineEmits<{
  "update:message": [value: string];
  "update:mode": [value: string];
  "update:model": [value: string];
  submit: [];
  "attachments-selected": [files: File[]];
  "open-selected-attachment": [index: number];
  "remove-selected-attachment": [index: number];
  "quick-action": [action: QuickAction];
  "disabled-click": [];
}>();

const textareaInput = ref<HTMLTextAreaElement | null>(null);
const attachmentInput = ref<HTMLInputElement | null>(null);
const attachmentInputId = useId();
const dragDepth = ref(0);
const isDraggingOver = ref(false);
let resizeObserver: ResizeObserver | null = null;
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
const modelOptions = computed(() => {
  const options = props.modelOptions?.length ? props.modelOptions : AI_MODELS;
  return props.mode === "screenshot_review" && !options.some(option => option.value === VISUAL_REVIEW_MODEL)
    ? [...options, AI_MODELS.find(option => option.value === VISUAL_REVIEW_MODEL)!]
    : options;
});
const welcomeActions = QUICK_ACTIONS.filter((action) => ["test_cases", "bug_report", "screenshot_review"].includes(action.mode));
const visualAction = QUICK_ACTIONS.find((action) => action.mode === "screenshot_review")!;
const hasImage = computed(() => props.selectedAttachments.some((attachment) => attachment.type === "image"));

onMounted(() => {
  autoResizeTextarea();
  // Project context loads asynchronously and can narrow the composer after mount.
  // Observe width only so resizing the textarea itself cannot create a loop.
  if (typeof ResizeObserver === "undefined" || !textareaInput.value?.parentElement) return;
  let previousWidth = -1;
  resizeObserver = new ResizeObserver(([entry]) => {
    if (!entry || entry.contentRect.width === previousWidth) return;
    previousWidth = entry.contentRect.width;
    autoResizeTextarea();
  });
  resizeObserver.observe(textareaInput.value.parentElement);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
watch(
  [() => props.message, () => props.mode, () => composerPlaceholder.value],
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

  dragDepth.value += 1;
  isDraggingOver.value = true;
}

function hideDragOver() {
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  isDraggingOver.value = dragDepth.value > 0;
}

function handleAttachmentChange(event: Event) {
  if (isComposerDisabled.value) return;

  const input = event.target as HTMLInputElement;
  const files = Array.from(input.files || []);

  input.value = "";
  emit("attachments-selected", files);
}

function handleDrop(event: DragEvent) {
  dragDepth.value = 0;
  isDraggingOver.value = false;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) return;
  event.stopPropagation();

  if (isComposerDisabled.value) {
    emit("disabled-click");
    return;
  }

  emit("attachments-selected", files);
}

function handlePaste(event: ClipboardEvent) {
  if (isComposerDisabled.value) return;

  const files = pastedFiles(event.clipboardData);

  if (files.length === 0) return;

  event.preventDefault();
  event.stopPropagation();
  emit("attachments-selected", files);
}

function requestSubmit() {
  if (isComposerDisabled.value) {
    emit("disabled-click");
    return;
  }

  if (!props.isSending) emit("submit");
}

function handleKeydown(event: KeyboardEvent) {
  if (!shouldSubmitComposerKey(event)) return;
  event.preventDefault();
  requestSubmit();
}

function handleComposerClick() {
  if (isComposerDisabled.value) {
    emit("disabled-click");
  }
}
</script>

<template>
  <form class="chat-form" @submit.prevent="requestSubmit">
    <section v-if="showStarters && !hasImage" class="quick-actions d-flex flex-wrap gap-2">
      <button
        v-for="action in welcomeActions"
        :key="action.label"
        class="btn btn-sm btn-outline-primary"
        type="button"
        :disabled="isComposerDisabled"
        @click="emit('quick-action', action)"
      >
        {{ t(action.labelKey) }}
      </button>
    </section>
    <div v-if="hasImage && mode !== 'screenshot_review'" class="quick-actions">
      <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="isComposerDisabled" @click="emit('quick-action', visualAction)">{{ t('chat.mode.visualReview') }}</button>
    </div>

    <div
      class="composer d-flex flex-column justify-content-center"
      :class="{ 'drag-over': isDraggingOver, 'is-disabled': isComposerDisabled }"
      @click="handleComposerClick"
      @dragenter.prevent="showDragOver"
      @dragover.prevent
      @dragleave.prevent="hideDragOver"
      @drop.prevent="handleDrop"
      @paste="handlePaste"
    >
      <div v-if="selectedAttachments.length" class="attachment-preview">
        <div
          v-for="(selectedAttachment, index) in selectedAttachments"
          :key="`${selectedAttachment.name}-${index}`"
          class="attachment-preview-card d-flex align-items-center"
        >
          <button class="attachment-preview-open" type="button" @click="emit('open-selected-attachment', index)">
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
          </button>
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
        <textarea
          ref="textareaInput"
          v-model="draftMessage"
          class="composer-textarea"
          rows="1"
          :placeholder="composerPlaceholder"
          :aria-label="t('chat.composer.message')"
          :readonly="isComposerDisabled"
          @input="autoResizeTextarea"
          @keydown="handleKeydown"
        />
      </div>

      <div class="composer-controls">
        <button
          class="ui-icon-btn composer-icon-btn"
          type="button"
          :aria-label="t('chat.composer.attachFile')"
          :title="t('chat.composer.attachFile')"
          :aria-controls="attachmentInputId"
          :disabled="isComposerDisabled"
          @click="attachmentInput?.click()"
        >
          <Icon name="paperclip" />
        </button>
        <label class="composer-setting">
          <span class="visually-hidden">{{ t('chat.topbar.mode') }}</span>
          <select class="form-select form-select-sm" :value="mode" :disabled="isComposerDisabled" @change="emit('update:mode', ($event.target as HTMLSelectElement).value)">
            <option v-for="option in QA_MODES" :key="option.value" :value="option.value">{{ t(option.labelKey) }}</option>
          </select>
        </label>
        <label class="composer-setting composer-setting--model">
          <span class="visually-hidden">{{ t('chat.topbar.model') }}</span>
          <select class="form-select form-select-sm" :value="mode === 'screenshot_review' ? VISUAL_REVIEW_MODEL : (model || DEFAULT_MODEL)" :disabled="isComposerDisabled || mode === 'screenshot_review'" @change="emit('update:model', ($event.target as HTMLSelectElement).value)">
            <option v-for="option in modelOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
          </select>
        </label>
        <button
          class="ui-icon-btn ui-icon-btn--send composer-send-btn"
          type="submit"
          :aria-label="t('chat.composer.send')"
          :title="t('chat.composer.send')"
          :disabled="isSending || isComposerDisabled || (!message.trim() && !selectedAttachments.length)"
        >
          <Icon name="arrow-up" />
        </button>
      </div>
      <small v-if="mode === 'screenshot_review'" class="composer-model-note">{{ t('model.hintVisual', { model: VISUAL_REVIEW_MODEL }) }}</small>
      <input
        :id="attachmentInputId"
        ref="attachmentInput"
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

    <p class="composer-ai-notice mb-0" role="note">
      {{ t("chat.composer.aiNotice") }}
    </p>
  </form>
</template>
