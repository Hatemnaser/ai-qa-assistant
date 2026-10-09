<script setup lang="ts">
import { computed, ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { useI18n } from "../../../i18n/useI18n";
import type { ChatUsageSummary, ExportFormat } from "../types";
import type { UsageSummary } from "../../usage/types";

const props = defineProps<{
  currentUser?: AuthUser | null;
  themeToggleLabel: string;
  usageSummary?: (ChatUsageSummary & Partial<Pick<UsageSummary, "windowHours" | "since">>) | null;
  usageLoading?: boolean;
  usageError?: string;
}>();

const emit = defineEmits<{
  "export-active-chat": [format: ExportFormat];
  "import-chat": [event: Event];
  logout: [];
  "open-usage": [];
  "reload-usage": [];
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
  <div class="sidebar-account dropup workspace-navigation__account">
    <button
      class="sidebar-account-btn"
      type="button"
      data-bs-toggle="dropdown"
      aria-expanded="false"
      :aria-label="t('sidebar.account.menu')"
      :title="displayName"
    >
      <span class="sidebar-account-avatar" aria-hidden="true">{{ initials }}</span>
      <span class="workspace-navigation__rail-label">{{ t('sessionTools.navigation.account') }}</span>
    </button>

    <ul class="dropdown-menu sidebar-account-menu workspace-surface">
      <li class="workspace-navigation__account-identity"><strong>{{ displayName }}</strong><small>{{ supportingText }}</small></li>
      <li v-if="currentUser" class="workspace-navigation__usage">
        <strong>{{ t('sessionTools.usage.summary') }}</strong>
        <p v-if="usageLoading" role="status">{{ t('usage.loading') }}</p>
        <template v-if="usageSummary">
          <p>{{ t('usage.remaining', { remaining: usageSummary.remaining, unit: usageSummary.unit || 'credits' }) }}</p>
          <small>{{ t('usage.creditsUsed') }}: {{ usageSummary.used }} / {{ usageSummary.limit }}<template v-if="usageSummary.windowHours"> · {{ t('usage.window', { hours: usageSummary.windowHours }) }}</template></small>
          <progress v-if="usageSummary.limit > 0" :value="usageSummary.used" :max="usageSummary.limit" :aria-label="t('usage.creditsUsed')" />
        </template>
        <p v-if="usageError" role="alert">{{ t('sessionTools.usage.unavailable') }}</p>
        <button v-if="usageError" class="dropdown-item" type="button" :disabled="usageLoading" @click="emit('reload-usage')">{{ t('usage.refresh') }}</button>
        <button class="dropdown-item" type="button" @click="emit('open-usage')">{{ t('usage.title') }}</button>
      </li>
      <li><hr class="dropdown-divider" /></li>
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
      <li v-if="!currentUser">
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
