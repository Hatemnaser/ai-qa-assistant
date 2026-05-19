<script setup lang="ts">
import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import AuthLayout from "../components/AuthLayout.vue";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "login"];
  "toggle-theme": [];
}>();

function submitRegistration() {
  // Backend auth wiring belongs to the API auth module.
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
      <TextField id="register-name" label="Name" autocomplete="name" placeholder="Hatem Naser" required />
      <TextField
        id="register-email"
        label="Email"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        required
      />
      <TextField
        id="register-password"
        label="Password"
        type="password"
        autocomplete="new-password"
        placeholder="Create a password"
        required
      />

      <CheckboxField id="register-terms" label="I agree to the terms" required />

      <button class="btn btn-primary btn-control w-100" type="submit">Create account</button>

      <div class="auth-divider d-flex align-items-center"><span>or</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button">
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
