<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import type { Chat } from "../types";

const props = defineProps<{
  chat: Chat | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();

const { t } = useI18n();

function requestCancel() {
  emit("cancel");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  isOpen: () => Boolean(props.chat),
  onClose: requestCancel,
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="chat"
      ref="dialogRef"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-chat-title"
      @click.self="requestCancel"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content app-modal">
          <div class="modal-header">
            <h5 id="delete-chat-title" class="modal-title">{{ t("chat.delete.title") }}</h5>
            <button class="btn-close" type="button" :aria-label="t('app.actions.close')" @click="requestCancel"></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">{{ t("chat.delete.body") }}</p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="requestCancel">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-danger" type="button" @click="emit('confirm')">
              {{ t("app.actions.delete") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="chat" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
