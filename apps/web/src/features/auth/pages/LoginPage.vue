<script setup lang="ts">
import { ref } from "vue";

import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import { login } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";
import type { AuthUser } from "../types";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  authenticated: [user: AuthUser];
  "back-to-chat": [];
  navigate: [view: "register" | "forgot-password"];
  "toggle-theme": [];
}>();

const email = ref("");
const errorMessage = ref("");
const isSubmitting = ref(false);
const password = ref("");
const remember = ref(false);

async function submitLogin() {
  if (isSubmitting.value) {
    return;
  }

  errorMessage.value = "";
  isSubmitting.value = true;

  try {
    const response = await login({
      email: email.value,
      password: password.value,
      remember: remember.value,
    });

    emit("authenticated", response.user);
  } catch (error) {
    errorMessage.value = getErrorMessage(error);
  } finally {
    isSubmitting.value = false;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not sign in. Please try again.";
}
</script>

<template>
  <AuthLayout
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="emit('back-to-chat')"
    @toggle-theme="emit('toggle-theme')"
  >
    <div class="auth-header">
      <p class="auth-kicker">Sign in</p>
      <h2>Welcome back</h2>
      <p>Sign in to continue your QA workspace.</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitLogin">
      <TextField
        id="login-email"
        v-model="email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="login-password"
        v-model="password"
        label="Password"
        type="password"
        autocomplete="current-password"
        placeholder="Enter your password"
        :disabled="isSubmitting"
        required
      />

      <div class="d-flex align-items-center justify-content-between gap-3">
        <CheckboxField id="login-remember" v-model="remember" label="Remember me" :disabled="isSubmitting" />

        <button class="btn btn-link" type="button" @click="emit('navigate', 'forgot-password')">
          Forgot password?
        </button>
      </div>

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? "Signing in..." : "Sign in" }}
      </button>

      <div class="auth-divider d-flex align-items-center"><span>or</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button" disabled title="Google sign-in is not wired yet.">
        <span class="auth-google-mark d-flex align-items-center justify-content-center" aria-hidden="true">G</span>
        <span>Sign in with Google</span>
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>New here?</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'register')">Create account</button>
    </div>
  </AuthLayout>
</template>
