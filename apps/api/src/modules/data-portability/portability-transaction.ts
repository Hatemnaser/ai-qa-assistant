import { Prisma } from "../../generated/prisma/client.js";

export const PORTABILITY_SERIALIZABLE_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 10_000,
  timeout: 60_000,
});

export const PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS = Object.freeze({
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  maxWait: 10_000,
  timeout: 30_000,
});

export const PORTABILITY_CLEANUP_TRANSACTION_OPTIONS = Object.freeze({
  maxWait: 10_000,
  timeout: 30_000,
});

export async function withSerializableTransactionRetry<T>(
  operation: () => Promise<T>
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSerializationConflict(error) || attempt === 2) throw error;
    }
  }

  throw new Error("Unreachable serializable transaction retry state.");
}

function isSerializationConflict(error: unknown) {
  if (!error || typeof error !== "object") return false;
  const code = (error as Record<string, unknown>).code;
  return code === "P2034" || code === "40001";
}
