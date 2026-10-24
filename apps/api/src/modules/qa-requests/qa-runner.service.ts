import {
  profileManifestSchema,
  runnerRegistrationSchema,
  runnerRegistrationReceiptV1Schema,
  runnerRegistrationReceiptV2Schema,
  type RunnerRegistration,
} from "@oddpath/qa-execution-contract";

import type { QaIntegrationAuth } from "../project-connections/project-connections.middleware.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import { resolveProfileManifest } from "./qa-execution-recipes.repository.js";
import { qaRunnerRepository } from "./qa-runner.repository.js";
import type { QaRunnerRepository } from "./qa-runner.types.js";
import { env } from "../../config/env.js";

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
  async function register(auth: QaIntegrationAuth, rawInput: RunnerRegistration) {
    const input = runnerRegistrationSchema.parse(rawInput);
    const profiles = input.profiles.map(resolveProfileManifest);
    const registration = await repository.upsertRegistration({
      connectionTokenId: auth.connectionId,
      projectId: auth.projectId,
      registration: { ...input, profiles },
    });
    const receipt = {
      heartbeatAfterMs: HEARTBEAT_AFTER_MS,
      profiles,
      registeredAt: registration.lastSeenAt.toISOString(),
      registrationId: registration.id,
      schemaVersion: input.schemaVersion,
    };
    return input.schemaVersion === 2
      ? runnerRegistrationReceiptV2Schema.parse({ ...receipt, projectId: auth.projectId })
      : runnerRegistrationReceiptV1Schema.parse(receipt);
  }

  async function listProfiles(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const registrations = await repository.listRegistrations(projectId);
    const currentTime = now().getTime();
    return registrations.flatMap((registration) => {
      const online = currentTime - registration.lastSeenAt.getTime() <= ONLINE_WINDOW_MS;
      const profiles = profileManifestSchema.array().safeParse(registration.publicProfiles);
      if (!profiles.success) return [];
      return profiles.data.map((profile) => {
        const compatible = registration.protocolVersions.includes(profile.schemaVersion)
          && (profile.schemaVersion === 1 || env.qaExecutionV2Enabled)
          && (profile.schemaVersion === 1 || profile.authentication.kind === 'NONE'
            || (profile.authentication.kind === 'MANUAL' && env.qaManualLoginEnabled)
            || (profile.authentication.kind === 'SAVED_STATE' && env.qaSavedLoginEnabled))
          && registration.executorKeys.includes(profile.executorKey);
        const status = !compatible ? "INCOMPATIBLE" : online ? "ONLINE" : "OFFLINE";
        return ({
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
        protocolVersion: profile.schemaVersion,
        ...(profile.schemaVersion === 2 ? { target: profile.target, authentication: profile.authentication, executionLimits: profile.executionLimits } : {}),
        valueRefs: profile.valueReferences.map(({ key, secret }) => ({ name: key, secret })),
        });
      });
    });
  }

  return { listProfiles, register };
}

export const qaRunnerService = createQaRunnerService({
  projectAccess: projectAccessService,
  repository: qaRunnerRepository,
});
