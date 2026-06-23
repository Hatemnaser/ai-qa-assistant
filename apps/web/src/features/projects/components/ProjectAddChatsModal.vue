<script setup lang="ts">
import { computed, ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import Icon from "../../../ui/Icon.vue";
import type { Chat } from "../../chat/types";
import { formatRelativeDate } from "../projectDate";
import type { Project } from "../types";

const props = defineProps<{
  chats: Chat[];
  isOpen: boolean;
  project: Project | null;
}>();

const emit = defineEmits<{
  add: [chatIds: string[]];
  cancel: [];
}>();

const searchQuery = ref("");
const selectedChatIds = ref<Set<string>>(new Set());
const { t } = useI18n();

const availableChats = computed(() => {
  if (!props.project) return [];

  return props.chats
    .filter((chat) => chat.projectId !== props.project?.id)
    .sort((first, second) => new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime());
});
const filteredChats = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();

  if (!query) return availableChats.value;

  return availableChats.value.filter((chat) => chat.title.toLowerCase().includes(query));
});
const selectedCount = computed(() => selectedChatIds.value.size);
const canAdd = computed(() => selectedCount.value > 0);

watch(
  () => props.isOpen,
  (isOpen) => {
    if (!isOpen) return;

    searchQuery.value = "";
    selectedChatIds.value = new Set();
  }
);

function isSelected(chatId: string) {
  return selectedChatIds.value.has(chatId);
}

function toggleChat(chatId: string) {
  const nextSelectedChatIds = new Set(selectedChatIds.value);

  if (nextSelectedChatIds.has(chatId)) {
    nextSelectedChatIds.delete(chatId);
  } else {
    nextSelectedChatIds.add(chatId);
  }

  selectedChatIds.value = nextSelectedChatIds;
}

function selectVisibleChats() {
  selectedChatIds.value = new Set([...selectedChatIds.value, ...filteredChats.value.map((chat) => chat.id)]);
}

function clearSelection() {
  selectedChatIds.value = new Set();
}

function addSelectedChats() {
  if (!canAdd.value) return;

  emit("add", [...selectedChatIds.value]);
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && project"
      class="modal fade show d-block"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="project-add-chats-title"
      @click.self="emit('cancel')"
    >
      <div class="modal-dialog modal-dialog-centered project-add-chats-dialog">
        <form class="modal-content app-modal project-add-chats-modal" @submit.prevent="addSelectedChats">
          <div class="modal-header">
            <h2 id="project-add-chats-title" class="modal-title">{{ t("projects.addChats.title") }}</h2>
            <button class="btn-close" type="button" :aria-label="t('app.actions.close')" @click="emit('cancel')"></button>
          </div>

          <div class="modal-body project-add-chats-modal__body">
            <div class="projects-search project-add-chats-modal__search">
              <Icon name="search" />
              <input
                v-model="searchQuery"
                type="search"
                :placeholder="t('projects.addChats.searchPlaceholder')"
                :aria-label="t('projects.addChats.searchAria')"
              />
            </div>

            <div v-if="availableChats.length > 0" class="project-add-chats-modal__tools">
              <span>{{ t("projects.addChats.selectedCount", { count: selectedCount }) }}</span>
              <div>
                <button
                  class="btn btn-link btn-sm"
                  type="button"
                  :disabled="filteredChats.length === 0"
                  @click="selectVisibleChats"
                >
                  {{ t("projects.addChats.selectVisible") }}
                </button>
                <button class="btn btn-link btn-sm" type="button" :disabled="selectedCount === 0" @click="clearSelection">
                  {{ t("projects.addChats.clear") }}
                </button>
              </div>
            </div>

            <div v-if="availableChats.length === 0" class="project-add-chats-modal__empty">
              {{ t("projects.addChats.noAvailable") }}
            </div>
            <div v-else-if="filteredChats.length === 0" class="project-add-chats-modal__empty">
              {{ t("projects.addChats.noMatches") }}
            </div>
            <div v-else class="project-add-chats-list">
              <label v-for="chat in filteredChats" :key="chat.id" class="project-add-chat-item">
                <input
                  class="form-check-input"
                  type="checkbox"
                  :checked="isSelected(chat.id)"
                  @change="toggleChat(chat.id)"
                />
                <span class="project-add-chat-item__copy">
                  <strong>{{ chat.title }}</strong>
                  <small>{{ t("projects.chatList.lastMessage", { date: formatRelativeDate(chat.updatedAt) }) }}</small>
                </span>
              </label>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" @click="emit('cancel')">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-primary" type="submit" :disabled="!canAdd">
              {{ t("projects.addChats.addSelected") }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div v-if="isOpen && project" class="modal-backdrop fade show"></div>
  </Teleport>
</template>
