import type { z } from "zod";
import type { runtimeRegistrationV2Schema, runtimeExitV2Schema, runtimeLoginAckSchema } from "@oddpath/qa-execution-contract";

export interface BrowserRuntimeRepository {
  saveConsentOwned(userId:string,projectId:string,executionId:string,epoch:string,saveLogin:boolean):Promise<unknown>;
  captureState(connectionId:string,executionId:string,lease:{claimId:string;leaseToken:string},body:unknown):Promise<unknown>;
  restoreState(connectionId:string,executionId:string,lease:{claimId:string;leaseToken:string}):Promise<unknown>;
  begin(connectionId: string, executionId: string, lease: { claimId: string; leaseToken: string }, input: z.infer<typeof runtimeRegistrationV2Schema>): Promise<unknown>;
  status(connectionId: string, executionId: string): Promise<unknown>;
  requestStop(connectionId: string, executionId: string): Promise<unknown>;
  exit(connectionId: string, executionId: string, input: z.infer<typeof runtimeExitV2Schema>): Promise<unknown>;
  loginOwned(userId: string, projectId: string, executionId: string, epoch: string, action: 'BEGIN' | 'COMPLETE' | 'CHECK'): Promise<unknown>;
  loginAck(connectionId: string, executionId: string, lease: { claimId: string; leaseToken: string }, input: z.infer<typeof runtimeLoginAckSchema>): Promise<unknown>;
  requestOwnerStop(userId: string, projectId?: string): Promise<boolean>;
  owned(userId: string, projectId: string, executionId: string): Promise<{
    runtimeId: string; state: string; stopRequestedAt: Date | null; exitObservedAt: Date | null;
    loginPhase?: string; loginEpoch?: string | null; loginDeadlineAt?: Date | null;
    saveLoginConsentAt?: Date|null;savedLoginId?:string|null;
    authenticationKind?:string;
    execution: { id: string; deadlineAt: Date; leaseExpiresAt: Date | null; status: string; authorization: { bindingHash: string | null } };
  }>;
  reap(): Promise<number>;
}
