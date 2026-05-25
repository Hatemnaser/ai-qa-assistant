<script setup lang="ts">
const emit = defineEmits<{
  close: [];
  "export-chat": [];
  "sign-in": [];
  register: [];
}>();
</script>

<template>
  <Teleport to="body">
    <div
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="guest-limit-title"
      @click.self="emit('close')"
    >
      <div class="modal-dialog modal-dialog-centered">
        <div class="modal-content app-modal">
          <div class="modal-header">
            <div>
              <p class="text-uppercase small text-muted fw-bold mb-1">Free demo</p>
              <h5 id="guest-limit-title" class="modal-title">Guest limit reached</h5>
            </div>
            <button class="btn-close" type="button" aria-label="Close" @click="emit('close')"></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">
              Create a free account or sign in to continue with more credits. You can export this chat
              before switching accounts.
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="emit('export-chat')">
              Export chat
            </button>
            <button class="btn btn-outline-secondary" type="button" @click="emit('sign-in')">
              Sign in
            </button>
            <button class="btn btn-primary" type="button" @click="emit('register')">
              Create free account
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-backdrop fade show"></div>
  </Teleport>
</template>
