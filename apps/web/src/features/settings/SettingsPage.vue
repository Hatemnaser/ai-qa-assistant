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

const props = defineProps<{
  currentUser?: AuthUser | null;
  modelOptions: AiModelOption[];
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

const canSave = computed(() =>
  Boolean(props.currentUser && form.defaultModel && !isLoading.value && !isSaving.value)
);
const updatedAtLabel = computed(() => {
  if (!savedSettings.value || savedSettings.value.isDefault) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(savedSettings.value.updatedAt));
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
    errorMessage.value = error instanceof Error ? error.message : "Could not load settings.";
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
    memoryErrorMessage.value = error instanceof Error ? error.message : "Could not load memory.";
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
    successMessage.value = "Settings saved.";
    emit("settings-saved", settings);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not save settings.";
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
    memoryErrorMessage.value = error instanceof Error ? error.message : "Could not save memory.";
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
    memoryErrorMessage.value = error instanceof Error ? error.message : "Could not update memory.";
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
    memoryErrorMessage.value = error instanceof Error ? error.message : "Could not delete memory.";
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
</script>

<template>
  <section class="workspace-page">
    <header class="workspace-header d-flex align-items-start justify-content-between gap-3">
      <div>
        <p class="workspace-eyebrow text-uppercase fw-bold mb-1">Settings</p>
        <h2 class="workspace-title mb-1">Workspace preferences</h2>
        <p class="workspace-subtitle mb-0">Manage language, theme, and default AI model for your account.</p>
      </div>

      <button class="btn btn-outline-secondary" type="button" @click="emit('back-to-chat')">
        Back
      </button>
    </header>

    <section v-if="!currentUser" class="workspace-panel">
      <h3 class="workspace-section-title">Sign in required</h3>
      <p class="workspace-note mb-3">Settings are saved to your account, so they are available across devices.</p>
      <button class="btn btn-primary" type="button" @click="emit('sign-in')">Sign in</button>
    </section>

    <section v-else class="workspace-panel">
      <div v-if="isLoading" class="workspace-note">Loading settings...</div>

      <form v-else class="settings-form" @submit.prevent="saveSettings">
        <div class="settings-grid">
          <label class="settings-field">
            <span class="form-label">Language</span>
            <select v-model="form.language" class="form-control">
              <option value="en">English</option>
              <option value="ar">Arabic</option>
              <option value="de">German</option>
            </select>
          </label>

          <label class="settings-field">
            <span class="form-label">Theme</span>
            <select v-model="form.theme" class="form-control">
              <option value="light">Light</option>
              <option value="dark">Dark</option>
              <option value="system">System</option>
            </select>
          </label>

          <label class="settings-field settings-field--wide">
            <span class="form-label">Default model</span>
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
            <span v-if="updatedAtLabel">Last updated {{ updatedAtLabel }}</span>
            <span v-else>Settings will be saved to your account.</span>
          </p>
          <button class="btn btn-primary" type="submit" :disabled="!canSave">
            {{ isSaving ? "Saving..." : "Save settings" }}
          </button>
        </div>
      </form>
    </section>

    <MemoryPanel
      v-if="currentUser"
      :empty-message="'No account memory yet.'"
      :error-message="memoryErrorMessage"
      :is-loading="isLoadingMemory"
      :is-saving="isSavingMemory"
      :memories="accountMemories"
      title="Account memory"
      @create="addAccountMemory"
      @delete="removeAccountMemory"
      @update="saveAccountMemory"
    />
  </section>
</template>
