import type {
  ProfileManifest,
  RunnerRegistration,
} from "@oddpath/qa-execution-contract";

export interface QaRunnerRepository {
  listRegistrations(projectId: string): Promise<Array<{
    id: string;
    instanceId: string;
    displayName: string;
    runnerVersion: string;
    protocolVersions: number[];
    executorKeys: string[];
    publicProfiles: unknown;
    lastSeenAt: Date;
  }>>;
  upsertRegistration(input: {
    connectionTokenId: string;
    projectId: string;
    registration: Omit<RunnerRegistration, "profiles"> & {
      profiles: ProfileManifest[];
    };
  }): Promise<{ id: string; lastSeenAt: Date }>;
}
