<script setup lang="ts">
import { defineAsyncComponent, ref } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import type { AccountImportCommitResult } from "../accountDataPortabilityApi";
import { localizeAccountImportWarning } from "../accountImportWarnings";

const AccountImportModal = defineAsyncComponent(
  () => import("./AccountImportModal.vue")
);

const emit = defineEmits<{
  imported: [result: AccountImportCommitResult];
}>();

const { t } = useI18n();
const isExporting = ref(false);
const isImportOpen = ref(false);
const errorMessage = ref("");
const statusMessage = ref("");
const warningMessages = ref<string[]>([]);

async function exportAccountData() {
  isExporting.value = true;
  clearFeedback();

  try {
    const [{ exportAccountDataZip }, { downloadAccountDataExport }] =
      await Promise.all([
        import("../accountDataPortabilityApi"),
        import("../accountDataPortabilityDownload"),
      ]);

    downloadAccountDataExport(await exportAccountDataZip());
    statusMessage.value = t("portability.export.success");
  } catch (error) {
    errorMessage.value =
      error instanceof Error ? error.message : t("portability.errors.export");
  } finally {
    isExporting.value = false;
  }
}

function openImport() {
  clearFeedback();
  isImportOpen.value = true;
}

function closeImport() {
  isImportOpen.value = false;
}

function handleImported(result: AccountImportCommitResult) {
  closeImport();
  statusMessage.value =
    result.importKind === "chat_archive"
      ? t("portability.import.chatSuccess", {
          chats: result.imported.chats,
          messages: result.imported.messages,
        })
      : t("portability.import.success", {
          projects: result.imported.projects,
          documents: result.imported.documents,
          chats: result.imported.chats,
          messages: result.imported.messages,
          memories: result.imported.accountMemories,
          skipped: result.skipped.accountMemories,
        });
  warningMessages.value = result.warnings;
  emit("imported", result);
}

function clearFeedback() {
  errorMessage.value = "";
  statusMessage.value = "";
  warningMessages.value = [];
}
</script>

<template>
  <section class="workspace-panel account-data-portability">
    <div class="account-data-portability__heading">
      <div>
        <p class="workspace-eyebrow text-uppercase fw-bold mb-1">
          {{ t("portability.eyebrow") }}
        </p>
        <h2 class="workspace-section-title mb-1">
          {{ t("portability.title") }}
        </h2>
        <p class="workspace-note mb-0">{{ t("portability.description") }}</p>
      </div>
    </div>

    <div class="account-data-portability__options">
      <article class="account-data-portability__option">
        <div>
          <h3>{{ t("portability.export.title") }}</h3>
          <p>{{ t("portability.export.description") }}</p>
        </div>
        <button
          class="btn btn-outline-primary"
          type="button"
          :disabled="isExporting"
          @click="exportAccountData"
        >
          {{
            isExporting
              ? t("portability.export.exporting")
              : t("portability.export.action")
          }}
        </button>
      </article>

      <article class="account-data-portability__option">
        <div>
          <h3>{{ t("portability.import.title") }}</h3>
          <p>{{ t("portability.import.description") }}</p>
        </div>
        <button class="btn btn-outline-primary" type="button" @click="openImport">
          {{ t("portability.import.action") }}
        </button>
      </article>
    </div>

    <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
      {{ errorMessage }}
    </p>
    <p v-if="statusMessage" class="workspace-feedback workspace-feedback--success mb-0" role="status">
      {{ statusMessage }}
    </p>

    <div v-if="warningMessages.length" class="account-data-portability__warnings" role="status">
      <strong>{{ t("portability.import.warnings") }}</strong>
      <ul>
        <li v-for="warning in warningMessages" :key="warning">
          {{ localizeAccountImportWarning(warning) }}
        </li>
      </ul>
    </div>

    <AccountImportModal
      v-if="isImportOpen"
      :is-open="isImportOpen"
      @cancel="closeImport"
      @imported="handleImported"
    />
  </section>
</template>

<style lang="scss">
.account-data-portability {
  display: grid;
  gap: var(--space-4);
}

.account-data-portability__options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--space-3);
}

.account-data-portability__option {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--space-4);
  padding: var(--space-4);
  background: var(--surface-app);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
}

.account-data-portability__option > div {
  display: grid;
  gap: var(--space-2);
}

.account-data-portability__option h3,
.account-data-portability__option p {
  margin: 0;
}

.account-data-portability__option h3 {
  color: var(--text-main);
  font-size: var(--font-size-md);
}

.account-data-portability__option p {
  color: var(--text-muted);
  font-size: var(--font-size-sm);
  line-height: var(--line-height-readable);
}

.account-data-portability__option .btn {
  flex: 0 0 auto;
}

.account-data-portability__warnings {
  padding: var(--space-3);
  color: var(--status-warning-text);
  background: var(--status-warning-bg);
  border: 1px solid var(--status-warning);
  border-radius: var(--radius-md);
}

.account-data-portability__warnings ul {
  display: grid;
  gap: var(--space-1);
  margin: var(--space-2) 0 0;
  padding-inline-start: var(--space-5);
}

@media (max-width: 767px) {
  .account-data-portability__options {
    grid-template-columns: 1fr;
  }

  .account-data-portability__option {
    align-items: stretch;
    flex-direction: column;
  }

  .account-data-portability__option .btn {
    align-self: flex-start;
  }
}
</style>
