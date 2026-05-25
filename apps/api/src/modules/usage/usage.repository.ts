import { prisma } from "../../db/prisma.js";
import type {
  UsageCountInput,
  UsageEventRecord,
  UsageListInput,
  UsageRecordInput,
  UsageUpdateInput,
} from "./usage.types.js";

export interface UsageRepository {
  countUsage(input: UsageCountInput): Promise<number>;
  listUsageEvents(input: UsageListInput): Promise<UsageEventRecord[]>;
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

    async listUsageEvents(input) {
      return prisma.usageEvent.findMany({
        orderBy: {
          createdAt: "desc",
        },
        select: {
          attachmentCount: true,
          createdAt: true,
          creditsReserved: true,
          creditsUsed: true,
          estimatedOutputTokens: true,
          estimatedPromptTokens: true,
          estimatedTotalTokens: true,
          fileCount: true,
          id: true,
          imageCount: true,
          mode: true,
          model: true,
          modelRoutingSource: true,
          outputTokens: true,
          promptTokens: true,
          provider: true,
          status: true,
          totalTokens: true,
          units: true,
          workflowIntent: true,
          workflowSource: true,
        },
        take: 200,
        where: buildUsageListWhere(input),
      });
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

function buildUsageListWhere(input: UsageListInput) {
  const base = {
    action: input.action,
    createdAt: {
      gte: input.since,
    },
  };

  if (input.userId) {
    return {
      ...base,
      userId: input.userId,
    };
  }

  const identityFilters: Array<{ guestId: string } | { ipHash: string }> = [];

  if (input.guestId) {
    identityFilters.push({
      guestId: input.guestId,
    });
  }

  if (input.ipHash) {
    identityFilters.push({
      ipHash: input.ipHash,
    });
  }

  if (identityFilters.length === 0) {
    return {
      ...base,
      id: "__no_usage_identity__",
    };
  }

  return {
    ...base,
    OR: identityFilters,
  };
}

export const usageRepository = createPrismaUsageRepository();
