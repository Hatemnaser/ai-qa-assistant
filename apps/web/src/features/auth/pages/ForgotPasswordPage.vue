<script setup lang="ts">
import { ref } from "vue";

import TextField from "../../../ui/TextField.vue";
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
const { errorMessage, isSubmitting, submit } = useAuthRequest(
  "Could not request a password reset. Please try again."
);

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
      <p class="auth-kicker">Account help</p>
      <h2>Reset your password</h2>
      <p>Enter your email and we will prepare the reset flow.</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitPasswordReset">
      <TextField
        id="forgot-email"
        v-model="email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? "Sending..." : "Send reset link" }}
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>Remembered it?</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">Back to sign in</button>
    </div>
  </AuthLayout>
</template>
