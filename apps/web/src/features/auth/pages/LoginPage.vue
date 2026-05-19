<script setup lang="ts">
import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import AuthLayout from "../components/AuthLayout.vue";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  navigate: [view: "register" | "forgot-password"];
  "toggle-theme": [];
}>();

function submitLogin() {
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
      <p class="auth-kicker">Sign in</p>
      <h2>Welcome back</h2>
      <p>Sign in to continue your QA workspace.</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitLogin">
      <TextField id="login-email" label="Email" type="email" autocomplete="email" placeholder="you@example.com" required />
      <TextField
        id="login-password"
        label="Password"
        type="password"
        autocomplete="current-password"
        placeholder="Enter your password"
        required
      />

      <div class="d-flex align-items-center justify-content-between gap-3">
        <CheckboxField id="login-remember" label="Remember me" />

        <button class="btn btn-link" type="button" @click="emit('navigate', 'forgot-password')">
          Forgot password?
        </button>
      </div>

      <button class="btn btn-primary btn-control w-100" type="submit">Sign in</button>

      <div class="auth-divider d-flex align-items-center"><span>or</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button">
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
