import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import {
  accountDataDeletionCoordinator,
  type AccountDataDeletionCoordinator,
} from "./account-data-deletion.js";
import type { AccountRepository } from "./account.types.js";

export const ACCOUNT_DELETION_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
});

export function createPrismaAccountRepository(
  database: typeof prisma = prisma,
  dataDeletion: AccountDataDeletionCoordinator = accountDataDeletionCoordinator
): AccountRepository {
  return {
    async deleteAccountData(userId) {
      await database.$transaction(
        async (tx) => {
          const deleted = await dataDeletion.deleteInTransaction(tx, userId);

          if (deleted.count !== 1) {
            throw new Error("Authenticated account disappeared during deletion.");
          }
        },
        ACCOUNT_DELETION_TRANSACTION_OPTIONS
      );
    },

    async findAccountCredentials(userId) {
      return database.user.findUnique({
        select: {
          id: true,
          passwordHash: true,
        },
        where: {
          id: userId,
        },
      });
    },
  };
}

export const accountRepository = createPrismaAccountRepository();
