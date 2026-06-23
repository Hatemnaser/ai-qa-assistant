<script setup lang="ts">
import { ref } from "vue";

import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import { useI18n } from "../../../i18n/useI18n";
import { login } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";
import type { AuthUser } from "../types";
import { useAuthRequest } from "../useAuthRequest";

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
const password = ref("");
const remember = ref(false);
const { t } = useI18n();
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.login"));

async function submitLogin() {
  await submit(async () => {
    const response = await login({
      email: email.value,
      password: password.value,
      remember: remember.value,
    });

    emit("authenticated", response.user);
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
      <p class="auth-kicker">{{ t("auth.login.kicker") }}</p>
      <h2>{{ t("auth.login.title") }}</h2>
      <p>{{ t("auth.login.subtitle") }}</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitLogin">
      <TextField
        id="login-email"
        v-model="email"
        :label="t('auth.login.email')"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="login-password"
        v-model="password"
        :label="t('auth.login.password')"
        type="password"
        autocomplete="current-password"
        :placeholder="t('auth.login.passwordPlaceholder')"
        :disabled="isSubmitting"
        required
      />

      <div class="d-flex align-items-center justify-content-between gap-3">
        <CheckboxField id="login-remember" v-model="remember" :label="t('auth.login.remember')" :disabled="isSubmitting" />

        <button class="btn btn-link" type="button" @click="emit('navigate', 'forgot-password')">
          {{ t("auth.login.forgot") }}
        </button>
      </div>

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? t("auth.login.submitting") : t("auth.login.submit") }}
      </button>

      <div class="auth-divider d-flex align-items-center"><span>{{ t("app.common.or") }}</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button" disabled :title="t('auth.login.googleTitle')">
        <span class="auth-google-mark d-flex align-items-center justify-content-center" aria-hidden="true">G</span>
        <span>{{ t("auth.login.google") }}</span>
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>{{ t("auth.login.newHere") }}</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'register')">{{ t("auth.login.createAccount") }}</button>
    </div>
  </AuthLayout>
</template>
