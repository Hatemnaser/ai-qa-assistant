<script setup lang="ts">
import { computed, ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import type { Memory } from "../types";

const props = defineProps<{
  emptyMessage: string;
  errorMessage?: string;
  isLoading?: boolean;
  isSaving?: boolean;
  memories: Memory[];
  title: string;
}>();

const emit = defineEmits<{
  create: [content: string];
  delete: [memoryId: string];
  update: [memoryId: string, content: string];
}>();

const draftContent = ref("");
const editContent = ref("");
const editingMemoryId = ref<string | null>(null);
const { formatDate, t } = useI18n();

const canCreate = computed(() => Boolean(draftContent.value.trim() && !props.isSaving));
const canUpdate = computed(() => Boolean(editingMemoryId.value && editContent.value.trim() && !props.isSaving));

function requestCreate() {
  const content = draftContent.value.trim();

  if (!content || props.isSaving) return;

  emit("create", content);
  draftContent.value = "";
}

function startEdit(memory: Memory) {
  editingMemoryId.value = memory.id;
  editContent.value = memory.content;
}

function cancelEdit() {
  editingMemoryId.value = null;
  editContent.value = "";
}

function requestUpdate(memoryId: string) {
  const content = editContent.value.trim();

  if (!content || props.isSaving) return;

  emit("update", memoryId, content);
  cancelEdit();
}

function formatMemoryDate(value: string) {
  return formatDate(value, {
    dateStyle: "medium",
  });
}
</script>

<template>
  <section class="workspace-panel memory-panel">
    <header class="memory-panel__header">
      <h2 class="workspace-section-title mb-0">{{ title }}</h2>
    </header>

    <form class="memory-panel__form" @submit.prevent="requestCreate">
      <textarea v-model="draftContent" class="form-control" maxlength="4000" :placeholder="t('memory.placeholder')"></textarea>
      <button class="btn btn-primary" type="submit" :disabled="!canCreate">
        {{ isSaving ? t("memory.saving") : t("memory.add") }}
      </button>
    </form>

    <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
      {{ errorMessage }}
    </p>

    <div v-if="isLoading" class="workspace-empty">{{ t("memory.loading") }}</div>
    <div v-else-if="memories.length === 0" class="workspace-empty">{{ emptyMessage }}</div>

    <div v-else class="memory-list">
      <article v-for="memory in memories" :key="memory.id" class="memory-item">
        <template v-if="editingMemoryId === memory.id">
          <textarea v-model="editContent" class="form-control" maxlength="4000"></textarea>
          <div class="memory-item__actions">
            <button class="btn btn-outline-secondary btn-sm" type="button" :disabled="isSaving" @click="cancelEdit">
              {{ t("app.actions.cancel") }}
            </button>
            <button class="btn btn-primary btn-sm" type="button" :disabled="!canUpdate" @click="requestUpdate(memory.id)">
              {{ t("app.actions.save") }}
            </button>
          </div>
        </template>

        <template v-else>
          <p>{{ memory.content }}</p>
          <div class="memory-item__meta">
            <small>{{ t("memory.updated", { date: formatMemoryDate(memory.updatedAt) }) }}</small>
            <div class="memory-item__actions">
              <button class="btn btn-link btn-sm" type="button" :disabled="isSaving" @click="startEdit(memory)">
                {{ t("memory.edit") }}
              </button>
              <button class="btn btn-link btn-sm memory-item__delete" type="button" :disabled="isSaving" @click="emit('delete', memory.id)">
                {{ t("app.actions.delete") }}
              </button>
            </div>
          </div>
        </template>
      </article>
    </div>
  </section>
</template>
