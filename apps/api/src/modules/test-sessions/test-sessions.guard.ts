import type { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";

// Lock order is project lifecycle -> Chat/TestSession -> QA request on every transport.
export async function lockTestProject(tx: Prisma.TransactionClient, projectId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:project-lifecycle:${projectId}`}, 0))`;
}

export async function lockTestSession(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:chat:${sessionId}`}, 0))`;
}

export async function lockQaSessionScope(tx: Prisma.TransactionClient, requestId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('oddpath:project-lifecycle:' || "projectId", 0)) FROM "QaRequest" WHERE "id" = ${requestId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('oddpath:chat:' || "testSessionId", 0)) FROM "QaRequest" WHERE "id" = ${requestId} AND "testSessionId" IS NOT NULL`;
}

export async function assertCurrentTestRequest(
  tx: Prisma.TransactionClient,
  request: { id: string; testSessionId?: string | null },
  options: { allowPreparation?: boolean; processingExecutionId?: string } = {}
) {
  if (!request.testSessionId) return;
  const session = await tx.testSession.findUnique({ where: { id: request.testSessionId } });
  if (!session || session.archivedAt || session.currentRequestId !== request.id) {
    throw new AppError("This is not the current active Test request.", 409, "TEST_REQUEST_NOT_CURRENT");
  }
  const activeSibling = await tx.qaRequest.findFirst({
    select: { id: true },
    where: {
      testSessionId: session.id,
      id: { not: request.id },
      OR: [
        { runs: { some: { status: { in: ["CREATED", "ACTIVE"] } } } },
        { executions: { some: { status: { in: ["PENDING", "PROCESSING"] } } } },
      ],
    },
  });
  if (activeSibling) throw new AppError("Another request is active in this Test.", 409, "TEST_SESSION_BUSY");
  const [activeRun, activeOperation] = await Promise.all([
    tx.qaRun.findFirst({ select: { id: true }, where: { requestId: request.id, status: { in: ["CREATED", "ACTIVE"] } } }),
    tx.qaGenerationExecution.findFirst({ select: { id: true }, where: {
      requestId: request.id, status: { in: ["PENDING", "PROCESSING"] },
      ...(options.processingExecutionId ? { id: { not: options.processingExecutionId } } : {}),
    } }),
  ]);
  if (activeRun || activeOperation) throw new AppError("Wait for active Test work to finish.", 409, "TEST_SESSION_BUSY");
  if (!options.allowPreparation) {
    const preparing = await tx.testSessionPreparation.findFirst({
      select: { id: true },
      where: { sessionId: session.id, status: { in: ["CHECKLIST", "RECIPE", "REVIEW"] } },
    });
    if (preparing) throw new AppError("Wait for Test preparation to finish.", 409, "TEST_SESSION_PREPARING");
  }
}
