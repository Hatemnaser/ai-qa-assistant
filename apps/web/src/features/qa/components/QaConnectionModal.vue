<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

import { useDialogAccessibility } from "../../../ui/useDialogAccessibility";
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
}>();

const emit = defineEmits<{ close: []; changed: [count: number] }>();
const connections = ref<ProjectConnection[]>([]);
const errorMessage = ref("");
const isLoading = ref(true);
const isSaving = ref(false);
const newConnectionName = ref("Codex");
const connectionPreset = ref<"AGENT" | "RUNNER">("AGENT");
const revealedToken = ref("");
const copiedField = ref<"config" | "token" | "url" | null>(null);
const mcpUrl = getOddpathMcpUrl();
const apiUrl = getOddpathApiUrl();
const activeConnections = computed(() => connections.value.filter((connection) => !connection.revokedAt));
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
const runnerPowerShell = computed(() => `$env:ODDPATH_RUNNER_TOKEN = "${revealedToken.value}"`);

onMounted(loadConnections);

async function loadConnections() {
  isLoading.value = true;
  errorMessage.value = "";
  try {
    connections.value = await fetchProjectConnections(props.projectId);
    emit("changed", activeConnections.value.length);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not load agent connections.";
  } finally {
    isLoading.value = false;
  }
}

async function createConnection() {
  const name = newConnectionName.value.trim();
  if (!name || isSaving.value) return;
  isSaving.value = true;
  errorMessage.value = "";
  revealedToken.value = "";
  try {
    const created = await createProjectConnection(props.projectId, name, connectionPreset.value);
    connections.value = [created.connection, ...connections.value];
    revealedToken.value = created.token;
    emit("changed", activeConnections.value.length);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not create this connection.";
  } finally {
    isSaving.value = false;
  }
}

function selectPreset(preset: "AGENT" | "RUNNER") {
  connectionPreset.value = preset;
  if (preset === "RUNNER" && newConnectionName.value === "Codex") {
    newConnectionName.value = "Local Playwright Runner";
  } else if (preset === "AGENT" && newConnectionName.value === "Local Playwright Runner") {
    newConnectionName.value = "Codex";
  }
  revealedToken.value = "";
}

async function revoke(connection: ProjectConnection) {
  if (isSaving.value || connection.revokedAt) return;
  isSaving.value = true;
  errorMessage.value = "";
  try {
    await revokeProjectConnection(props.projectId, connection.id);
    connections.value = connections.value.map((item) =>
      item.id === connection.id ? { ...item, revokedAt: new Date().toISOString() } : item
    );
    emit("changed", activeConnections.value.length);
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : "Could not revoke this connection.";
  } finally {
    isSaving.value = false;
  }
}

async function copy(value: string, field: "config" | "token" | "url") {
  try {
    await navigator.clipboard.writeText(value);
    copiedField.value = field;
    window.setTimeout(() => {
      if (copiedField.value === field) copiedField.value = null;
    }, 1600);
  } catch {
    errorMessage.value = "Copy failed. Select the value manually.";
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
              <h2 id="qa-connection-title" class="modal-title">Connect an agent</h2>
            </div>
            <button class="btn-close" type="button" aria-label="Close" :disabled="isSaving" @click="close"></button>
          </div>

          <div class="modal-body qa-connection-body">
            <div class="qa-connection-value">
              <strong>MCP endpoint</strong>
              <div class="qa-copy-field">
                <code>{{ mcpUrl }}</code>
                <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(mcpUrl, 'url')">
                  {{ copiedField === "url" ? "Copied" : "Copy" }}
                </button>
              </div>
              <small>Works with Codex, Claude, and any client that supports remote Streamable HTTP MCP.</small>
            </div>

            <fieldset class="qa-form-field">
              <legend class="form-label">Connection type</legend>
              <div class="qa-mode-options">
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': connectionPreset === 'AGENT' }">
                  <input :checked="connectionPreset === 'AGENT'" type="radio" value="AGENT" @change="selectPreset('AGENT')" />
                  <span><strong>Agent</strong><small>Codex, Claude, or another MCP client submits QA work.</small></span>
                </label>
                <label class="qa-mode-option" :class="{ 'qa-mode-option--active': connectionPreset === 'RUNNER' }">
                  <input :checked="connectionPreset === 'RUNNER'" type="radio" value="RUNNER" @change="selectPreset('RUNNER')" />
                  <span><strong>Playwright Runner</strong><small>A local worker executes approved Recipes with local profile values.</small></span>
                </label>
              </div>
            </fieldset>

            <form class="qa-connection-create" @submit.prevent="createConnection">
              <label class="qa-form-field">
                <span class="form-label">Connection name</span>
                <input v-model="newConnectionName" class="form-control" maxlength="120" placeholder="Codex on my laptop" />
              </label>
              <button class="btn btn-primary" type="submit" :disabled="!newConnectionName.trim() || isSaving">
                {{ isSaving ? "Creating…" : "Create token" }}
              </button>
            </form>

            <div v-if="revealedToken" class="qa-token-reveal" role="status">
              <strong>Copy this token now</strong>
              <p>Oddpath stores only its hash. You will not be able to reveal it again.</p>
              <div class="qa-copy-field">
                <code>{{ revealedToken }}</code>
                <button class="btn btn-sm btn-primary" type="button" @click="copy(revealedToken, 'token')">
                  {{ copiedField === "token" ? "Copied" : "Copy token" }}
                </button>
              </div>
              <div v-if="connectionPreset === 'AGENT'" class="qa-mcp-config">
                <div class="qa-section-heading">
                  <strong>Remote MCP config</strong>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(mcpConfig, 'config')">
                    {{ copiedField === "config" ? "Copied" : "Copy config" }}
                  </button>
                </div>
                <pre><code>{{ mcpConfig }}</code></pre>
                <small>Paste this into the MCP client you use. Client-specific file locations can differ.</small>
              </div>
              <div v-else class="qa-mcp-config">
                <div class="qa-section-heading">
                  <strong>Runner setup</strong>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(runnerConfig, 'config')">
                    {{ copiedField === "config" ? "Copied" : "Copy config" }}
                  </button>
                </div>
                <p>Save this as <code>apps/runner/oddpath.runner.json</code>, adjust the profile URL and local values, then set the token in your terminal.</p>
                <pre><code>{{ runnerConfig }}</code></pre>
                <div class="qa-copy-field">
                  <code>{{ runnerPowerShell }}</code>
                  <button class="btn btn-sm btn-outline-secondary" type="button" @click="copy(runnerPowerShell, 'token')">
                    {{ copiedField === "token" ? "Copied" : "Copy PowerShell" }}
                  </button>
                </div>
                <p class="mb-1">Install the configured browser once, then start the Runner from the repository root:</p>
                <pre><code>npx playwright install chromium
npm run dev:runner</code></pre>
                <small>The token and profile values stay on the machine running Playwright. Oddpath stores only the public profile manifest.</small>
              </div>
            </div>

            <div class="qa-connection-help">
              <strong>{{ connectionPreset === "RUNNER" ? "What the Runner can do" : "What the agent can do" }}</strong>
              <p v-if="connectionPreset === 'RUNNER'">Claim only owner-approved executions, run the exact immutable Recipe, and return results plus required evidence. It cannot select checklists or approve QA records.</p>
              <p v-else>Read QA Requests, submit checklist and Recipe candidates, start connected-agent runs, record results, and attach evidence. Checklist selection and Human Review stay owner-only in Oddpath.</p>
            </div>

            <p v-if="errorMessage" class="workspace-feedback workspace-feedback--error mb-0" role="alert">{{ errorMessage }}</p>

            <div class="qa-connection-list">
              <div class="qa-section-heading">
                <h3>Project connections</h3>
                <span>{{ activeConnections.length }} active</span>
              </div>
              <p v-if="isLoading" class="workspace-note">Loading connections…</p>
              <p v-else-if="connections.length === 0" class="workspace-note">No agent has access to this project yet.</p>
              <article v-for="connection in connections" :key="connection.id" class="qa-connection-row">
                <div>
                  <strong>{{ connection.name }}</strong>
                  <small>{{ connection.preset || (connection.scopes.includes("execution:claim") ? "RUNNER" : "AGENT") }} · {{ connection.tokenPrefix }}… · {{ connection.scopes.join(", ") }}</small>
                </div>
                <span v-if="connection.revokedAt" class="qa-status qa-status--neutral">Revoked</span>
                <button v-else class="btn btn-sm btn-outline-danger" type="button" :disabled="isSaving" @click="revoke(connection)">Revoke</button>
              </article>
            </div>
          </div>

          <div class="modal-footer">
            <button class="btn btn-outline-secondary" type="button" :disabled="isSaving" @click="close">Done</button>
          </div>
        </section>
      </div>
    </div>
    <div class="modal-backdrop fade show"></div>
  </Teleport>
</template>
