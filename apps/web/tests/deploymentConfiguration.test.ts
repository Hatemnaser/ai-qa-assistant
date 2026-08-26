import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const ciWorkflowPath = fileURLToPath(
  new URL("../../../.github/workflows/ci.yml", import.meta.url)
);
const renderCronExamplePath = fileURLToPath(
  new URL("../../../ops/render-cron-services.example.yaml", import.meta.url)
);

describe("deployment configuration", () => {
  it("scopes NODE_ENV to verification and build steps", async () => {
    const workflow = await readFile(ciWorkflowPath, "utf8");
    const verifyJobStart = workflow.indexOf("\n  verify:");
    const stepsStart = workflow.indexOf("\n    steps:", verifyJobStart);

    assert.ok(verifyJobStart >= 0, "CI must define the verify job");
    assert.ok(stepsStart > verifyJobStart, "CI verify job must define steps");
    assert.doesNotMatch(
      workflow.slice(verifyJobStart, stepsStart),
      /^\s+NODE_ENV:/m,
      "NODE_ENV must not leak from the job into production builds"
    );

    assertStepNodeEnvironment(workflow, "Run tests and type checks", "test");
    assertStepNodeEnvironment(workflow, "Run real PostgreSQL integration tests", "test");
    assertStepNodeEnvironment(workflow, "Build API", "production");
    assertStepNodeEnvironment(workflow, "Build web app", "production");
  });

  it("deploys every opt-in cron only after checks pass", async () => {
    const cronExample = await readFile(renderCronExamplePath, "utf8");
    const cronServices = cronExample.split(/^  - type: cron\s*$/m).slice(1);

    assert.ok(cronServices.length > 0, "the Render example must contain cron services");

    for (const cronService of cronServices) {
      assert.match(cronService, /^    autoDeployTrigger: checksPass\s*$/m);
    }
  });
});

function assertStepNodeEnvironment(
  workflow: string,
  stepName: string,
  expectedNodeEnvironment: "production" | "test"
) {
  const stepMarker = `      - name: ${stepName}`;
  const stepStart = workflow.indexOf(stepMarker);
  const nextStepStart = workflow.indexOf("\n      - name:", stepStart + stepMarker.length);

  assert.ok(stepStart >= 0, `CI must contain the ${stepName} step`);

  const step = workflow.slice(
    stepStart,
    nextStepStart >= 0 ? nextStepStart : workflow.length
  );

  assert.match(
    step,
    new RegExp(`^          NODE_ENV: ${expectedNodeEnvironment}\\s*$`, "m")
  );
}
