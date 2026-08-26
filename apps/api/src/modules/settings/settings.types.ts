export type UserThemePreference = "dark" | "light" | "system";

export interface UserSettingsDto {
  defaultModel: string;
  isDefault: boolean;
  language: string;
  theme: UserThemePreference;
  updatedAt: string;
}

export interface UserSettingsInput {
  defaultModel: string;
  language: string;
  theme: UserThemePreference;
}

export interface UserSettingsRecord {
  defaultModel: string;
  language: string;
  theme: string;
  updatedAt: Date;
}

export interface SettingsRepository {
  getUserSettings(userId: string): Promise<UserSettingsRecord | null>;
  upsertUserSettings(userId: string, input: UserSettingsInput): Promise<UserSettingsRecord>;
}
