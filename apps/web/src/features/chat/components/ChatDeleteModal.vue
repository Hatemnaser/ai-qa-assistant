<script setup lang="ts">
import type { Chat } from "../types";

defineProps<{
  chat: Chat | null;
}>();

const emit = defineEmits<{
  cancel: [];
  confirm: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="chat"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-chat-title"
      @click.self="emit('cancel')"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content app-modal">
          <div class="modal-header">
            <h5 id="delete-chat-title" class="modal-title">Delete chat?</h5>
            <button class="btn-close" type="button" aria-label="Close" @click="emit('cancel')"></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">This action cannot be undone. Are you sure you want to delete this chat?</p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="emit('cancel')">
              Cancel
            </button>
            <button class="btn btn-danger" type="button" @click="emit('confirm')">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>

    <div v-if="chat" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
