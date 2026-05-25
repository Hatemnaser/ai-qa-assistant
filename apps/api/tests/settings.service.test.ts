import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createSettingsService,
} from "../src/modules/settings/settings.service.ts";
import type {
  SettingsRepository,
  UserSettingsRecord,
} from "../src/modules/settings/settings.repository.ts";

describe("settings service", () => {
  it("returns safe defaults when the user has no saved settings", async () => {
    const service = createSettingsService({
      repository: createMemorySettingsRepository(),
    });

    const settings = await service.getUserSettings("user-1");

    assert.equal(settings.language, "en");
    assert.equal(settings.theme, "light");
    assert.equal(settings.defaultModel, "gemini-3.1-flash-lite");
    assert.equal(settings.isDefault, true);
  });

  it("saves normalized settings for the current user", async () => {
    const repository = createMemorySettingsRepository();
    const service = createSettingsService({
      repository,
    });

    const settings = await service.updateUserSettings("user-1", {
      defaultModel: " gemini-2.5-flash ",
      language: "de",
      theme: "dark",
    });

    assert.equal(settings.defaultModel, "gemini-2.5-flash");
    assert.equal(settings.isDefault, false);
    assert.equal(settings.language, "de");
    assert.equal(settings.theme, "dark");
    assert.deepEqual(repository.settingsByUser.get("user-1"), {
      defaultModel: "gemini-2.5-flash",
      language: "de",
      theme: "dark",
      updatedAt: new Date("2026-05-25T00:00:00.000Z"),
    });
  });

  it("rejects unsupported default models", async () => {
    const service = createSettingsService({
      repository: createMemorySettingsRepository(),
    });

    await assert.rejects(
      () =>
        service.updateUserSettings("user-1", {
          defaultModel: "not-a-model",
          language: "en",
          theme: "light",
        }),
      {
        code: "UNSUPPORTED_MODEL",
      }
    );
  });
});

function createMemorySettingsRepository() {
  const settingsByUser = new Map<string, UserSettingsRecord>();
  const repository: SettingsRepository & {
    settingsByUser: Map<string, UserSettingsRecord>;
  } = {
    settingsByUser,
    async getUserSettings(userId) {
      return settingsByUser.get(userId) || null;
    },
    async upsertUserSettings(userId, input) {
      const record = {
        defaultModel: input.defaultModel,
        language: input.language,
        theme: input.theme,
        updatedAt: new Date("2026-05-25T00:00:00.000Z"),
      };

      settingsByUser.set(userId, record);

      return record;
    },
  };

  return repository;
}
