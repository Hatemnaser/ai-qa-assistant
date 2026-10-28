import {env} from '../../config/env.js';
import { type ProfileManifestV2 } from "@oddpath/qa-execution-contract";
import { Prisma } from "../../generated/prisma/client.js";
import { hashCanonicalJson } from "../../lib/canonical-json.js";
import { AppError } from "../../lib/errors.js";
import { targetSnapshot } from "./qa-targets.binding.js";
import { lockQaTarget } from "./qa-targets.repository.js";

export async function requireApprovedTarget(tx: Prisma.TransactionClient, projectId: string, profile: ProfileManifestV2, now: () => Date, verificationId?: string) {
  if (env.qaClosedRehearsalEnabled && profile.environmentKind === 'PRODUCTION') throw new AppError('Production targets are outside the closed browser rehearsal.',409,'QA_CLOSED_REHEARSAL_TARGET');
  await lockQaTarget(tx, profile.target.targetId);
  const target = await tx.qaTarget.findFirst({ where: { id: profile.target.targetId, projectId } });
  if (!target || target.currentRevision !== profile.target.revision) throw new AppError("The target changed or is outside this project.", 409, "QA_TARGET_APPROVAL_CHANGED");
  const revision = await tx.qaTargetRevision.findFirst({ where: { id: profile.target.revisionId, targetId: target.id, revision: target.currentRevision } });
  if (!revision || hashCanonicalJson(targetSnapshot(revision)) !== hashCanonicalJson(profile.target)) throw new AppError("The approved target snapshot changed.", 409, "QA_TARGET_APPROVAL_CHANGED");
  const verification = await tx.qaTargetVerification.findFirst({ where: { ...(verificationId ? { id: verificationId } : {}), revisionId: revision.id, verifiedAt: { not: null }, validUntil: { gt: now() } }, orderBy: { verifiedAt: "desc" } });
  // Read the clock after both the advisory lock and the proof query return.
  return requireCurrentTargetVerification(verification, now());
}

export function requireCurrentTargetVerification<T extends { validUntil: Date | null }>(verification: T | null, currentTime: Date): T {
  if (!verification || !verification.validUntil || verification.validUntil <= currentTime) {
    throw new AppError("The target needs current ownership verification.", 409, "QA_TARGET_VERIFICATION_REQUIRED");
  }
  return verification;
}
