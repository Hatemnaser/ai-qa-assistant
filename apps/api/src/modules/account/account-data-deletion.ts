import type { Prisma } from "../../generated/prisma/client.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';
import { lockBrowserDeletion,revokeDeletedBrowserScope } from '../browser-auth/browser-auth.deletion.js';
import { anonymizeDeletedUsage,lockUsageDeletion } from '../usage/usage-privacy.js';

export interface UnverifiedSessionlessUserDeletionGuard {
  createdAtOnOrBefore: Date;
  kind: "unverified-sessionless";
}

export type UserDataDeletionGuard = UnverifiedSessionlessUserDeletionGuard;

export interface UserDataDeletionResult {
  count: number;
}

export interface AccountDataDeletionCoordinator {
  deleteInTransaction(
    tx: Prisma.TransactionClient,
    userId: string,
    guard?: UserDataDeletionGuard
  ): Promise<UserDataDeletionResult>;
}

/**
 * Removes one user's full relational graph while preserving the durable
 * object-deletion outbox. A supplied guard is re-evaluated by the final
 * DELETE, so retention cleanup can fail closed if eligibility changes while
 * the surrounding transaction is running.
 */
export const accountDataDeletionCoordinator: AccountDataDeletionCoordinator = {
  async deleteInTransaction(tx, userId, guard) {
    await lockUsageDeletion(tx,userId);
    const hasSavedTable=await lockBrowserDeletion(tx,userId);
    if(hasSavedTable&&guard&&!await tx.user.findFirst({where:{id:userId,createdAt:{lte:guard.createdAtOnOrBefore},emailVerifiedAt:null,sessions:{none:{}}},select:{id:true}}))return {count:0};
    if (env.qaBrowserRuntimeEnabled && await tx.qaBrowserRuntime.findFirst({ where: { state: { not: 'STOP_CONFIRMED' }, execution: { project: { ownerId: userId } } }, select: { runtimeId: true } })) {
      throw new AppError('Browser Stop must be confirmed before deleting account data.', 409, 'BROWSER_STOP_REQUIRED');
    }
    const storedAssets = await tx.storedAsset.findMany({
      select: { objectKey: true, uploadExpiresAt: true },
      where: { ownerId: userId },
    });

    await enqueueAssetDeletionJobs(tx, storedAssets);

    // Break restrictive attachment/source references before StoredAsset.
    // Parent messages/documents are removed by the user's cascading graph.
    await tx.messageAttachment.deleteMany({
      where: {
        asset: { ownerId: userId },
      },
    });
    await tx.qaEvidenceAsset.deleteMany({
      where: {
        asset: { ownerId: userId },
      },
    });
    await tx.projectDocument.updateMany({
      data: { sourceAssetId: null },
      where: {
        sourceAsset: { ownerId: userId },
      },
    });
    await tx.storedAsset.deleteMany({
      where: { ownerId: userId },
    });

    // Remove identifying analytics while preserving finite, ownerless global
    // quota exposure and the original consumption key for in-flight receipts.
    await tx.aiUsageLog.deleteMany({
      where: { userId },
    });
    await anonymizeDeletedUsage(tx,userId,new Date());

    if(hasSavedTable)await revokeDeletedBrowserScope(tx,userId);
    return tx.user.deleteMany({
      where:
        guard === undefined
          ? { id: userId }
          : {
              AND: [
                { id: userId },
                {
                  createdAt: { lte: guard.createdAtOnOrBefore },
                  emailVerifiedAt: null,
                  sessions: { none: {} },
                },
              ],
            },
    });
  },
};
