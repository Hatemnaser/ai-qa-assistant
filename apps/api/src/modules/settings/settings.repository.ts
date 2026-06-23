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
      return prisma.$transaction(async (tx) => {
        const settings = await tx.userSettings.upsert({
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

        await tx.user.update({
          data: {
            locale: input.language,
          },
          where: {
            id: userId,
          },
        });

        return settings;
      });
    },
  };
}

export const settingsRepository = createPrismaSettingsRepository();
