<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import TextField from "../../../ui/TextField.vue";
import { BackendApiError } from "../../../api/backendErrors";
import { useI18n } from "../../../i18n/useI18n";
import { getRegistrationConfig, register } from "../authApi";
import AuthLayout from "../components/AuthLayout.vue";
import type { RegistrationConfig, RegistrationLegalUrls } from "../types";
import { useAuthRequest } from "../useAuthRequest";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../passwordPolicy";

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
const inviteCode = ref("");
const successMessage = ref("");
const termsAccepted = ref(false);
const registrationConfig = ref<RegistrationConfig | null>(null);
const registrationConfigError = ref("");
const isRegistrationConfigLoading = ref(true);
const { locale, t } = useI18n();
const { errorMessage, isSubmitting, submit } = useAuthRequest(t("errors.auth.register"));

const fallbackLegalUrls: Record<"ar" | "de" | "en", RegistrationLegalUrls> = {
  ar: {
    privacy: "https://eluthira.com/privacy",
    terms: "https://eluthira.com/terms",
  },
  de: {
    privacy: "https://eluthira.com/de/privacy",
    terms: "https://eluthira.com/de/terms",
  },
  en: {
    privacy: "https://eluthira.com/privacy",
    terms: "https://eluthira.com/terms",
  },
};

const legalUrls = computed(() => {
  const supportedLocale = locale.value === "de" || locale.value === "ar" ? locale.value : "en";
  return registrationConfig.value?.legalUrls[supportedLocale] || fallbackLegalUrls[supportedLocale];
});
const isInviteRequired = computed(() => registrationConfig.value?.mode === "invite");
const isRegistrationDisabled = computed(() => registrationConfig.value?.mode === "disabled");
const canSubmit = computed(
  () =>
    !isRegistrationConfigLoading.value &&
    !registrationConfigError.value &&
    !isRegistrationDisabled.value &&
    Boolean(registrationConfig.value?.termsVersion)
);

onMounted(loadRegistrationConfig);

async function loadRegistrationConfig() {
  isRegistrationConfigLoading.value = true;
  registrationConfigError.value = "";

  try {
    registrationConfig.value = await getRegistrationConfig();
  } catch {
    registrationConfig.value = null;
    registrationConfigError.value = t("auth.register.configUnavailable");
  } finally {
    isRegistrationConfigLoading.value = false;
  }
}

async function submitRegistration() {
  successMessage.value = "";

  const termsVersion = registrationConfig.value?.termsVersion;
  if (!canSubmit.value || !termsVersion) {
    errorMessage.value = isRegistrationDisabled.value
      ? t("auth.register.closed")
      : t("auth.register.configUnavailable");
    return;
  }

  await submit(async () => {
    let response: Awaited<ReturnType<typeof register>>;

    try {
      response = await register({
        email: email.value,
        inviteCode: isInviteRequired.value ? inviteCode.value : undefined,
        locale: locale.value,
        name: name.value,
        password: password.value,
        termsAccepted: termsAccepted.value,
        termsVersion,
      });
    } catch (error) {
      if (error instanceof BackendApiError && error.code === "TERMS_VERSION_OUTDATED") {
        termsAccepted.value = false;
        await loadRegistrationConfig();
      }

      throw error;
    }

    successMessage.value = response.message;
    password.value = "";
    inviteCode.value = "";
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
      <p v-if="isRegistrationConfigLoading" class="auth-feedback" role="status">
        {{ t("auth.register.loading") }}
      </p>
      <p v-else-if="registrationConfigError" class="auth-feedback auth-feedback-error" role="alert">
        {{ registrationConfigError }}
      </p>
      <p v-else-if="isRegistrationDisabled" class="auth-feedback" role="status">
        {{ t("auth.register.closed") }}
      </p>

      <TextField
        id="register-name"
        v-model="name"
        :label="t('auth.register.name')"
        autocomplete="name"
        placeholder="Hatem Naser"
        :disabled="isSubmitting || !canSubmit"
        required
      />
      <TextField
        id="register-email"
        v-model="email"
        :label="t('auth.register.email')"
        type="email"
        autocomplete="email"
        placeholder="you@example.com"
        :disabled="isSubmitting || !canSubmit"
        required
      />
      <TextField
        id="register-password"
        v-model="password"
        :label="t('auth.register.password')"
        type="password"
        autocomplete="new-password"
        :placeholder="t('auth.register.passwordPlaceholder')"
        :hint="t('auth.register.passwordHint')"
        :disabled="isSubmitting || !canSubmit"
        :max-length="PASSWORD_MAX_LENGTH"
        :min-length="PASSWORD_MIN_LENGTH"
        required
      />

      <TextField
        v-if="isInviteRequired"
        id="register-invite-code"
        v-model="inviteCode"
        :label="t('auth.register.inviteCode')"
        autocomplete="off"
        :hint="t('auth.register.inviteHint')"
        :disabled="isSubmitting || !canSubmit"
        required
      />

      <div class="form-check d-flex align-items-start gap-2">
        <input
          id="register-terms"
          v-model="termsAccepted"
          class="form-check-input"
          type="checkbox"
          :disabled="isSubmitting || !canSubmit"
          aria-labelledby="register-terms-copy"
          required
        />
        <span id="register-terms-copy" class="form-check-label">
          <label for="register-terms">{{ t("auth.register.termsPrefix") }}</label>
          <a :href="legalUrls.terms" target="_blank" rel="noopener noreferrer">{{ t("auth.register.termsLink") }}</a>
          {{ t("auth.register.termsMiddle") }}
          <a :href="legalUrls.privacy" target="_blank" rel="noopener noreferrer">{{ t("auth.register.privacyLink") }}</a>.
        </span>
      </div>
      <p v-if="registrationConfig?.termsVersion" class="form-text mb-0">
        {{ t("auth.register.termsVersion", { version: registrationConfig.termsVersion }) }}
      </p>

      <p v-if="errorMessage" class="auth-feedback auth-feedback-error" role="alert">{{ errorMessage }}</p>
      <p v-if="successMessage" class="auth-feedback auth-feedback-success" role="status">{{ successMessage }}</p>

      <button class="btn btn-primary btn-control w-100" type="submit" :disabled="isSubmitting || !canSubmit">
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
