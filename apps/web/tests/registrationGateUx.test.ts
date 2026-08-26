import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

const registerPageUrl = new URL("../src/features/auth/pages/RegisterPage.vue", import.meta.url);

describe("registration gate UX", () => {
  it("fail-closes while config is unavailable and submits server-issued terms metadata", async () => {
    const source = await readFile(registerPageUrl, "utf8");

    assert.match(source, /getRegistrationConfig/);
    assert.match(source, /!registrationConfigError\.value/);
    assert.match(source, /!isRegistrationDisabled\.value/);
    assert.match(source, /termsAccepted: termsAccepted\.value/);
    assert.match(source, /termsVersion,/);
    assert.match(source, /TERMS_VERSION_OUTDATED/);
    assert.match(source, /await loadRegistrationConfig\(\)/);
  });

  it("shows the invite input only in invite mode and links real localized legal routes", async () => {
    const source = await readFile(registerPageUrl, "utf8");

    assert.match(source, /v-if="isInviteRequired"/);
    assert.match(source, /https:\/\/eluthira\.com\/de\/terms/);
    assert.match(source, /https:\/\/eluthira\.com\/de\/privacy/);
    assert.match(source, /target="_blank" rel="noopener noreferrer"/);
  });
});
