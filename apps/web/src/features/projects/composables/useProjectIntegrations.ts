import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";

import { t } from "../../../i18n/useI18n";
import { fetchProjectConnections, fetchQaRunnerProfiles } from "../../qa/qaApi";
import type { ProjectConnection, QaRunnerProfile } from "../../qa/types";

export function connectionKind(connection: ProjectConnection): "AGENT" | "RUNNER" {
  return connection.preset || (connection.scopes.includes("execution:claim") ? "RUNNER" : "AGENT");
}

export function useProjectIntegrations(
  projectId: Ref<string>,
  dependencies = { fetchConnections: fetchProjectConnections, fetchProfiles: fetchQaRunnerProfiles }
) {
  const connections = ref<ProjectConnection[]>([]);
  const profiles = ref<QaRunnerProfile[]>([]);
  const connectionError = ref("");
  const profileError = ref("");
  const isLoading = ref(false);
  let generation = 0;
  let disposed = false;

  const agentConnections = computed(() => connections.value.filter((item) => !item.revokedAt && connectionKind(item) === "AGENT"));
  const runnerConnections = computed(() => connections.value.filter((item) => !item.revokedAt && connectionKind(item) === "RUNNER"));
  const onlineProfiles = computed(() => profiles.value.filter((item) => item.status === "ONLINE"));

  async function refresh() {
    const id = projectId.value;
    const requestGeneration = ++generation;
    if (!id || disposed) return;
    isLoading.value = true;
    connectionError.value = "";
    profileError.value = "";
    const isCurrent = () => !disposed && id === projectId.value && generation === requestGeneration;
    await Promise.all([
      dependencies.fetchConnections(id).then((value) => {
        if (isCurrent()) connections.value = value;
      }).catch((error: unknown) => {
        if (isCurrent()) connectionError.value = error instanceof Error ? error.message : t("projects.integrations.errors.connections");
      }),
      dependencies.fetchProfiles(id).then((value) => {
        if (isCurrent()) profiles.value = value;
      }).catch((error: unknown) => {
        if (isCurrent()) profileError.value = error instanceof Error ? error.message : t("projects.integrations.errors.profiles");
      }),
    ]);
    if (isCurrent()) isLoading.value = false;
  }

  watch(projectId, () => {
    connections.value = [];
    profiles.value = [];
    connectionError.value = "";
    profileError.value = "";
    void refresh();
  }, { immediate: true, flush: "sync" });

  if (getCurrentScope()) onScopeDispose(() => { disposed = true; generation += 1; });
  return { agentConnections, runnerConnections, profiles, onlineProfiles, connectionError, profileError, isLoading, refresh };
}
