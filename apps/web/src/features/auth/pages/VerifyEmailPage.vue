<script setup lang="ts">
import { onMounted, ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { verifyEmail } from "../authApi";
import { consumeAuthTokenFromLocation } from "../authToken";
import AuthLayout from "../components/AuthLayout.vue";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

const errorMessage = ref("");
const isVerifying = ref(true);
const successMessage = ref("");
const { t } = useI18n();

onMounted(() => {
  void submitVerification();
});

async function submitVerification() {
const token = consumeAuthTokenFromLocation();

  if (!token) {
    errorMessage.value = t("errors.auth.verifyMissingToken");
    isVerifying.value = false;
    return;
  }

  try {
    await verifyEmail(token);
    successMessage.value = t("auth.verify.success");
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t("errors.auth.verifyFailed");
  } finally {
    isVerifying.value = false;
  }
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

    <div class="vstack gap-3">
      <p v-if="isVerifying" class="auth-feedback" role="status">{{ t("auth.verify.loading") }}</p>
      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="button" @click="emit('navigate', 'login')">
        {{ t("app.actions.signIn") }}
      </button>
    </div>
  </AuthLayout>
</template>
