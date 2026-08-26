import type { Prisma } from "../../generated/prisma/client.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";

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
    await tx.projectDocument.updateMany({
      data: { sourceAssetId: null },
      where: {
        sourceAsset: { ownerId: userId },
      },
    });
    await tx.storedAsset.deleteMany({
      where: { ownerId: userId },
    });

    // Usage rows intentionally do not survive as indirectly identifying
    // analytics. The remaining user graph is removed through FK cascades.
    await tx.aiUsageLog.deleteMany({
      where: { userId },
    });
    await tx.usageEvent.deleteMany({
      where: { userId },
    });

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
