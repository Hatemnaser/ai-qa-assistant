<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";

import MemoryPanel from "../memory/components/MemoryPanel.vue";
import {
  createAccountMemory,
  deleteAccountMemory,
  fetchAccountMemories,
  updateAccountMemory,
} from "../memory/memoryApi";
import type { Memory } from "../memory/types";
import { fetchUserSettings, updateUserSettings } from "./settingsApi";
import type { UserSettings, UserThemePreference } from "./types";
import type { AuthUser } from "../auth/types";
import type { AiModelOption } from "../chat/types";
import AccountDataPortabilityPanel from "../data-portability/components/AccountDataPortabilityPanel.vue";
import type { AccountImportCommitResult } from "../data-portability/accountDataPortabilityApi";
import { refreshAccountDataAfterImport } from "../data-portability/accountImportRefresh";
import { useI18n } from "../../i18n/useI18n";
import type { AppLocale } from "../../i18n/locales";

const props = defineProps<{
  currentUser?: AuthUser | null;
  modelOptions: AiModelOption[];
  refreshImportedAccountData?: () => Promise<void>;
}>();

const emit = defineEmits<{
  "back-to-chat": [];
  "settings-saved": [settings: UserSettings];
  "sign-in": [];
}>();

const form = reactive({
  defaultModel: "",
  language: "en",
  theme: "light" as UserThemePreference,
});
const errorMessage = ref("");
const memoryErrorMessage = ref("");
const successMessage = ref("");
const isLoading = ref(false);
const isLoadingMemory = ref(false);
const isSaving = ref(false);
const isSavingMemory = ref(false);
const accountMemories = ref<Memory[]>([]);
const savedSettings = ref<UserSettings | null>(null);
const { formatDate, localeOptions, t } = useI18n();

const canSave = computed(() =>
  Boolean(props.currentUser && form.defaultModel && !isLoading.value && !isSaving.value)
);
const updatedAtLabel = computed(() => {
  if (!savedSettings.value || savedSettings.value.isDefault) return "";

  return formatDate(savedSettings.value.updatedAt, {
    dateStyle: "medium",
    timeStyle: "short",
  });
});
const translatedLocaleOptions = computed(() => {
  return localeOptions.map((option) => ({
    ...option,
    label: getLanguageLabel(option.code),
  }));
});

onMounted(() => {
  void loadSettings();
  void loadAccountMemories();
});

watch(
  () => props.currentUser?.id,
  () => {
    void loadSettings();
    void loadAccountMemories();
  }
);

async function loadSettings() {
  errorMessage.value = "";
  successMessage.value = "";

  if (!props.currentUser) {
    savedSettings.value = null;
    return;
  }

  isLoading.value = true;

  try {
    applySettingsToForm(await fetchUserSettings());
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t("errors.loadSettings");
  } finally {
    isLoading.value = false;
  }
}

async function loadAccountMemories() {
  memoryErrorMessage.value = "";

  if (!props.currentUser) {
    accountMemories.value = [];
    return;
  }

  isLoadingMemory.value = true;

  try {
    accountMemories.value = await fetchAccountMemories();
  } catch (error) {
    memoryErrorMessage.value = error instanceof Error ? error.message : t("errors.loadMemory");
  } finally {
    isLoadingMemory.value = false;
  }
}

async function saveSettings() {
  if (!props.currentUser) {
    emit("sign-in");
    return;
  }

  isSaving.value = true;
  errorMessage.value = "";
  successMessage.value = "";

  try {
    const settings = await updateUserSettings({
      defaultModel: form.defaultModel,
      language: form.language,
      theme: form.theme,
    });

    applySettingsToForm(settings);
    successMessage.value = t("settings.saved");
    emit("settings-saved", settings);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t("errors.saveSettings");
  } finally {
    isSaving.value = false;
  }
}

async function addAccountMemory(content: string) {
  if (!props.currentUser) {
    emit("sign-in");
    return;
  }

  isSavingMemory.value = true;
  memoryErrorMessage.value = "";

  try {
    const memory = await createAccountMemory({ content });

    accountMemories.value = [memory, ...accountMemories.value];
  } catch (error) {
    memoryErrorMessage.value = error instanceof Error ? error.message : t("errors.saveMemory");
  } finally {
    isSavingMemory.value = false;
  }
}

async function saveAccountMemory(memoryId: string, content: string) {
  isSavingMemory.value = true;
  memoryErrorMessage.value = "";

  try {
    const memory = await updateAccountMemory(memoryId, { content });

    accountMemories.value = accountMemories.value.map((item) => (item.id === memory.id ? memory : item));
  } catch (error) {
    memoryErrorMessage.value = error instanceof Error ? error.message : t("errors.updateMemory");
  } finally {
    isSavingMemory.value = false;
  }
}

async function removeAccountMemory(memoryId: string) {
  isSavingMemory.value = true;
  memoryErrorMessage.value = "";

  try {
    await deleteAccountMemory(memoryId);
    accountMemories.value = accountMemories.value.filter((memory) => memory.id !== memoryId);
  } catch (error) {
    memoryErrorMessage.value = error instanceof Error ? error.message : t("errors.deleteMemory");
  } finally {
    isSavingMemory.value = false;
  }
}

function applySettingsToForm(settings: UserSettings) {
  savedSettings.value = settings;
  form.defaultModel = settings.defaultModel;
  form.language = settings.language;
  form.theme = settings.theme;
}

function getLanguageLabel(language: AppLocale) {
  if (language === "ar") return t("language.ar");
  if (language === "de") return t("language.de");

  return t("language.en");
}

async function handleAccountImported(_result: AccountImportCommitResult) {
  await refreshAccountDataAfterImport({
    refreshAccountMemory: loadAccountMemories,
    refreshProjectsAndChats:
      props.refreshImportedAccountData || (async () => {}),
  });
}
</script>

<template>
  <section class="workspace-page">
    <header class="workspace-header d-flex align-items-start justify-content-between gap-3">
      <div>
        <p class="workspace-eyebrow text-uppercase fw-bold mb-1">{{ t("settings.eyebrow") }}</p>
        <h2 class="workspace-title mb-1">{{ t("settings.title") }}</h2>
        <p class="workspace-subtitle mb-0">{{ t("settings.subtitle") }}</p>
      </div>

      <button class="btn btn-outline-secondary" type="button" @click="emit('back-to-chat')">
        {{ t("app.actions.back") }}
      </button>
    </header>

    <section v-if="!currentUser" class="workspace-panel">
      <h3 class="workspace-section-title">{{ t("settings.signInRequired") }}</h3>
      <p class="workspace-note mb-3">{{ t("settings.signInNote") }}</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">{{ t("app.actions.signIn") }}</button>
    </section>

    <section v-else class="workspace-panel">
      <div v-if="isLoading" class="workspace-note">{{ t("settings.loading") }}</div>

      <form v-else class="settings-form" @submit.prevent="saveSettings">
        <div class="settings-grid">
          <label class="settings-field">
            <span class="form-label">{{ t("settings.language") }}</span>
            <select v-model="form.language" class="form-control">
              <option v-for="option in translatedLocaleOptions" :key="option.code" :value="option.code">
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="settings-field">
            <span class="form-label">{{ t("settings.theme") }}</span>
            <select v-model="form.theme" class="form-control">
              <option value="light">{{ t("theme.light") }}</option>
              <option value="dark">{{ t("theme.dark") }}</option>
              <option value="system">{{ t("theme.system") }}</option>
            </select>
          </label>

          <label class="settings-field settings-field--wide">
            <span class="form-label">{{ t("settings.defaultModel") }}</span>
            <select v-model="form.defaultModel" class="form-control">
              <option v-for="model in modelOptions" :key="model.value" :value="model.value">
                {{ model.label }}
              </option>
            </select>
          </label>
        </div>

        <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
          {{ errorMessage }}
        </p>
        <p v-else-if="successMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
          {{ successMessage }}
        </p>

        <div class="d-flex align-items-center justify-content-between gap-3">
          <p class="workspace-note mb-0">
            <span v-if="updatedAtLabel">{{ t("settings.lastUpdated", { date: updatedAtLabel }) }}</span>
            <span v-else>{{ t("settings.willSave") }}</span>
          </p>
          <button class="btn btn-primary" type="submit" :disabled="!canSave">
            {{ isSaving ? t("settings.saving") : t("settings.save") }}
          </button>
        </div>
      </form>
    </section>

    <AccountDataPortabilityPanel
      v-if="currentUser"
      @imported="handleAccountImported"
    />

    <MemoryPanel
      v-if="currentUser"
      :empty-message="t('settings.noAccountMemory')"
      :error-message="memoryErrorMessage"
      :is-loading="isLoadingMemory"
      :is-saving="isSavingMemory"
      :memories="accountMemories"
      :title="t('settings.accountMemory')"
      @create="addAccountMemory"
      @delete="removeAccountMemory"
      @update="saveAccountMemory"
    />
  </section>
</template>
