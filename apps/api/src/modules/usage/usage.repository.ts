import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from '../../lib/errors.js';
import { createDurableUsageLedger, durableUsagePolicy } from './usage-ledger.js';
import { aggregateQuotaUsage } from './usage-quota.js';
import { summarizeAttemptAccounting } from './usage-accounting.js';
import { logOperationalEvent } from '../../lib/operational-events.js';
import { AI_USAGE_ACTIONS as aiUsageActions } from "./usage.types.js";
import type {
  UsageCleanupStaleReservedInput,
  UsageCountInput,
  UsageEventRecord,
  UsageListInput,
  UsageRecordInput,
  UsageRepository,
  UsageReservationInput,
  UsageReservationRecord,
  UsageUpdateInput,
} from "./usage.types.js";

export function createPrismaUsageRepository(database:typeof prisma=prisma,now:()=>Date=()=>new Date()): UsageRepository {
  const ledger=createDurableUsageLedger(database,now);
  async function reconcileExpiredUsage(options:{strict?:boolean}={}){
    const pending=await database.usageEvent.findMany({where:{settlementReceipts:{some:{appliedAt:null}}},select:{id:true},take:50,orderBy:{createdAt:'asc'}});
    let count=0,failed=0;
    for(const row of pending){try{count+=await ledger.recover(row.id);}catch{failed++;logOperationalEvent('error',{event:'usage_accounting',stage:'recovery',outcome:'pending'});}}
    const expired=await database.usageEvent.findMany({where:{status:'reserved',expiresAt:{lte:now()},settlementReceipts:{none:{}}},select:{id:true},take:Math.max(0,50-pending.length),orderBy:{expiresAt:'asc'}});
    for(const row of expired)count+=await ledger.cleanup(row.id);
    if(failed&&options.strict)throw new AppError('Usage receipts remain pending. Accounting recovery failed.',503,'AI_USAGE_RECOVERY_PENDING');
    return count;
  }
  async function readUsageAccounting(id:string){
    const event=await database.usageEvent.findUniqueOrThrow({where:{id},include:{attempts:{include:{settlementReceipt:true}},settlementReceipts:true}});
    const summary=summarizeAttemptAccounting(event.fixedCredits,event.attempts);
    const pending=event.settlementReceipts.some(receipt=>!receipt.appliedAt);
    return {units:event.settlementReceipts.length?summary.units:event.units,confirmedUnits:summary.confirmedUnits,unconfirmedUnits:summary.unconfirmedUnits,
      status:pending?'pending' as const:event.status==='completed'&&!summary.unconfirmed?'settled' as const:'unconfirmed' as const,receiptRecorded:event.settlementReceipts.length>0};
  }
  return {
    beginUsageAttempt:ledger.begin,
    reconcileExpiredUsage,
    readUsageAccounting,
    async readUsageCharge(id){return (await readUsageAccounting(id)).units;},
    async cleanupStaleReservedUsage(input) {
      await reconcileExpiredUsage();
      const result = await database.usageEvent.updateMany({
        data: {
          status: "unknown",
        },
        where: {...buildStaleReservedCleanupWhere(input),expiresAt:null},
      });

      return result.count;
    },

    async countUsage(input) {
      return (await aggregateQuotaUsage(database,{...input,actions:[input.action]})).unitsUsed;
    },

    async listUsageEvents(input) {
      return database.usageEvent.findMany({
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
          providerAttempts: true,
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
      return database.usageEvent.create({
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
          providerAttempts: input.providerAttempts,
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

    async recordUsageAttempt(id) {
      await database.usageEvent.update({
        data: {
          providerAttempts: {
            increment: 1,
          },
        },
        where: {
          id,
        },
      });
    },

    async reserveUsage(input) {
      await reconcileExpiredUsage();
      return database.$transaction(
        async (tx) => {
          const lockKeys = createUsageLockKeys(input);

          for (const lockKey of lockKeys) {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('usage_quota'), hashtext(${lockKey}))`;
          }
          if(input.event.expiresAt&&input.event.expiresAt<=now())throw new AppError('AI reservation expired while waiting for capacity.',409,'AI_RESERVATION_EXPIRED');

          if (input.globalGuard) {
            const windows = [input.globalGuard, ...(input.globalGuard.additionalWindows || [])];

            for (const window of windows) {
              const globalUsage = await aggregateGlobalUsage(tx, input, window.since);

              if (
                globalUsage.requestCount + 1 > window.requestLimit ||
                globalUsage.unitsUsed + input.requestedUnits > window.creditLimit
              ) {
                return {
                  accepted: false,
                  rejectionReason: "global_limit",
                  usedAfter: globalUsage.unitsUsed,
                  usedBefore: globalUsage.unitsUsed,
                };
              }
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

          if (
            input.inFlightLimit !== undefined &&
            (await countInFlightScopeUsage(tx, input)) >= input.inFlightLimit
          ) {
            return {
              accepted: false,
              rejectionReason: "identity_in_flight",
              usedAfter: usedBefore,
              usedBefore,
            };
          }

          if(input.event.expiresAt&&input.event.expiresAt<=now())throw new AppError('AI reservation expired while checking capacity.',409,'AI_RESERVATION_EXPIRED');
          const event = await tx.usageEvent.create({
            data: {
              createdAt:now(),
              fixedCredits: input.event.fixedCredits,
              expiresAt: input.event.expiresAt,
              reservationPolicy: input.event.expiresAt?durableUsagePolicy(input):undefined,
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
              providerAttempts: input.event.providerAttempts,
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
          // The advisory locks serialize every shared quota scope. ReadCommitted
          // lets a transaction that waited for a lock observe the prior commit;
          // Serializable can retain an older snapshot and surface P2034 instead.
          isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        }
      );
    },

    async updateUsage(input) {
      if(await ledger.finalize(input))return;
      await database.usageEvent.update({
        data: {
          creditsUsed: input.creditsUsed,
          mode: input.mode,
          model: input.model,
          modelRoutingSource: input.modelRoutingSource,
          outputTokens: input.outputTokens,
          promptTokens: input.promptTokens,
          provider: input.provider,
          providerAttempts: input.providerAttempts,
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
      action: buildActionFilter(input),
      since: input.since,
      userId: input.userId,
    });
  }

  const counts = await Promise.all([
    input.guestId
      ? aggregateUsageUnits(tx, {
          action: buildActionFilter(input),
          guestId: input.guestId,
          since: input.since,
        })
      : 0,
    input.ipHash
      ? aggregateUsageUnits(tx, {
          action: buildActionFilter(input),
          ipHash: input.ipHash,
          since: input.since,
        })
      : 0,
  ]);

  return Math.max(...counts);
}

async function aggregateUsageUnits(
  tx: Prisma.TransactionClient,
  input: Omit<UsageCountInput, "action"> & {
    action: string | { in: string[] };
  }
) {
  return (await aggregateQuotaUsage(tx,{...input,actions:typeof input.action==='string'?[input.action]:input.action.in})).unitsUsed;
}

async function countInFlightScopeUsage(
  tx: Prisma.TransactionClient,
  input: UsageReservationInput
) {
  const identityFilters: Array<{ guestId: string } | { ipHash: string } | { userId: string }> = [];

  if (input.isSignedIn && input.userId) {
    identityFilters.push({ userId: input.userId });
  } else {
    if (input.guestId) identityFilters.push({ guestId: input.guestId });
    if (input.ipHash) identityFilters.push({ ipHash: input.ipHash });
  }

  if (identityFilters.length === 0) return 0;

  return tx.usageEvent.count({
    where: {
      action: buildActionFilter(input),
      createdAt: {
        gte: input.globalGuard?.staleReservedCutoff || input.since,
      },
      OR: identityFilters,
      status: "reserved",
    },
  });
}

function buildActionFilter(input: UsageReservationInput) {
  return input.scopeActions?.length
    ? { in: [...input.scopeActions] }
    : input.action;
}

async function aggregateGlobalUsage(
  tx: Prisma.TransactionClient,
  input: UsageReservationInput,
  since: Date
) {
  if (!input.globalGuard) {
    return {
      requestCount: 0,
      unitsUsed: 0,
    };
  }

  return aggregateQuotaUsage(tx,{since,actions:aiUsageActions});
}

function createUsageLockKeys(input: UsageReservationInput) {
  const keys = input.globalGuard ? ["ai_operation:global"] : [];

  if (input.isSignedIn && input.userId) {
    keys.push(`ai_operation:user:${input.userId}`);

    return keys.sort();
  }

  keys.push(
    input.guestId ? `ai_operation:guest:${input.guestId}` : "",
    input.ipHash ? `ai_operation:ip:${input.ipHash}` : ""
  );
  const filteredKeys = keys.filter(Boolean);

  return filteredKeys.length > 0 ? filteredKeys.sort() : ["ai_operation:anonymous"];
}

export function buildUsageListWhere(input: UsageListInput) {
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

  if (input.guestId) {
    return {
      ...base,
      guestId: input.guestId,
    };
  }

  if (input.ipHash) {
    return {
      ...base,
      ipHash: input.ipHash,
    };
  }

  return {
    ...base,
    id: "__no_usage_identity__",
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

export const usageRepository = createPrismaUsageRepository();
