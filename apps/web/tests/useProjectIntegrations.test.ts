import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { effectScope, ref } from "vue";
import { connectionKind, useProjectIntegrations } from "../src/features/projects/composables/useProjectIntegrations";
import type { ProjectConnection, QaRunnerProfile } from "../src/features/qa/types";

function connection(id: string, preset?: "AGENT" | "RUNNER", revokedAt: string | null = null): ProjectConnection {
  return { id, name: id, preset, revokedAt, tokenPrefix: "demo", scopes: [], expiresAt: null, lastUsedAt: null, createdAt: "", updatedAt: "" };
}
function profile(id: string, status: QaRunnerProfile["status"]): QaRunnerProfile {
  return { id, status, runnerRegistrationId: id, runnerName: id, runnerInstanceId: id, runnerVersion: "1", key: id, label: id, environmentKind: "LOCAL", supportedRecipeVersions: [1], valueRefs: [], evidenceKinds: ["TEXT"], manifestHash: null, lastSeenAt: null };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { resolve, promise };
}

describe("project integrations", () => {
  it("keeps saved tool/Runner credentials separate from live profiles", async () => {
    const state = useProjectIntegrations(ref("project-1"), {
      fetchConnections: async () => [connection("tool", "AGENT"), connection("runner", "RUNNER"), connection("revoked", "AGENT", "2026-01-01")],
      fetchProfiles: async () => [profile("online", "ONLINE"), profile("offline", "OFFLINE"), profile("incompatible", "INCOMPATIBLE")],
    });
    await state.refresh();
    assert.deepEqual(state.agentConnections.value.map((item) => item.id), ["tool"]);
    assert.deepEqual(state.runnerConnections.value.map((item) => item.id), ["runner"]);
    assert.deepEqual(state.onlineProfiles.value.map((item) => item.id), ["online"]);
    assert.equal(connectionKind({ ...connection("legacy"), scopes: ["execution:claim"] }), "RUNNER");
  });

  it("does not lose independent connection results when Runner discovery fails", async () => {
    const state = useProjectIntegrations(ref("project-1"), {
      fetchConnections: async () => [connection("tool", "AGENT")],
      fetchProfiles: async () => { throw new Error("Discovery unavailable"); },
    });
    await state.refresh();
    assert.equal(state.agentConnections.value.length, 1);
    assert.equal(state.connectionError.value, "");
    assert.equal(state.profileError.value, "Discovery unavailable");
    assert.equal(state.isLoading.value, false);
  });

  it("discards requests from the previous project and disposed account scope", async () => {
    const scope = effectScope();
    const old = deferred<ProjectConnection[]>();
    const id = ref("old");
    const state = scope.run(() => useProjectIntegrations(id, {
      fetchConnections: async (projectId) => projectId === "old" ? old.promise : [connection("current", "AGENT")],
      fetchProfiles: async () => [],
    }))!;
    id.value = "current";
    await state.refresh();
    old.resolve([connection("old", "AGENT")]);
    await Promise.resolve();
    assert.deepEqual(state.agentConnections.value.map((item) => item.id), ["current"]);
    scope.stop();
    id.value = "old";
    await state.refresh();
    assert.deepEqual(state.agentConnections.value.map((item) => item.id), ["current"]);
  });
});
