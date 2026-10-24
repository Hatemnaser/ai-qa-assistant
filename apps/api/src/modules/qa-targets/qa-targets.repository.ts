import { targetDefinitionSchema } from "@oddpath/qa-execution-contract";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { hashCanonicalJson } from "../../lib/canonical-json.js";
import { AppError } from "../../lib/errors.js";
import { requireTargetRevision, targetSnapshot } from "./qa-targets.binding.js";
import type { QaTargetsRepository } from "./qa-targets.types.js";

export async function lockQaTarget(tx: Prisma.TransactionClient, targetId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-target:${targetId}`}, 0))`;
}

export function createQaTargetsRepository(database: typeof prisma = prisma, now: () => Date = () => new Date()): QaTargetsRepository {
  async function current(tx: Prisma.TransactionClient, projectId: string, targetId: string) {
    const target = await tx.qaTarget.findFirst({ where: { id: targetId, projectId } });
    if (!target) throw new AppError("QA target was not found.", 404, "QA_TARGET_NOT_FOUND");
    const revision = requireTargetRevision(await tx.qaTargetRevision.findUnique({ where: { targetId_revision: { targetId, revision: target.currentRevision } } }));
    return { target, revision };
  }
  return {
    async list(projectId) {
      const targets = await database.qaTarget.findMany({ where: { projectId }, orderBy: { createdAt: "asc" }, take: 50, include: { revisions: { orderBy: { revision: "desc" }, take: 1 } } });
      return targets.map(({ label, revisions }) => ({ label, ...targetSnapshot(requireTargetRevision(revisions[0] || null)) }));
    },
    async getRevision(projectId, targetId) {
      const target = await database.qaTarget.findFirst({ where: { id: targetId, projectId }, select: { currentRevision: true } });
      return target ? database.qaTargetRevision.findUnique({ where: { targetId_revision: { targetId, revision: target.currentRevision } } }) : null;
    },
    async create(input) {
      return database.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:qa-target-project:${input.projectId}`}, 0))`;
        if (await tx.qaTarget.count({ where: { projectId: input.projectId } }) >= 50) throw new AppError("QA target limit reached.", 409, "QA_TARGET_LIMIT_REACHED");
        const definition = targetDefinitionSchema.parse(input.definition);
        const target = await tx.qaTarget.create({ data: { label: input.label, projectId: input.projectId } });
        const revision = await tx.qaTargetRevision.create({ data: { targetId: target.id, revision: 1, definition: definition as Prisma.InputJsonValue, targetHash: hashCanonicalJson(definition), authorityUserId: input.userId } });
        return targetSnapshot(revision);
      });
    },
    async revise(input) {
      return database.$transaction(async (tx) => {
        await lockQaTarget(tx, input.targetId);
        const { target } = await current(tx, input.projectId, input.targetId);
        if (target.currentRevision !== input.expectedRevision) throw new AppError("Target changed. Refresh and review again.", 409, "QA_TARGET_VERSION_CONFLICT");
        if (target.currentRevision >= 100) throw new AppError("Target revision limit reached.", 409, "QA_TARGET_REVISION_LIMIT_REACHED");
        const definition = targetDefinitionSchema.parse(input.definition);
        const revision = await tx.qaTargetRevision.create({ data: { targetId: target.id, revision: target.currentRevision + 1, definition: definition as Prisma.InputJsonValue, targetHash: hashCanonicalJson(definition), authorityUserId: input.userId } });
        await tx.qaTarget.update({ where: { id: target.id }, data: { label: input.label, currentRevision: revision.revision } });
        return targetSnapshot(revision);
      });
    },
    async challenge(input) {
      return database.$transaction(async (tx) => {
        await lockQaTarget(tx, input.targetId);
        const { revision } = await current(tx, input.projectId, input.targetId);
        if (revision.revision !== input.expectedRevision) throw new AppError("Target changed. Refresh and review again.", 409, "QA_TARGET_VERSION_CONFLICT");
        const latest = await tx.qaTargetVerification.findFirst({ where: { revisionId: revision.id }, orderBy: { createdAt: "desc" } });
        if (latest && latest.createdAt.getTime() > now().getTime() - 60_000) throw new AppError("Wait before creating another verification challenge.", 429, "QA_TARGET_VERIFICATION_RATE_LIMITED");
        if (await tx.qaTargetVerification.count({ where: { revisionId: revision.id } }) >= 20) throw new AppError("Target verification limit reached. Create a new reviewed revision.", 409, "QA_TARGET_VERIFICATION_LIMIT_REACHED");
        return tx.qaTargetVerification.create({ data: { revisionId: revision.id, method: input.method, challengeHash: input.challengeHash, expiresAt: input.expiresAt } });
      });
    },
    async getVerification(projectId, targetId, verificationId) {
      return database.qaTargetVerification.findFirst({ where: { id: verificationId, revision: { targetId, target: { projectId } } } });
    },
    async confirm(input) {
      await database.$transaction(async (tx) => {
        await lockQaTarget(tx, input.targetId);
        const { revision } = await current(tx, input.projectId, input.targetId);
        if (revision.id !== input.revisionId) throw new AppError("Target changed during verification.", 409, "QA_TARGET_VERSION_CONFLICT");
        const updated = await tx.qaTargetVerification.updateMany({ where: { id: input.verificationId, revisionId: revision.id, verifiedAt: null, expiresAt: { gt: input.verifiedAt } }, data: { verifiedAt: input.verifiedAt, validUntil: input.validUntil } });
        if (updated.count !== 1) throw new AppError("Verification challenge expired or was already used.", 409, "QA_TARGET_VERIFICATION_EXPIRED");
      });
    },
  };
}
export const qaTargetsRepository = createQaTargetsRepository();
