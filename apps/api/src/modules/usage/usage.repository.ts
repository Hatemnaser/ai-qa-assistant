import { prisma } from "../../db/prisma.js";
import type { UsageCountInput, UsageRecordInput } from "./usage.types.js";

export interface UsageRepository {
  countUsage(input: UsageCountInput): Promise<number>;
  recordUsage(input: UsageRecordInput): Promise<void>;
}

export function createPrismaUsageRepository(): UsageRepository {
  return {
    async countUsage(input) {
      return prisma.usageEvent.count({
        where: {
          action: input.action,
          createdAt: {
            gte: input.since,
          },
          guestId: input.guestId,
          ipHash: input.ipHash,
          userId: input.userId,
        },
      });
    },

    async recordUsage(input) {
      await prisma.usageEvent.create({
        data: {
          action: input.action,
          guestId: input.guestId,
          ipHash: input.ipHash,
          units: input.units,
          userId: input.userId,
        },
      });
    },
  };
}

export const usageRepository = createPrismaUsageRepository();
