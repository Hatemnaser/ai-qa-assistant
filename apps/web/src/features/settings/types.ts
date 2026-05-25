export type UserThemePreference = "dark" | "light" | "system";

export interface UserSettings {
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
