import { prisma } from "../../db/prisma.js";
import type { UserSettingsInput } from "./settings.types.js";

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

export function createPrismaSettingsRepository(): SettingsRepository {
  return {
    async getUserSettings(userId) {
      return prisma.userSettings.findUnique({
        where: {
          userId,
        },
      });
    },

    async upsertUserSettings(userId, input) {
      return prisma.userSettings.upsert({
        create: {
          defaultModel: input.defaultModel,
          language: input.language,
          theme: input.theme,
          userId,
        },
        update: {
          defaultModel: input.defaultModel,
          language: input.language,
          theme: input.theme,
        },
        where: {
          userId,
        },
      });
    },
  };
}

export const settingsRepository = createPrismaSettingsRepository();
