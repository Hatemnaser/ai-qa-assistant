<script setup lang="ts">
import { onMounted, ref } from "vue";

import { verifyEmail } from "../authApi";
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

onMounted(() => {
  void submitVerification();
});

async function submitVerification() {
  const token = readVerificationToken();

  if (!token) {
    errorMessage.value = "This verification link is missing its token.";
    isVerifying.value = false;
    return;
  }

  try {
    await verifyEmail(token);
    successMessage.value = "Your email is verified. You can now sign in.";
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "This verification link could not be used.";
  } finally {
    isVerifying.value = false;
  }
}

function readVerificationToken() {
  const hashQuery = window.location.hash.includes("?")
    ? window.location.hash.slice(window.location.hash.indexOf("?"))
    : "";
  const search = hashQuery || window.location.search;

  return new URLSearchParams(search.replace(/^\?/, "")).get("token") || "";
}
</script>

<template>
  <AuthLayout
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="emit('back-to-chat')"
    @toggle-theme="emit('toggle-theme')"
  >
    <div class="auth-header">
      <p class="auth-kicker">Email verification</p>
      <h2>Verify your email</h2>
      <p>Finish verifying your account before signing in.</p>
    </div>

    <div class="vstack gap-3">
      <p v-if="isVerifying" class="auth-feedback" role="status">Verifying your email...</p>
      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="button" @click="emit('navigate', 'login')">
        Sign in
      </button>
    </div>
  </AuthLayout>
</template>
