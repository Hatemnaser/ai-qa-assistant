import { randomBytes } from "node:crypto";
import { AppError } from "../../lib/errors.js";
import { projectAccessService, type ProjectAccessService } from "../projects/project-access.service.js";
import { requireTargetRevision, targetSnapshot } from "./qa-targets.binding.js";
import { challengeHash, targetProofProbe, type TargetProofProbe } from "./qa-targets.proof.js";
import { qaTargetsRepository } from "./qa-targets.repository.js";
import { challengeTargetSchema, createTargetSchema, reviseTargetSchema } from "./qa-targets.schema.js";
import type { QaTargetsRepository } from "./qa-targets.types.js";

export function createQaTargetsService({
  repository,
  access,
  probe = targetProofProbe,
  now = () => new Date(),
}: {
  repository: QaTargetsRepository;
  access: ProjectAccessService;
  probe?: TargetProofProbe;
  now?: () => Date;
}) {
  let probesInFlight = 0;
  return {
    async list(userId: string, projectId: string) {
      await access.assertProjectAccess(userId, projectId);
      return repository.list(projectId);
    },
    async create(userId: string, projectId: string, raw: unknown) {
      await access.assertProjectAccess(userId, projectId);
      const input = createTargetSchema.parse(raw);
      return repository.create({ ...input, userId, projectId });
    },
    async revise(userId: string, projectId: string, targetId: string, raw: unknown) {
      await access.assertProjectAccess(userId, projectId);
      const input = reviseTargetSchema.parse(raw);
      return repository.revise({ ...input, userId, projectId, targetId });
    },
    async challenge(userId: string, projectId: string, targetId: string, raw: unknown) {
      await access.assertProjectAccess(userId, projectId);
      const input = challengeTargetSchema.parse(raw);
      const revision = requireTargetRevision(await repository.getRevision(projectId, targetId));
      if (revision.revision !== input.expectedRevision) {
        throw new AppError("Target changed. Refresh and review again.", 409, "QA_TARGET_VERSION_CONFLICT");
      }
      const token = randomBytes(32).toString("hex");
      const expiresAt = new Date(now().getTime() + 10 * 60_000);
      const proof = await repository.challenge({
        ...input, projectId, targetId, challengeHash: challengeHash(token), expiresAt,
      });
      const hostname = new URL(targetSnapshot(revision).baseUrl).hostname;
      return {
        id: proof.id,
        method: input.method,
        expiresAt: expiresAt.toISOString(),
        value: token,
        location: input.method === "DNS_TXT"
          ? `_oddpath-verify.${hostname}`
          : `https://${hostname}/.well-known/oddpath-verification/${proof.id}`,
      };
    },
    async verify(userId: string, projectId: string, targetId: string, verificationId: string) {
      await access.assertProjectAccess(userId, projectId);
      const revision = requireTargetRevision(await repository.getRevision(projectId, targetId));
      const proof = await repository.getVerification(projectId, targetId, verificationId);
      if (!proof || proof.revisionId !== revision.id) {
        throw new AppError("Verification challenge was not found for the current target.", 404, "QA_TARGET_VERIFICATION_NOT_FOUND");
      }
      if (proof.verifiedAt) {
        if (!proof.validUntil || proof.validUntil <= now()) {
          throw new AppError("Target ownership verification expired. Create a new challenge.", 409, "QA_TARGET_VERIFICATION_EXPIRED");
        }
        return { target: targetSnapshot(revision), verifiedAt: proof.verifiedAt.toISOString(), validUntil: proof.validUntil.toISOString() };
      }
      if (proof.expiresAt <= now()) {
        throw new AppError("Verification challenge expired.", 409, "QA_TARGET_VERIFICATION_EXPIRED");
      }
      if (probesInFlight >= 2) {
        throw new AppError("Target verification is busy. Retry later.", 429, "QA_TARGET_VERIFICATION_BUSY");
      }
      probesInFlight++;
      try {
        const hostname = new URL(targetSnapshot(revision).baseUrl).hostname;
        const values = proof.method === "DNS_TXT"
          ? await probe.dns(hostname)
          : [await probe.https(`https://${hostname}/.well-known/oddpath-verification/${proof.id}`)];
        if (!values.some((value) => challengeHash(value) === proof.challengeHash)) {
          throw new AppError("Target verification proof does not match.", 409, "QA_TARGET_VERIFICATION_FAILED");
        }
        const verifiedAt = now();
        const validUntil = new Date(verifiedAt.getTime() + 24 * 60 * 60_000);
        await repository.confirm({
          projectId, targetId, verificationId, revisionId: revision.id, verifiedAt, validUntil,
        });
        return { target: targetSnapshot(revision), verifiedAt: verifiedAt.toISOString(), validUntil: validUntil.toISOString() };
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("Target verification could not be completed.", 409, "QA_TARGET_VERIFICATION_FAILED");
      } finally {
        probesInFlight--;
      }
    },
  };
}

export const qaTargetsService = createQaTargetsService({ repository: qaTargetsRepository, access: projectAccessService });
