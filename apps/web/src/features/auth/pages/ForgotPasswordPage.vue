<script setup lang="ts">
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

function submitPasswordReset() {
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
      <p class="auth-kicker">Account help</p>
      <h2>Reset your password</h2>
      <p>Enter your email and we will prepare the reset flow.</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitPasswordReset">
      <TextField id="forgot-email" label="Email" type="email" autocomplete="email" placeholder="you@example.com" required />

      <button class="btn btn-primary btn-control w-100" type="submit">Send reset link</button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>Remembered it?</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">Back to sign in</button>
    </div>
  </AuthLayout>
</template>
