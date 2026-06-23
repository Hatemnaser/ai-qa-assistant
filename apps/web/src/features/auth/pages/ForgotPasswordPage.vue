<script setup lang="ts">
import { ref } from "vue";

import TextField from "../../../ui/TextField.vue";
import { useI18n } from "../../../i18n/useI18n";
import { forgotPassword } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";
import { useAuthRequest } from "../useAuthRequest";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

const email = ref("");
const successMessage = ref("");
const { t } = useI18n();
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.forgot"));

async function submitPasswordReset() {
  successMessage.value = "";

  await submit(async () => {
    const response = await forgotPassword(email.value);
    successMessage.value = response.message;
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
      <p class="auth-kicker">{{ t("auth.forgot.kicker") }}</p>
      <h2>{{ t("auth.forgot.title") }}</h2>
      <p>{{ t("auth.forgot.subtitle") }}</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitPasswordReset">
      <TextField
        id="forgot-email"
        v-model="email"
        :label="t('auth.login.email')"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? t("auth.forgot.submitting") : t("auth.forgot.submit") }}
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>{{ t("auth.forgot.remembered") }}</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">{{ t("auth.forgot.backToSignIn") }}</button>
    </div>
  </AuthLayout>
</template>
