import { resolveAiModel } from "../ai/provider-registry.js";
import { settingsRepository, type SettingsRepository, type UserSettingsRecord } from "./settings.repository.js";
import type { UserSettingsDto, UserSettingsInput, UserThemePreference } from "./settings.types.js";

const DEFAULT_USER_SETTINGS: UserSettingsInput = {
  defaultModel: "gemini-3.1-flash-lite",
  language: "en",
  theme: "light",
};

export interface SettingsServiceDependencies {
  repository: SettingsRepository;
}

export function createSettingsService({ repository }: SettingsServiceDependencies) {
  async function getUserSettings(userId: string): Promise<UserSettingsDto> {
    const settings = await repository.getUserSettings(userId);

    return toSettingsDto(settings || createDefaultSettingsRecord(), !settings);
  }

  async function updateUserSettings(userId: string, input: UserSettingsInput): Promise<UserSettingsDto> {
    const normalizedInput = {
      defaultModel: resolveAiModel({ model: input.defaultModel }).model,
      language: input.language,
      theme: input.theme,
    };
    const settings = await repository.upsertUserSettings(userId, normalizedInput);

    return toSettingsDto(settings, false);
  }

  return {
    getUserSettings,
    updateUserSettings,
  };
}

function createDefaultSettingsRecord(): UserSettingsRecord {
  return {
    ...DEFAULT_USER_SETTINGS,
    updatedAt: new Date(0),
  };
}

function toSettingsDto(settings: UserSettingsRecord, isDefault: boolean): UserSettingsDto {
  return {
    defaultModel: settings.defaultModel,
    isDefault,
    language: settings.language,
    theme: toThemePreference(settings.theme),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function toThemePreference(theme: string): UserThemePreference {
  if (theme === "dark" || theme === "system") return theme;

  return "light";
}

export const settingsService = createSettingsService({
  repository: settingsRepository,
});
