<script setup lang="ts">
import { ref } from "vue";

import CheckboxField from "../../../ui/CheckboxField.vue";
import TextField from "../../../ui/TextField.vue";
import { useI18n } from "../../../i18n/useI18n";
import { register } from "../authApi";
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
const name = ref("");
const password = ref("");
const successMessage = ref("");
const termsAccepted = ref(false);
const { locale, t } = useI18n();
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.register"));

async function submitRegistration() {
  successMessage.value = "";

  await submit(async () => {
    const response = await register({
      email: email.value,
      locale: locale.value,
      name: name.value,
      password: password.value,
    });

    successMessage.value = response.message;
    password.value = "";
    termsAccepted.value = false;
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
      <p class="auth-kicker">{{ t("auth.register.kicker") }}</p>
      <h2>{{ t("auth.register.title") }}</h2>
      <p>{{ t("auth.register.subtitle") }}</p>
    </div>

    <form class="vstack gap-3" @submit.prevent="submitRegistration">
      <TextField
        id="register-name"
        v-model="name"
        :label="t('auth.register.name')"
        autocomplete="name"
        placeholder="Hatem Naser"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="register-email"
        v-model="email"
        :label="t('auth.register.email')"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting"
        required
      />
      <TextField
        id="register-password"
        v-model="password"
        :label="t('auth.register.password')"
        type="password"
        autocomplete="new-password"
        :placeholder="t('auth.register.passwordPlaceholder')"
        :disabled="isSubmitting"
        required
      />

      <CheckboxField
        id="register-terms"
        v-model="termsAccepted"
        :label="t('auth.register.terms')"
        :disabled="isSubmitting"
        required
      />

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting">
        {{ isSubmitting ? t("auth.register.submitting") : t("auth.register.submit") }}
      </button>

      <div class="auth-divider d-flex align-items-center"><span>{{ t("app.common.or") }}</span></div>

      <button class="btn btn-outline-secondary btn-control w-100" type="button" disabled :title="t('auth.register.googleTitle')">
        <span class="auth-google-mark d-flex align-items-center justify-content-center" aria-hidden="true">G</span>
        <span>{{ t("auth.register.google") }}</span>
      </button>
    </form>

    <div class="auth-switch d-flex justify-content-center gap-2 flex-column flex-sm-row">
      <span>{{ t("auth.register.haveAccount") }}</span>
      <button class="btn btn-link" type="button" @click="emit('navigate', 'login')">{{ t("app.actions.signIn") }}</button>
    </div>
  </AuthLayout>
</template>
