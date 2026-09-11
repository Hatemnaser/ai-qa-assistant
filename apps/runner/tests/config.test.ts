import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  assertSameOriginUrl,
  buildPublicManifest,
  resolveNavigationUrl,
  resolveProfileValue,
  runnerConfigSchema,
} from "../src/config.js";
import { testConfig } from "./fixtures.js";

const originalEmail = process.env.ODDPATH_TEST_EMAIL;
afterEach(() => {
  if (originalEmail === undefined) delete process.env.ODDPATH_TEST_EMAIL;
  else process.env.ODDPATH_TEST_EMAIL = originalEmail;
});

describe("runner configuration", () => {
  it("publishes only profile capabilities and value references", () => {
    const config = testConfig();
    const manifest = buildPublicManifest(config.profiles[0]!);
    const serialized = JSON.stringify(manifest);

    assert.equal(manifest.profileKey, "checkout.test");
    assert.equal(manifest.manifestHash?.length, 64);
    assert.equal(serialized.includes("ODDPATH_TEST_EMAIL"), false);
    assert.equal(serialized.includes("127.0.0.1:4173"), false);
  });

  it("resolves profile values locally without placing them in the public manifest", () => {
    process.env.ODDPATH_TEST_EMAIL = "private@example.test";
    const profile = testConfig().profiles[0]!;
    assert.equal(resolveProfileValue(profile, "customer.email"), "private@example.test");
    assert.equal(JSON.stringify(buildPublicManifest(profile)).includes("private@example.test"), false);
  });

  it("allows same-origin relative paths and rejects origin escapes", () => {
    assert.equal(
      resolveNavigationUrl("https://example.test/app", "/checkout"),
      "https://example.test/checkout"
    );
    assert.throws(
      () => resolveNavigationUrl("https://example.test", "//attacker.test/checkout"),
      /escaped the configured origin/u
    );
    assert.doesNotThrow(() => assertSameOriginUrl("https://example.test", "https://example.test/done"));
    assert.throws(
      () => assertSameOriginUrl("https://example.test", "https://attacker.test/done"),
      /outside the configured origin/u
    );
  });

  it("requires the Oddpath server URL to be an exact origin", () => {
    const config = testConfig();
    assert.equal(runnerConfigSchema.safeParse(config).success, true);
    assert.equal(runnerConfigSchema.safeParse({
      ...config,
      serverUrl: "https://oddpath.example.test/proxy",
    }).success, false);
  });
});
