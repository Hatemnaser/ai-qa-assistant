import type { TargetDefinition, TargetSnapshotV2 } from "@oddpath/qa-execution-contract";

export interface TargetRevisionRecord {
  id: string;
  targetId: string;
  revision: number;
  definition: unknown;
  targetHash: string;
}
export interface TargetVerificationRecord {
  id: string;
  revisionId: string;
  method: string;
  challengeHash: string;
  expiresAt: Date;
  verifiedAt: Date | null;
  validUntil: Date | null;
}
export interface QaTargetsRepository {
  list(projectId: string): Promise<unknown[]>;
  getRevision(projectId: string, targetId: string): Promise<TargetRevisionRecord | null>;
  create(input: { userId: string; projectId: string; label: string; definition: TargetDefinition }): Promise<TargetSnapshotV2>;
  revise(input: { userId: string; projectId: string; targetId: string; expectedRevision: number; label: string; definition: TargetDefinition }): Promise<TargetSnapshotV2>;
  challenge(input: { projectId: string; targetId: string; expectedRevision: number; method: string; challengeHash: string; expiresAt: Date }): Promise<TargetVerificationRecord>;
  getVerification(projectId: string, targetId: string, verificationId: string): Promise<TargetVerificationRecord | null>;
  confirm(input: { projectId: string; targetId: string; verificationId: string; revisionId: string; verifiedAt: Date; validUntil: Date }): Promise<void>;
}
