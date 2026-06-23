<script setup lang="ts">
import { computed, ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { useI18n } from "../../../i18n/useI18n";
import type { ExportFormat } from "../types";

const props = defineProps<{
  currentUser?: AuthUser | null;
  themeToggleLabel: string;
}>();

const emit = defineEmits<{
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "open-usage": [];
  "open-settings": [];
  "sign-in": [];
  "toggle-theme": [];
}>();

const importChatInput = ref<HTMLInputElement | null>(null);
const { t } = useI18n();
const displayName = computed(() => props.currentUser?.name || props.currentUser?.email || t("app.common.guest"));
const supportingText = computed(() =>
  props.currentUser ? props.currentUser.email : t("sidebar.account.signInHelp")
);
const initials = computed(() => {
  const source = displayName.value.trim();

  if (!source) return "?";

  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
});

function openImportChatPicker() {
  importChatInput.value?.click();
}
</script>

<template>
  <div class="sidebar-account dropup">
    <button
      class="sidebar-account-btn"
      type="button"
      data-bs-toggle="dropdown"
      aria-expanded="false"
      :aria-label="t('sidebar.account.menu')"
    >
      <span class="sidebar-account-avatar" aria-hidden="true">{{ initials }}</span>
      <span class="sidebar-account-copy">
        <span class="sidebar-account-name">{{ displayName }}</span>
        <span class="sidebar-account-meta">{{ supportingText }}</span>
      </span>
      <span class="sidebar-account-caret" aria-hidden="true">⌃</span>
    </button>

    <ul class="dropdown-menu sidebar-account-menu">
      <li>
        <button class="dropdown-item" type="button" @click="emit('export-active-chat', 'json')">
          {{ t("sidebar.account.exportChat") }}
        </button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="openImportChatPicker">
          {{ t("sidebar.account.importChat") }}
        </button>
      </li>
      <li>
        <hr class="dropdown-divider" />
      </li>
      <li v-if="currentUser">
        <button class="dropdown-item disabled text-truncate" type="button" disabled>
          {{ currentUser.email }}
        </button>
      </li>
      <li v-if="currentUser">
        <hr class="dropdown-divider" />
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('open-usage')">{{ t("sidebar.account.usage") }}</button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('open-settings')">{{ t("sidebar.account.settings") }}</button>
      </li>
      <li>
        <button class="dropdown-item" type="button" @click="emit('toggle-theme')">
          {{ t("theme.mode", { theme: themeToggleLabel }) }}
        </button>
      </li>
      <li>
        <hr class="dropdown-divider" />
      </li>
      <li v-if="currentUser">
        <button class="dropdown-item" type="button" @click="emit('logout')">{{ t("app.actions.signOut") }}</button>
      </li>
      <li v-else>
        <button class="dropdown-item" type="button" @click="emit('sign-in')">{{ t("app.actions.signIn") }}</button>
      </li>
    </ul>

    <input
      ref="importChatInput"
      type="file"
      accept="application/json,.json"
      hidden
      @change="emit('import-chat', $event)"
    />
  </div>
</template>
