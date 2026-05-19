<script setup lang="ts">
import { ref } from "vue";

import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import { register } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";
import type { AuthUser } from "../types";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  authenticated: [user: AuthUser];
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

const email = ref("");
const errorMessage = ref("");
const isSubmitting = ref(false);
const name = ref("");
const password = ref("");
const termsAccepted = ref(false);

async function submitRegistration() {
  if (isSubmitting.value) {
    return;
  }

  errorMessage.value = "";
  isSubmitting.value = true;

  try {
    const response = await register({
      email: email.value,
      locale: "en",
      name: name.value,
      password: password.value,
    });

    emit("authenticated", response.user);
  } catch (error) {
    errorMessage.value = getErrorMessage(error);
  } finally {
    isSubmitting.value = false;
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Could not create the account. Please try again.";
}
</script>

<template>
  <AuthLayout
    :theme-toggle-label="themeToggleLabel"
    @back-to-chat="emit('back-to-chat')"
    @toggle-theme="emit('toggle-theme')"
  >
    <div class="auth-header">
      <p class="auth-kicker">New workspace</p>
      <h2>Create your account</h2>
      <p>Start saving chats, projects, and QA memory in one workspace.</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitRegistration">
      <TextField
        id="register-name"
        v-model="name"
        label="Name"
        autocomplete="name"
        placeholder="Hatem Naser"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="register-email"
        v-model="email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="register-password"
        v-model="password"
        label="Password"
        type="password"
        autocomplete="new-password"
        placeholder="Create a password"
        :disabled="isSubmitting"
        required
      />

      <CheckboxField
        id="register-terms"
        v-model="termsAccepted"
        label="I agree to the terms"
        :disabled="isSubmitting"
        required
      />

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? "Creating account..." : "Create account" }}
      </button>

      <div class="auth-divider d-flex align-items-center"><span>or</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button" disabled title="Google sign-up is not wired yet.">
        <span class="auth-google-mark d-flex align-items-center justify-content-center" aria-hidden="true">G</span>
        <span>Sign up with Google</span>
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>Already have an account?</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">Sign in</button>
    </div>
  </AuthLayout>
</template>
