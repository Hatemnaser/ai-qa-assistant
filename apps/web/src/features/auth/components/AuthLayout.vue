<script setup lang="ts">
import { useI18n } from "../../../i18n/useI18n";

defineProps<{
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  "toggle-theme": [];
}>();

const { t } = useI18n();
</script>

<template>
  <main class="auth-page">
    <section class="auth-brand-panel d-flex flex-column justify-content-between">
      <div>
        <button class="btn btn-link mb-5" type="button" @click="emit('back-to-chat')">
          {{ t("auth.layout.backToChat") }}
        </button>

        <div class="auth-brand">
          <div class="auth-brand-mark d-flex align-items-center justify-content-center" aria-hidden="true">QA</div>
          <p class="auth-kicker">{{ t("app.brand.name") }}</p>
          <h1>{{ t("auth.layout.heroTitle") }}</h1>
          <p>
            {{ t("auth.layout.heroBody") }}
          </p>
        </div>
      </div>

      <button class="btn btn-link align-self-start" type="button" @click="emit('toggle-theme')">
        {{ t("theme.mode", { theme: themeToggleLabel }) }}
      </button>
    </section>

    <section class="auth-content d-flex align-items-center justify-content-center" :aria-label="t('auth.layout.regionLabel')">
      <div class="auth-card">
        <slot />
      </div>
    </section>
  </main>
</template>
