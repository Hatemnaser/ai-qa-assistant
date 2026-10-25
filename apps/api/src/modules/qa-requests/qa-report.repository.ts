import { prisma } from "../../db/prisma.js";
import { readQaHistory, readQaBinarySources } from "./qa-report.reader.js";
import { PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS } from "../data-portability/portability-transaction.js";
import type { QaReportRepository } from "./qa-report.types.js";
export function createQaReportRepository(database: typeof prisma = prisma): QaReportRepository {
    return { async read(ownerId: string, projectId: string, now: Date, requestId?: string) {
            return database.$transaction(async (tx) => {
                const history = await readQaHistory(tx, ownerId, projectId, now, requestId);
                const sources = await readQaBinarySources(tx, ownerId, projectId, requestId);
                return { history, sources };
            }, PORTABILITY_SNAPSHOT_TRANSACTION_OPTIONS);
        } };
}
export const qaReportRepository = createQaReportRepository();
