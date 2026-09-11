import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCliArgs } from "../src/cli-args.js";

describe("runner CLI arguments", () => {
  it("requires an explicit production flag and supports a headed override", () => {
    const defaults = parseCliArgs(["runner"]);
    assert.equal(defaults.allowProduction, false);
    assert.equal(defaults.headed, false);

    const enabled = parseCliArgs([
      "runner",
      "--config",
      "runner.test.json",
      "--headed",
      "--allow-production",
    ]);
    assert.equal(enabled.configPath, "runner.test.json");
    assert.equal(enabled.headed, true);
    assert.equal(enabled.allowProduction, true);
  });

  it("rejects unknown flags and a missing config value", () => {
    assert.throws(() => parseCliArgs(["--unknown"]), /Unknown runner argument/u);
    assert.throws(() => parseCliArgs(["--config"]), /requires a file path/u);
  });
});
