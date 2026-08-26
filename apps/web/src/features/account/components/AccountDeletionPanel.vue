<script setup lang="ts">
import { computed, ref } from "vue";

import type { AuthUser } from "../../auth/types";
import { useI18n } from "../../../i18n/useI18n";
import TextField from "../../../ui/TextField.vue";
import { deleteCurrentAccount } from "../accountApi";

const props = defineProps<{
  currentUser: AuthUser;
}>();

const emit = defineEmits<{
  deleted: [userId: string];
}>();

const currentPassword = ref("");
const errorMessage = ref("");
const isConfirming = ref(false);
const isDeleting = ref(false);
const { t } = useI18n();

const canDelete = computed(() => Boolean(currentPassword.value && !isDeleting.value));

function openConfirmation() {
  errorMessage.value = "";
  isConfirming.value = true;
}

function cancelConfirmation() {
  if (isDeleting.value) return;

  currentPassword.value = "";
  errorMessage.value = "";
  isConfirming.value = false;
}

async function deleteAccount() {
  if (!canDelete.value) return;

  isDeleting.value = true;
  errorMessage.value = "";

  try {
    await deleteCurrentAccount(currentPassword.value);
    currentPassword.value = "";
    emit("deleted", props.currentUser.id);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t("settings.deleteAccountError");
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <section class="workspace-panel account-danger-zone" aria-labelledby="account-danger-zone-title">
    <div>
      <p class="workspace-eyebrow text-uppercase fw-bold mb-1">{{ t("settings.dangerZone") }}</p>
      <h3 id="account-danger-zone-title" class="workspace-section-title">
        {{ t("settings.deleteAccountTitle") }}
      </h3>
      <p class="workspace-note mb-0">{{ t("settings.deleteAccountDescription") }}</p>
    </div>

    <button
      v-if="!isConfirming"
      class="btn btn-danger account-danger-zone__action"
      type="button"
      @click="openConfirmation"
    >
      {{ t("settings.deleteAccount") }}
    </button>

    <form v-else class="account-danger-zone__confirmation" @submit.prevent="deleteAccount">
      <p class="account-danger-zone__warning mb-0">{{ t("settings.deleteAccountWarning") }}</p>

      <TextField
        id="delete-account-current-password"
        v-model="currentPassword"
        autocomplete="current-password"
        :disabled="isDeleting"
        :label="t('settings.currentPassword')"
        :max-length="128"
        required
        type="password"
      />

      <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">
        {{ errorMessage }}
      </p>

      <div class="account-danger-zone__actions">
        <button class="btn btn-outline-secondary" type="button" :disabled="isDeleting" @click="cancelConfirmation">
          {{ t("app.actions.cancel") }}
        </button>
        <button class="btn btn-danger" type="submit" :disabled="!canDelete">
          {{ isDeleting ? t("settings.deletingAccount") : t("settings.confirmDeleteAccount") }}
        </button>
      </div>
    </form>
  </section>
</template>
