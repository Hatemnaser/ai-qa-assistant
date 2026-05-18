<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from "vue";

import { COMPOSER_PLACEHOLDERS_BY_MODE, QUICK_ACTIONS } from "../constants";
import type { QuickAction } from "../constants";
import type { SelectedImage } from "../types";

const props = defineProps<{
  isSending: boolean;
  message: string;
  mode: string;
  selectedImage: SelectedImage | null;
}>();

const emit = defineEmits<{
  "update:message": [value: string];
  submit: [];
  "image-selected": [file: File | undefined];
  "open-selected-image": [];
  "clear-selected-image": [];
  "quick-action": [action: QuickAction];
}>();

const textareaInput = ref<HTMLTextAreaElement | null>(null);
const isDraggingOver = ref(false);

const draftMessage = computed({
  get: () => props.message,
  set: (value: string) => {
    emit("update:message", value);
    void nextTick(autoResizeTextarea);
  },
});
const composerPlaceholder = computed(
  () => COMPOSER_PLACEHOLDERS_BY_MODE[props.mode] || COMPOSER_PLACEHOLDERS_BY_MODE.general
);

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
  isDraggingOver.value = true;
}

function hideDragOver() {
  isDraggingOver.value = false;
}

function handleScreenshotChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";
  emit("image-selected", file);
}

function handleDrop(event: DragEvent) {
  hideDragOver();
  emit("image-selected", event.dataTransfer?.files?.[0]);
}
</script>

<template>
  <form class="chat-form" @submit.prevent="emit('submit')">
    <div
      class="composer"
      :class="{ 'drag-over': isDraggingOver }"
      @dragenter.prevent="showDragOver"
      @dragover.prevent="showDragOver"
      @dragleave.prevent="hideDragOver"
      @drop.prevent="handleDrop"
    >
      <div v-if="selectedImage" id="attachment-preview" class="attachment-preview">
        <div class="attachment-preview-card" @click="emit('open-selected-image')">
          <img :src="selectedImage.previewUrl" :alt="selectedImage.name" />
          <div class="attachment-preview-info">
            <div class="attachment-preview-name">{{ selectedImage.name }}</div>
            <div class="attachment-preview-type">Image</div>
          </div>
          <button
            class="attachment-remove-btn"
            type="button"
            aria-label="Remove attachment"
            @click.stop="emit('clear-selected-image')"
          >
            &times;
          </button>
        </div>
      </div>

      <div class="composer-row">
        <div class="dropup">
          <button
            class="ui-icon-btn composer-icon-btn"
            type="button"
            aria-label="Attach file"
            data-bs-toggle="dropdown"
            aria-expanded="false"
          >
            +
          </button>

          <ul class="dropdown-menu composer-menu">
            <li>
              <label class="dropdown-item mb-0" for="screenshot-input">Upload image</label>
            </li>
            <li>
              <button class="dropdown-item disabled" type="button" disabled>
                Upload document soon
              </button>
            </li>
          </ul>
        </div>

        <textarea
          ref="textareaInput"
          v-model="draftMessage"
          class="composer-textarea"
          rows="1"
          :placeholder="composerPlaceholder"
          @input="autoResizeTextarea"
          @keydown.enter.exact.prevent="emit('submit')"
        />

        <button class="ui-icon-btn ui-icon-btn--send composer-send-btn" type="submit" :disabled="isSending">
          &uarr;
        </button>
      </div>

      <input
        id="screenshot-input"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        @change="handleScreenshotChange"
      />
    </div>

    <section class="quick-actions">
      <button
        v-for="action in QUICK_ACTIONS"
        :key="action.label"
        class="btn btn-sm btn-outline-primary"
        type="button"
        @click="emit('quick-action', action)"
      >
        {{ action.label }}
      </button>
    </section>
  </form>
</template>
