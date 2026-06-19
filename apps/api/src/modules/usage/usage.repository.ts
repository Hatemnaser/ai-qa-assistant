import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AI_USAGE_ACTIONS as aiUsageActions } from "./usage.types.js";
import type {
  UsageCleanupStaleReservedInput,
  UsageCountInput,
  UsageEventRecord,
  UsageListInput,
  UsageRecordInput,
  UsageReservationInput,
  UsageReservationRecord,
  UsageUpdateInput,
} from "./usage.types.js";

export interface UsageRepository {
  cleanupStaleReservedUsage(input: UsageCleanupStaleReservedInput): Promise<number>;
  countUsage(input: UsageCountInput): Promise<number>;
  listUsageEvents(input: UsageListInput): Promise<UsageEventRecord[]>;
  recordUsage(input: UsageRecordInput): Promise<{ id: string }>;
  reserveUsage(input: UsageReservationInput): Promise<UsageReservationRecord>;
  updateUsage(input: UsageUpdateInput): Promise<void>;
}

export function createPrismaUsageRepository(): UsageRepository {
  return {
    async cleanupStaleReservedUsage(input) {
      const result = await prisma.usageEvent.updateMany({
        data: {
          creditsUsed: 0,
          status: "failed",
          units: 0,
        },
        where: buildStaleReservedCleanupWhere(input),
      });

      return result.count;
    },

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

    async reserveUsage(input) {
      return prisma.$transaction(
        async (tx) => {
          const lockKeys = createUsageLockKeys(input);

          for (const lockKey of lockKeys) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usage_quota'), hashtext(${lockKey}))`;
          }

          if (input.globalGuard) {
            const globalUsage = await aggregateGlobalUsage(tx, input);

            if (
              globalUsage.requestCount + 1 > input.globalGuard.requestLimit ||
              globalUsage.unitsUsed + input.requestedUnits > input.globalGuard.creditLimit
            ) {
              return {
                accepted: false,
                rejectionReason: "global_limit",
                usedAfter: globalUsage.unitsUsed,
                usedBefore: globalUsage.unitsUsed,
              };
            }
          }

          const usedBefore = await countReservedScopeUsage(tx, input);

          if (usedBefore + input.requestedUnits > input.limit) {
            return {
              accepted: false,
              rejectionReason: "identity_limit",
              usedAfter: usedBefore,
              usedBefore,
            };
          }

          const event = await tx.usageEvent.create({
            data: {
              action: input.event.action,
              attachmentCount: input.event.attachmentCount,
              creditsReserved: input.event.creditsReserved,
              creditsUsed: input.event.creditsUsed,
              estimatedOutputTokens: input.event.estimatedOutputTokens,
              estimatedPromptTokens: input.event.estimatedPromptTokens,
              estimatedTotalTokens: input.event.estimatedTotalTokens,
              fileCount: input.event.fileCount,
              guestId: input.event.guestId,
              imageCount: input.event.imageCount,
              ipHash: input.event.ipHash,
              mode: input.event.mode,
              model: input.event.model,
              modelRoutingSource: input.event.modelRoutingSource,
              outputTokens: input.event.outputTokens,
              promptTokens: input.event.promptTokens,
              provider: input.event.provider,
              status: input.event.status,
              totalTokens: input.event.totalTokens,
              units: input.event.units,
              userId: input.event.userId,
              workflowIntent: input.event.workflowIntent,
              workflowSource: input.event.workflowSource,
            },
            select: {
              id: true,
            },
          });
          const usedAfter = usedBefore + input.requestedUnits;

          return {
            accepted: true,
            eventId: event.id,
            usedAfter,
            usedBefore,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        }
      );
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

async function countReservedScopeUsage(
  tx: Prisma.TransactionClient,
  input: UsageReservationInput
) {
  if (input.isSignedIn) {
    return aggregateUsageUnits(tx, {
      action: input.action,
      since: input.since,
      userId: input.userId,
    });
  }

  const counts = await Promise.all([
    input.guestId
      ? aggregateUsageUnits(tx, {
          action: input.action,
          guestId: input.guestId,
          since: input.since,
        })
      : 0,
    input.ipHash
      ? aggregateUsageUnits(tx, {
          action: input.action,
          ipHash: input.ipHash,
          since: input.since,
        })
      : 0,
  ]);

  return Math.max(...counts);
}

async function aggregateUsageUnits(
  tx: Prisma.TransactionClient,
  input: UsageCountInput
) {
  const usage = await tx.usageEvent.aggregate({
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
}

async function aggregateGlobalUsage(
  tx: Prisma.TransactionClient,
  input: UsageReservationInput
) {
  if (!input.globalGuard) {
    return {
      requestCount: 0,
      unitsUsed: 0,
    };
  }

  const where = buildGlobalUsageWhere(input);
  const [requestCount, usage] = await Promise.all([
    tx.usageEvent.count({
      where,
    }),
    tx.usageEvent.aggregate({
      _sum: {
        units: true,
      },
      where,
    }),
  ]);

  return {
    requestCount,
    unitsUsed: usage._sum.units || 0,
  };
}

function createUsageLockKeys(input: UsageReservationInput) {
  const keys = input.globalGuard ? ["ai_operation:global"] : [];

  if (input.isSignedIn && input.userId) {
    keys.push(`${input.action}:user:${input.userId}`);

    return keys.sort();
  }

  keys.push(
    input.guestId ? `${input.action}:guest:${input.guestId}` : "",
    input.ipHash ? `${input.action}:ip:${input.ipHash}` : ""
  );
  const filteredKeys = keys.filter(Boolean);

  return filteredKeys.length > 0 ? filteredKeys.sort() : [`${input.action}:anonymous`];
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

function buildStaleReservedCleanupWhere(input: UsageCleanupStaleReservedInput) {
  const base = {
    action: input.action,
    createdAt: {
      lt: input.cutoff,
    },
    status: "reserved",
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

function buildGlobalUsageWhere(input: UsageReservationInput) {
  const globalGuard = input.globalGuard;

  if (!globalGuard) {
    return {
      id: "__no_global_guard__",
    };
  }

  return {
    action: {
      in: [...aiUsageActions],
    },
    createdAt: {
      gte: globalGuard.since,
    },
    OR: [
      {
        status: {
          not: "reserved",
        },
      },
      {
        createdAt: {
          gte: globalGuard.staleReservedCutoff,
        },
      },
    ],
    status: {
      not: "failed",
    },
  };
}

export const usageRepository = createPrismaUsageRepository();
