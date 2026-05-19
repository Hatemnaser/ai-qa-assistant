<script setup lang="ts">
import { ref } from "vue";

import TextField from "../../../ui/TextField.vue";
import { forgotPassword } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

const email = ref("");
const errorMessage = ref("");
const isSubmitting = ref(false);
const successMessage = ref("");

async function submitPasswordReset() {
  if (isSubmitting.value) {
    return;
  }

  errorMessage.value = "";
  successMessage.value = "";
  isSubmitting.value = true;

  try {
    const response = await forgotPassword(email.value);
    successMessage.value = response.message;
  } catch (error) {
    errorMessage.value = getErrorMessage(error);
  } finally {
    isSubmitting.value = false;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not request a password reset. Please try again.";
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
