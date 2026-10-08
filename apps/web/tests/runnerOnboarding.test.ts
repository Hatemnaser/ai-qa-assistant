import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { RUNNER_START_POWERSHELL } from "../src/features/qa/runnerOnboarding.ts";

const source = (path: string) => readFile(new URL(`../src/features/qa/components/${path}`, import.meta.url), "utf8");

describe("local Runner onboarding and recovery", () => {
  it("asks for the token privately instead of embedding a revealed secret in a shell command", () => {
    assert.match(RUNNER_START_POWERSHELL, /Read-Host .* -AsSecureString/);
    assert.match(RUNNER_START_POWERSHELL, /\$env:ODDPATH_RUNNER_TOKEN/);
    assert.match(RUNNER_START_POWERSHELL, /npm run dev:runner/);
    assert.doesNotMatch(RUNNER_START_POWERSHELL, /odp_live_|revealedToken|Write-Host/);
  });

  it("offers a saved Runner recovery path before creating a replacement connection", async () => {
    const modal = await source("QaConnectionModal.vue");
    assert.match(modal, /existingRunnerConnections\.length \|\| knownRunnerProfile/);
    assert.match(modal, /projects\.connections\.runnerExistingTitle/);
    assert.match(modal, /projects\.connections\.runnerExistingLost/);
    assert.match(modal, /copy\(RUNNER_START_POWERSHELL, 'command'\)/);
    assert.doesNotMatch(modal, /runnerPowerShell|\$env:ODDPATH_RUNNER_TOKEN = "\$\{revealedToken/);
    assert.match(modal, /v-if="connectionPreset === 'AGENT'" class="qa-connection-value"/);
  });
});
