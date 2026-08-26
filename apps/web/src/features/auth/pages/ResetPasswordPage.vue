<script setup lang="ts">
import { ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import TextField from "../../../ui/TextField.vue";
import { resetPassword } from "../authApi";
import { consumeAuthTokenFromLocation } from "../authToken";
import AuthLayout from "../components/AuthLayout.vue";
import { useAuthRequest } from "../useAuthRequest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../passwordPolicy";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

const confirmPassword = ref("");
const newPassword = ref("");
const resetComplete = ref(false);
const token = consumeAuthTokenFromLocation();
const { t } = useI18n();
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.reset"));

if (!token) {
  errorMessage.value = t("errors.auth.resetMissingToken");
}

async function submitPasswordReset() {
  if (!token) {
    errorMessage.value = t("errors.auth.resetMissingToken");
    return;
  }

  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = t("errors.auth.resetMismatch");
    return;
  }

  await submit(async () => {
    await resetPassword(token, newPassword.value);
    newPassword.value = "";
    confirmPassword.value = "";
    resetComplete.value = true;
  });
}
</script>

<template>
  <AuthLayout
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="emit('back-to-chat')"
    @toggle-theme="emit('toggle-theme')"
  >
    <div class="auth-header">
      <p class="auth-kicker">{{ t("auth.reset.kicker") }}</p>
      <h2>{{ t("auth.reset.title") }}</h2>
      <p>{{ t("auth.reset.subtitle") }}</p>
    </div>

    <form v-if="!resetComplete" class="vstack gap-3" @submit.prevent="submitPasswordReset">
      <TextField
        id="reset-password"
        v-model="newPassword"
        :label="t('auth.reset.newPassword')"
        type="password"
        autocomplete="new-password"
        :placeholder="t('auth.reset.passwordPlaceholder')"
        :disabled="isSubmitting || !token"
        :max-length="PASSWORD_MAX_LENGTH"
        :min-length="PASSWORD_MIN_LENGTH"
        required
      />
      <TextField
        id="reset-password-confirmation"
        v-model="confirmPassword"
        :label="t('auth.reset.confirmPassword')"
        type="password"
        autocomplete="new-password"
        :placeholder="t('auth.reset.confirmPasswordPlaceholder')"
        :disabled="isSubmitting || !token"
        :max-length="PASSWORD_MAX_LENGTH"
        :min-length="PASSWORD_MIN_LENGTH"
        required
      />

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting || !token">
        {{ isSubmitting ? t("auth.reset.submitting") : t("auth.reset.submit") }}
      </button>
    </form>

    <div v-else class="vstack gap-3">
      <p class="auth-feedback auth-feedback-success" role="status">{{ t("auth.reset.success") }}</p>
    </div>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">
        {{ t("auth.reset.backToSignIn") }}
      </button>
    </div>
  </AuthLayout>
</template>
