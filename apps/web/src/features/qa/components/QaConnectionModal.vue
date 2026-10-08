<script setup lang="ts">
import { computed, onScopeDispose, ref, watch } from "vue";
import { useI18n } from "../../../i18n/useI18n";

import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
import { RUNNER_START_POWERSHELL } from "../runnerOnboarding";
import {
  createProjectConnection,
  fetchProjectConnections,
  getOddpathApiUrl,
  getOddpathMcpUrl,
  revokeProjectConnection,
} from "../qaApi";
import type { ProjectConnection } from "../types";

const props = defineProps<{
  projectId: string;
  projectName: string;
  initialPreset?: "AGENT" | "RUNNER";
  knownRunnerProfile?: boolean;
  appearance?: "workspace" | "tests";
}>();

const emit = defineEmits<{ close: []; changed: [count: number] }>();
const { t } = useI18n();
let generation = 0;
let disposed = false;
onScopeDispose(() => { disposed = true; generation += 1; revealedToken.value = ""; });
const isCurrent = (id: string, revision: number) => !disposed && props.projectId === id && generation === revision;
const connections = ref<ProjectConnection[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const isSaving = ref(false);
const newConnectionName = ref(props.initialPreset === "RUNNER" ? "Local Playwright Runner" : "Codex");
const connectionPreset = ref<"AGENT" | "RUNNER">(props.initialPreset || "AGENT");
const revealedToken = ref("");
const copiedField = ref<"config" | "token" | "url" | "command" | null>(null);
const mcpUrl = getOddpathMcpUrl();
const apiUrl = getOddpathApiUrl();
const activeConnections = computed(() => connections.value.filter((connection) => !connection.revokedAt));
const existingRunnerConnections = computed(() => activeConnections.value.filter((connection) =>
  connection.preset === "RUNNER" || connection.scopes.includes("execution:claim")
));
const mcpConfig = computed(() => JSON.stringify({
  mcpServers: {
    oddpath: {
      headers: { Authorization: `Bearer ${revealedToken.value || "<YOUR_TOKEN>"}` },
      type: "http",
      url: mcpUrl,
    },
  },
}, null, 2));
const runnerConfig = computed(() => JSON.stringify({
  displayName: newConnectionName.value.trim() || "Local Playwright Runner",
  instanceId: "my-runner",
  profiles: [{
    baseUrl: "http://127.0.0.1:3000",
    environmentKind: "LOCAL",
    evidenceKinds: ["TEXT", "SCREENSHOT"],
    key: "local",
    label: "Local",
    values: {},
  }],
  schemaVersion: 1,
  serverUrl: apiUrl,
  tokenEnv: "ODDPATH_RUNNER_TOKEN",
}, null, 2));

watch(() => props.projectId, () => {
  generation += 1;
  connections.value = [];
  revealedToken.value = "";
  copiedField.value = null;
  isSaving.value = false;
  void loadConnections();
}, { immediate: true, flush: "sync" });

async function loadConnections() {
  const id = props.projectId;
  const revision = generation;
  isLoading.value = true;
  errorMessage.value = "";
  try {
    const loaded = await fetchProjectConnections(id);
    if (!isCurrent(id, revision)) return;
    connections.value = loaded;
    emit("changed", activeConnections.value.length);
  } catch (error) {
    if (!isCurrent(id, revision)) return;
    errorMessage.value = error instanceof Error ? error.message : t("projects.connections.errorLoad");
  } finally {
    if (isCurrent(id, revision)) isLoading.value = false;
  }
}

async function createConnection() {
  const id = props.projectId;
  const revision = generation;
  const preset = connectionPreset.value;
  const name = newConnectionName.value.trim();
  if (!name || isSaving.value || isLoading.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  revealedToken.value = "";
  try {
    const created = await createProjectConnection(id, name, preset);
    if (!isCurrent(id, revision)) return;
    connections.value = [created.connection, ...connections.value];
    revealedToken.value = created.token;
    emit("changed", activeConnections.value.length);
  } catch (error) {
    if (!isCurrent(id, revision)) return;
    errorMessage.value = error instanceof Error ? error.message : t("projects.connections.errorCreate");
  } finally {
    if (isCurrent(id, revision)) isSaving.value = false;
  }
}

function selectPreset(preset: "AGENT" | "RUNNER") {
  if (isSaving.value) return;
  connectionPreset.value = preset;
  if (preset === "RUNNER" && newConnectionName.value === "Codex") {
    newConnectionName.value = "Local Playwright Runner";
  } else if (preset === "AGENT" && newConnectionName.value === "Local Playwright Runner") {
    newConnectionName.value = "Codex";
  }
  revealedToken.value = "";
}

async function revoke(connection: ProjectConnection) {
  const id = props.projectId;
  const revision = generation;
  if (isSaving.value || connection.revokedAt) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    await revokeProjectConnection(id, connection.id);
    if (!isCurrent(id, revision)) return;
    connections.value = connections.value.map((item) =>
      item.id === connection.id ? { ...item, revokedAt: new Date().toISOString() } : item
    );
    emit("changed", activeConnections.value.length);
  } catch (error) {
    if (!isCurrent(id, revision)) return;
    errorMessage.value = error instanceof Error ? error.message : t("projects.connections.errorRevoke");
  } finally {
    if (isCurrent(id, revision)) isSaving.value = false;
  }
}

async function copy(value: string, field: "config" | "token" | "url" | "command") {
  const id = props.projectId;
  const revision = generation;
  try {
    await navigator.clipboard.writeText(value);
    if (!isCurrent(id, revision)) return;
    copiedField.value = field;
    window.setTimeout(() => {
      if (isCurrent(id, revision) && copiedField.value === field) copiedField.value = null;
    }, 1600);
  } catch {
    if (!isCurrent(id, revision)) return;
    errorMessage.value = t("projects.connections.errorCopy");
  }
}

function close() {
  if (!isSaving.value) emit("close");
}

const { dialogRef, onDialogKeydown } = useDialogAccessibility({
  canClose: () => !isSaving.value,
  isOpen: () => true,
  onClose: close,
});
</script>

<template>
  <Teleport to="body">
    <div
      ref="dialogRef"
      class="modal fade show d-block"
      :class="{ 'workspace-surface': appearance === 'workspace' || appearance === 'tests', 'qa-focused-workspace': appearance === 'tests' }"
      tabindex="-1"
      role="dialog"
      aria-modal="true"
      aria-labelledby="qa-connection-title"
      @click.self="close"
      @keydown="onDialogKeydown"
    >
      <div class="modal-dialog modal-dialog-centered modal-dialog-scrollable qa-connection-dialog">
        <section class="modal-content app-modal">
          <div class="modal-header">
            <div>
              <span class="qa-modal-eyebrow">{{ projectName }}</span>
              <h2 id="qa-connection-title" class="modal-title">{{ t("projects.connections.title") }}</h2>
            </div>
            <button class="btn-close" type="button" :aria-label="t('projects.context.close')" :disabled="isSaving" @click="close"></button>
          </div>

          <div class="modal-body qa-connection-body">
            <div v-if="connectionPreset === 'AGENT'" class="qa-connection-value">
              <strong>{{ t("projects.connections.endpoint") }}</strong>
              <div class="qa-copy-field">
                <code>{{ mcpUrl }}</code>
                <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(mcpUrl, 'url')">
                  {{ copiedField === "url" ? t("projects.connections.copied") : t("projects.connections.copy") }}
                </button>
              </div>
              <small>{{ t("projects.connections.endpointNote") }}</small>
            </div>

            <fieldset class="qa-form-field">
              <legend class="form-label">{{ t("projects.connections.type") }}</legend>
              <div class="qa-mode-options">
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': connectionPreset === 'AGENT' }">
                  <input :checked="connectionPreset === 'AGENT'" :disabled="isSaving" type="radio" value="AGENT" @change="selectPreset('AGENT')" />
                  <span><strong>{{ t("projects.connections.agent") }}</strong><small>{{ t("projects.connections.agentNote") }}</small></span>
                </label>
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': connectionPreset === 'RUNNER' }">
                  <input :checked="connectionPreset === 'RUNNER'" :disabled="isSaving" type="radio" value="RUNNER" @change="selectPreset('RUNNER')" />
                  <span><strong>{{ t("projects.connections.runner") }}</strong><small>{{ t("projects.connections.runnerNote") }}</small></span>
                </label>
              </div>
            </fieldset>

            <section v-if="connectionPreset === 'RUNNER' && (existingRunnerConnections.length || knownRunnerProfile) && !revealedToken" class="qa-connection-recovery">
              <strong>{{ t('projects.connections.runnerExistingTitle') }}</strong>
              <p>{{ t('projects.connections.runnerExistingNote') }}</p>
              <ol>
                <li>{{ t('projects.qa.runSetup.config', { config: 'apps/runner/oddpath.runner.json' }) }}</li>
                <li>{{ t('projects.connections.runnerExistingToken') }}</li>
                <li>{{ t('projects.connections.runnerExistingStart') }}</li>
              </ol>
              <div class="qa-section-heading">
                <span>{{ t('projects.connections.runnerSecurePrompt') }}</span>
                <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(RUNNER_START_POWERSHELL, 'command')">
                  {{ copiedField === 'command' ? t('projects.connections.copied') : t('projects.connections.runnerCopyStartup') }}
                </button>
              </div>
              <pre><code dir="ltr">{{ RUNNER_START_POWERSHELL }}</code></pre>
              <small>{{ t('projects.connections.runnerExistingLost') }}</small>
            </section>

            <form class="qa-connection-create" @submit.prevent="createConnection">
              <label class="qa-form-field">
                <span class="form-label">{{ t("projects.connections.name") }}</span>
                <input v-model="newConnectionName" class="form-control" maxlength="120" :placeholder="t('projects.connections.namePlaceholder')" />
              </label>
              <button class="btn btn-primary" type="submit" :disabled="!newConnectionName.trim() || isSaving || isLoading">
                {{ isSaving ? t("projects.connections.creating") : t("projects.connections.create") }}
              </button>
            </form>

            <div v-if="revealedToken" class="qa-token-reveal" role="status">
              <strong>{{ t("projects.connections.revealTitle") }}</strong>
              <p>{{ t("projects.connections.revealNote") }}</p>
              <div class="qa-copy-field">
                <code>{{ revealedToken }}</code>
                <button class="btn btn-sm btn-primary" type="button" @click="copy(revealedToken, 'token')">
                  {{ copiedField === "token" ? t("projects.connections.copied") : t("projects.connections.copyToken") }}
                </button>
              </div>
              <div v-if="connectionPreset === 'AGENT'" class="qa-mcp-config">
                <div class="qa-section-heading">
                  <strong>{{ t("projects.connections.mcpConfig") }}</strong>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(mcpConfig, 'config')">
                    {{ copiedField === "config" ? t("projects.connections.copied") : t("projects.connections.copyConfig") }}
                  </button>
                </div>
                <pre><code>{{ mcpConfig }}</code></pre>
                <small>{{ t("projects.connections.mcpNote") }}</small>
              </div>
              <div v-else class="qa-mcp-config">
                <div class="qa-section-heading">
                  <strong>{{ t("projects.connections.runnerSetup") }}</strong>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(runnerConfig, 'config')">
                    {{ copiedField === "config" ? t("projects.connections.copied") : t("projects.connections.copyConfig") }}
                  </button>
                </div>
                <p>{{ t("projects.connections.runnerSave") }} <code>apps/runner/oddpath.runner.json</code>. {{ t("projects.connections.runnerConfigure") }}</p>
                <pre><code>{{ runnerConfig }}</code></pre>
                <p>{{ t('projects.connections.runnerSecurePrompt') }}</p>
                <div class="qa-section-heading">
                  <span>{{ t('projects.connections.runnerStart') }}</span>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(RUNNER_START_POWERSHELL, 'command')">
                    {{ copiedField === 'command' ? t('projects.connections.copied') : t('projects.connections.runnerCopyStartup') }}
                  </button>
                </div>
                <pre><code dir="ltr">npx playwright install chromium
{{ RUNNER_START_POWERSHELL }}</code></pre>
                <small>{{ t("projects.connections.runnerPrivacy") }}</small>
              </div>
            </div>

            <div class="qa-connection-help">
              <strong>{{ connectionPreset === "RUNNER" ? t("projects.connections.runnerCan") : t("projects.connections.agentCan") }}</strong>
              <p v-if="connectionPreset === 'RUNNER'">{{ t("projects.connections.runnerPermission") }}</p>
              <p v-else>{{ t("projects.connections.agentPermission") }}</p>
            </div>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">{{ errorMessage }}</p>

            <div class="qa-connection-list">
              <div class="qa-section-heading">
                <h3>{{ t("projects.connections.listTitle") }}</h3>
                <span>{{ t("projects.integrations.savedCount", { count: activeConnections.length }) }}</span>
              </div>
              <p v-if="isLoading" class="workspace-note">{{ t("projects.connections.loading") }}</p>
              <p v-else-if="connections.length === 0" class="workspace-note">{{ t("projects.connections.empty") }}</p>
              <article v-for="connection in connections" :key="connection.id" class="qa-connection-row">
                <div>
                  <strong>{{ connection.name }}</strong>
                  <small>{{ connection.preset || (connection.scopes.includes("execution:claim") ? "RUNNER" : "AGENT") }} · {{ connection.tokenPrefix }}… · {{ connection.scopes.join(", ") }}</small>
                </div>
                <span v-if="connection.revokedAt" class="qa-status qa-status--neutral">{{ t("projects.connections.revoked") }}</span>
                <button v-else class="btn btn-sm btn-outline-danger" type="button" :disabled="isSaving" @click="revoke(connection)">{{ t("projects.connections.revoke") }}</button>
              </article>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="close">{{ t("projects.connections.done") }}</button>
          </div>
        </section>
      </div>
    </div>
    <div class="modal-backdrop fade show"></div>
  </Teleport>
</template>
