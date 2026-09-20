<script setup lang="ts">
import { computed, defineAsyncComponent, ref, useId } from "vue";

import { useI18n } from "../../../i18n/useI18n";
import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import { useProjectIntegrations } from "../composables/useProjectIntegrations";

const QaConnectionModal = defineAsyncComponent(() => import("../../qa/components/QaConnectionModal.vue"));
const props = defineProps<{ projectId: string; projectName: string }>();
const emit = defineEmits<{ close: [] }>();
const { t } = useI18n();
const titleId = useId();
const managing = ref<"AGENT" | "RUNNER" | null>(null);
const {
  agentConnections, runnerConnections, profiles, onlineProfiles, connectionError, profileError, isLoading, refresh,
} = useProjectIntegrations(computed(() => props.projectId));
const { dialogRef, onDialogKeydown } = useDialogAccessibility({ isOpen: () => true, onClose: () => emit("close") });

function closeManagement() {
  managing.value = null;
  void refresh();
}
</script>

<template>
  <Teleport to="body">
    <div v-show="!managing" ref="dialogRef" class="workspace-surface modal fade show" :class="{ 'd-block': !managing }" :inert="Boolean(managing)" :aria-hidden="managing ? 'true' : undefined" tabindex="-1" role="dialog" aria-modal="true" :aria-labelledby="titleId" @keydown="onDialogKeydown" @click.self="emit('close')">
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable project-integrations-dialog">
        <section class="modal-content app-modal">
          <header class="modal-header">
            <div><span class="qa-modal-eyebrow">{{ projectName }}</span><h2 :id="titleId" class="modal-title">{{ t('projects.integrations.title') }}</h2></div>
            <button class="btn-close" type="button" :aria-label="t('projects.context.close')" @click="emit('close')"></button>
          </header>
          <div class="modal-body project-integrations">
            <div class="project-integrations__heading">
              <p class="workspace-note mb-0">{{ t('projects.integrations.note') }}</p>
              <button class="btn btn-sm btn-outline-secondary" type="button" :disabled="isLoading" @click="refresh">{{ t('projects.integrations.refresh') }}</button>
            </div>
            <p v-if="isLoading" class="workspace-note" role="status">{{ t('projects.integrations.loading') }}</p>
            <section class="workspace-panel project-integrations__group">
              <h3>{{ t('projects.integrations.tools') }}</h3>
              <p class="workspace-note">{{ t('projects.integrations.toolsNote') }}</p>
              <p v-if="connectionError" class="workspace-feedback workspace-feedback--error" role="alert">{{ connectionError }}</p>
              <template v-else>
                <strong>{{ t('projects.integrations.savedCount', { count: agentConnections.length }) }}</strong>
                <ul v-if="agentConnections.length" class="project-integrations__list"><li v-for="connection in agentConnections" :key="connection.id">{{ connection.name }}</li></ul>
              </template>
              <button class="btn btn-outline-primary" type="button" @click="managing = 'AGENT'">{{ t('projects.integrations.manageTools') }}</button>
            </section>
            <section class="workspace-panel project-integrations__group">
              <h3>{{ t('projects.integrations.runners') }}</h3>
              <p class="workspace-note">{{ t('projects.integrations.runnersNote') }}</p>
              <strong v-if="!connectionError">{{ t('projects.integrations.savedCount', { count: runnerConnections.length }) }}</strong>
              <p v-if="profileError" class="workspace-feedback workspace-feedback--error" role="alert">{{ profileError }}</p>
              <template v-else>
                <strong>{{ t('projects.integrations.onlineCount', { count: onlineProfiles.length }) }}</strong>
                <p v-if="!isLoading && !profiles.length" class="workspace-note">{{ t('projects.integrations.noProfiles') }}</p>
                <ul v-else class="project-integrations__list">
                  <li v-for="profile in profiles" :key="profile.id"><span>{{ profile.label }} · {{ profile.runnerName }}</span><span class="qa-status" :class="profile.status === 'ONLINE' ? 'qa-status--success' : 'qa-status--neutral'">{{ t(`projects.integrations.status.${profile.status}`) }}</span></li>
                </ul>
              </template>
              <button class="btn btn-outline-primary" type="button" @click="managing = 'RUNNER'">{{ t('projects.integrations.manageRunners') }}</button>
            </section>
          </div>
          <footer class="modal-footer"><button class="btn btn-outline-secondary" type="button" @click="emit('close')">{{ t('projects.context.close') }}</button></footer>
        </section>
      </div>
    </div>
    <div v-show="!managing" class="modal-backdrop fade show"></div>
  </Teleport>
  <QaConnectionModal v-if="managing" :key="`${projectId}:${managing}`" :project-id="projectId" :project-name="projectName" :initial-preset="managing" appearance="workspace" @close="closeManagement" />
</template>
