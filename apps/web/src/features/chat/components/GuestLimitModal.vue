<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";

const emit = defineEmits<{
  close: [];
  "export-chat": [];
  "sign-in": [];
  register: [];
}>();

const { t } = useI18n();
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
              <p class="text-uppercase small text-muted fw-bold mb-1">{{ t("chat.guestLimit.kicker") }}</p>
              <h5 id="guest-limit-title" class="modal-title">{{ t("chat.guestLimit.title") }}</h5>
            </div>
            <button class="btn-close" type="button" :aria-label="t('app.actions.close')" @click="emit('close')"></button>
          </div>

          <div class="modal-body">
            <p class="mb-0">
              {{ t("chat.guestLimit.body") }}
            </p>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="emit('export-chat')">
              {{ t("chat.guestLimit.export") }}
            </button>
            <button class="btn btn-outline-secondary" type="button" @click="emit('sign-in')">
              {{ t("app.actions.signIn") }}
            </button>
            <button class="btn btn-primary" type="button" @click="emit('register')">
              {{ t("app.actions.createFreeAccount") }}
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="modal-backdrop fade show"></div>
  </Teleport>
</template>
