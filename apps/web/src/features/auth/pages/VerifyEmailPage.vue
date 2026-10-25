<script setup lang="ts">
import { ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { verifyEmail } from "../authApi";
import { consumeAuthTokenFromLocation } from "../authToken";
import AuthLayout from "../components/AuthLayout.vue";
import TextField from "../../../ui/TextField.vue";
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

const { t } = useI18n();
const token = consumeAuthTokenFromLocation();
const newPassword = ref("");
const confirmPassword = ref("");
const verified = ref(false);
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.verifyFailed"));
if (!token) errorMessage.value = t("errors.auth.verifyMissingToken");

async function submitVerification() {
  if (!token) {
    errorMessage.value = t("errors.auth.verifyMissingToken");
    return;
  }
  if (newPassword.value !== confirmPassword.value) {
    errorMessage.value = t("errors.auth.resetMismatch");
    return;
  }
  await submit(async () => {
    await verifyEmail(token, newPassword.value);
    newPassword.value = "";
    confirmPassword.value = "";
    verified.value = true;
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
      <p class="auth-kicker">{{ t("auth.verify.kicker") }}</p>
      <h2>{{ t("auth.verify.title") }}</h2>
      <p>{{ t("auth.verify.subtitle") }}</p>
    </div>

    <form v-if="!verified" class="vstack gap-3" @submit.prevent="submitVerification">
      <TextField id="verify-password" v-model="newPassword" :label="t('auth.reset.newPassword')"
        type="password" autocomplete="new-password" :placeholder="t('auth.reset.passwordPlaceholder')"
        :disabled="isSubmitting || !token" :max-length="PASSWORD_MAX_LENGTH" :min-length="PASSWORD_MIN_LENGTH" required />
      <TextField id="verify-password-confirmation" v-model="confirmPassword" :label="t('auth.reset.confirmPassword')"
        type="password" autocomplete="new-password" :placeholder="t('auth.reset.confirmPasswordPlaceholder')"
        :disabled="isSubmitting || !token" :max-length="PASSWORD_MAX_LENGTH" :min-length="PASSWORD_MIN_LENGTH" required />
      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting || !token">
        {{ isSubmitting ? t("auth.verify.loading") : t("auth.verify.submit") }}
      </button>
    </form>
    <div v-else class="vstack gap-3">
      <p class="auth-feedback auth-feedback-success" role="status">{{ t("auth.verify.success") }}</p>
      <button class="btn btn-primary btn-control w-100" type="button" @click="emit('navigate', 'login')">
        {{ t("app.actions.signIn") }}
      </button>
    </div>
  </AuthLayout>
</template>
