<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "../../../i18n/useI18n";
import type { Project } from "../../projects/types";
import type { Chat } from "../types";

const props = defineProps<{ chats: Chat[]; projects: Project[] }>();
const emit = defineEmits<{ "select-chat": [chatId: string] }>();
const { t } = useI18n();
const recent = computed(() => [...props.chats].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6));
function projectName(chat: Chat) {
  return props.projects.find((project) => project.id === chat.projectId)?.name || t("chat.home.noProject");
}
</script>

<template>
  <section class="chat-home chat-area">
    <header class="chat-home__heading">
      <h1>{{ t("chat.home.title") }}</h1>
      <p>{{ t("chat.home.description") }}</p>
    </header>
    <section v-if="recent.length" :aria-label="t('chat.home.recent')">
      <h2 class="workspace-section-title">{{ t("chat.home.recent") }}</h2>
      <button v-for="chat in recent" :key="chat.id" class="ui-row ui-row--interactive chat-home__recent" type="button" @click="emit('select-chat', chat.id)">
        <span class="ui-row__title">{{ chat.title === 'New QA Chat' ? t('chat.title.default') : chat.title }}</span>
        <small>{{ projectName(chat) }}</small>
      </button>
    </section>
    <p v-else class="workspace-note">{{ t("chat.home.empty") }}</p>
  </section>
</template>
