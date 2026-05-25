import { prisma } from "../../db/prisma.js";
import type { UsageCountInput, UsageRecordInput, UsageUpdateInput } from "./usage.types.js";

export interface UsageRepository {
  countUsage(input: UsageCountInput): Promise<number>;
  recordUsage(input: UsageRecordInput): Promise<{ id: string }>;
  updateUsage(input: UsageUpdateInput): Promise<void>;
}

export function createPrismaUsageRepository(): UsageRepository {
  return {
    async countUsage(input) {
      const usage = await prisma.usageEvent.aggregate({
        _sum: {
          units: true,
        },
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

      return usage._sum.units || 0;
    },

    async recordUsage(input) {
      return prisma.usageEvent.create({
        data: {
          action: input.action,
          attachmentCount: input.attachmentCount,
          creditsReserved: input.creditsReserved,
          creditsUsed: input.creditsUsed,
          estimatedOutputTokens: input.estimatedOutputTokens,
          estimatedPromptTokens: input.estimatedPromptTokens,
          estimatedTotalTokens: input.estimatedTotalTokens,
          fileCount: input.fileCount,
          guestId: input.guestId,
          imageCount: input.imageCount,
          ipHash: input.ipHash,
          mode: input.mode,
          model: input.model,
          modelRoutingSource: input.modelRoutingSource,
          outputTokens: input.outputTokens,
          promptTokens: input.promptTokens,
          provider: input.provider,
          status: input.status,
          totalTokens: input.totalTokens,
          units: input.units,
          userId: input.userId,
          workflowIntent: input.workflowIntent,
          workflowSource: input.workflowSource,
        },
        select: {
          id: true,
        },
      });
    },

    async updateUsage(input) {
      await prisma.usageEvent.update({
        data: {
          creditsUsed: input.creditsUsed,
          mode: input.mode,
          model: input.model,
          modelRoutingSource: input.modelRoutingSource,
          outputTokens: input.outputTokens,
          promptTokens: input.promptTokens,
          provider: input.provider,
          status: input.status,
          totalTokens: input.totalTokens,
          units: input.units,
          workflowIntent: input.workflowIntent,
          workflowSource: input.workflowSource,
        },
        where: {
          id: input.id,
        },
      });
    },
  };
}

export const usageRepository = createPrismaUsageRepository();
