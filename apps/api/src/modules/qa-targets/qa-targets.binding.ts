import { targetDefinitionSchema, targetSnapshotV2Schema, type TargetSnapshotV2 } from "@oddpath/qa-execution-contract";
import { hashCanonicalJson } from "../../lib/canonical-json.js";
import { AppError } from "../../lib/errors.js";
import type { TargetRevisionRecord } from "./qa-targets.types.js";

export function targetSnapshot(record: TargetRevisionRecord): TargetSnapshotV2 {
  const parsed = targetDefinitionSchema.safeParse(record.definition);
  if (!parsed.success || hashCanonicalJson(parsed.data) !== record.targetHash) {
    throw new AppError("Target revision integrity check failed.", 409, "QA_TARGET_REVISION_INVALID");
  }
  const snapshot = targetSnapshotV2Schema.safeParse({
    ...parsed.data,
    revision: record.revision,
    revisionId: record.id,
    targetId: record.targetId,
    targetHash: record.targetHash,
  });
  if (!snapshot.success) throw new AppError("Target revision integrity check failed.", 409, "QA_TARGET_REVISION_INVALID");
  return snapshot.data;
}

export function requireTargetRevision(record: TargetRevisionRecord | null) {
  if (!record) throw new AppError("QA target was not found.", 404, "QA_TARGET_NOT_FOUND");
  return record;
}
