import type {
  ProfileManifestV1,
  RunnerRegistrationV1,
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
    registration: Omit<RunnerRegistrationV1, "profiles"> & {
      profiles: ProfileManifestV1[];
    };
  }): Promise<{ id: string; lastSeenAt: Date }>;
}
