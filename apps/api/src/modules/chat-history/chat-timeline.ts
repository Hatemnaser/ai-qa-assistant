import type { Prisma } from "../../generated/prisma/client.js";

/** Caller holds the Chat advisory lock; allocation and the record write share a transaction. */
export async function nextTimelinePosition(tx: Prisma.TransactionClient, chatId: string) {
  const chat = await tx.chat.update({
    where: { id: chatId },
    data: { nextTimelinePosition: { increment: 1 } },
    select: { nextTimelinePosition: true },
  });
  return chat.nextTimelinePosition - 1;
}

export async function nextQaTimelinePosition(tx: Prisma.TransactionClient, requestId: string) {
  const request = await tx.qaRequest.findUnique({ where: { id: requestId }, select: { testSessionId: true } });
  return request?.testSessionId ? nextTimelinePosition(tx, request.testSessionId) : null;
}
