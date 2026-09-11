import {
  profileManifestV1Schema,
  runnerRegistrationV1Schema,
  type RunnerRegistrationV1,
} from "@oddpath/qa-execution-contract";

import type { QaIntegrationAuth } from "../project-connections/project-connections.middleware.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { resolveProfileManifest } from "./qa-execution-recipes.repository.js";
import { qaRunnerRepository } from "./qa-runner.repository.js";
import type { QaRunnerRepository } from "./qa-runner.types.js";

const HEARTBEAT_AFTER_MS = 20_000;
const ONLINE_WINDOW_MS = 90_000;

export interface QaRunnerServiceDependencies {
  now?: () => Date;
  projectAccess: ProjectAccessService;
  repository: QaRunnerRepository;
}

export function createQaRunnerService({
  now = () => new Date(),
  projectAccess,
  repository,
}: QaRunnerServiceDependencies) {
  async function register(auth: QaIntegrationAuth, rawInput: RunnerRegistrationV1) {
    const input = runnerRegistrationV1Schema.parse(rawInput);
    const profiles = input.profiles.map(resolveProfileManifest);
    const registration = await repository.upsertRegistration({
      connectionTokenId: auth.connectionId,
      projectId: auth.projectId,
      registration: { ...input, profiles },
    });
    return {
      heartbeatAfterMs: HEARTBEAT_AFTER_MS,
      profiles,
      registeredAt: registration.lastSeenAt.toISOString(),
      registrationId: registration.id,
      schemaVersion: 1 as const,
    };
  }

  async function listProfiles(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const registrations = await repository.listRegistrations(projectId);
    const currentTime = now().getTime();
    return registrations.flatMap((registration) => {
      const compatible = registration.protocolVersions.includes(1)
        && registration.executorKeys.includes("playwright");
      const online = currentTime - registration.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
      const status = !compatible ? "INCOMPATIBLE" : online ? "ONLINE" : "OFFLINE";
      const profiles = profileManifestV1Schema.array().safeParse(registration.publicProfiles);
      if (!profiles.success) return [];
      return profiles.data.map((profile) => ({
        environmentKind: profile.environmentKind,
        evidenceKinds: profile.evidenceKinds,
        id: `${registration.id}:${profile.profileKey}`,
        key: profile.profileKey,
        label: profile.label,
        lastSeenAt: registration.lastSeenAt.toISOString(),
        manifestHash: profile.manifestHash || null,
        runnerInstanceId: registration.instanceId,
        runnerName: registration.displayName,
        runnerRegistrationId: registration.id,
        runnerVersion: registration.runnerVersion,
        status,
        supportedRecipeVersions: profile.recipeSchemaVersions,
        valueRefs: profile.valueReferences.map(({ key, secret }) => ({ name: key, secret })),
      }));
    });
  }

  return { listProfiles, register };
}

export const qaRunnerService = createQaRunnerService({
  projectAccess: projectAccessService,
  repository: qaRunnerRepository,
});
