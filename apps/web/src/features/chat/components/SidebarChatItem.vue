<script setup lang="ts">
import { nextTick, ref, watch } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import type { Chat } from "../types";

const props = defineProps<{
  active: boolean;
  chat: Chat;
  renaming: boolean;
}>();

const emit = defineEmits<{
  "cancel-rename": [];
  "open-menu": [event: MouseEvent, chatId: string];
  rename: [chatId: string, title: string];
  select: [chatId: string];
}>();

const renameDraft = ref(props.chat.title);
const renameInput = ref<HTMLInputElement | null>(null);
const skipNextRenameBlur = ref(false);
const { t } = useI18n();

watch(
  () => props.renaming,
  async (isRenaming) => {
    skipNextRenameBlur.value = false;

    if (!isRenaming) return;

    renameDraft.value = props.chat.title;

    await nextTick();
    renameInput.value?.focus();
    renameInput.value?.select();
  }
);

function submitRename() {
  skipNextRenameBlur.value = true;
  emit("rename", props.chat.id, renameDraft.value);
}

function cancelRename() {
  skipNextRenameBlur.value = true;
  renameDraft.value = props.chat.title;
  emit("cancel-rename");
}

function handleRenameBlur() {
  if (skipNextRenameBlur.value) {
    skipNextRenameBlur.value = false;
    return;
  }

  submitRename();
}
</script>

<template>
  <div class="ui-row ui-row--compact ui-row--interactive" :class="{ active }">
    <button
      v-if="!renaming"
      class="ui-row__button ui-row__button--with-action"
      type="button"
      @click="emit('select', chat.id)"
    >
      <span class="ui-row__copy">
        <span class="ui-row__title">{{ chat.title === "New QA Chat" ? t("chat.title.default") : chat.title }}</span>
      </span>
    </button>

    <input
      v-else
      ref="renameInput"
      v-model="renameDraft"
      class="form-control form-control-sm ui-row__input"
      type="text"
      @blur="handleRenameBlur"
      @keydown.enter.prevent="submitRename"
      @keydown.escape.prevent="cancelRename"
    />

    <div class="ui-row__action">
      <button
        class="ui-icon-btn ui-icon-btn--xs ui-icon-btn--ghost"
        type="button"
        :aria-label="t('sidebar.account.menu')"
        @click.stop="emit('open-menu', $event, chat.id)"
      >
        &hellip;
      </button>
    </div>
  </div>
</template>
