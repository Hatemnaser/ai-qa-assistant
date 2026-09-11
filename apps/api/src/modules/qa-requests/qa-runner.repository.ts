import type { ProfileManifestV1 } from "@oddpath/qa-execution-contract";

import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { AppError } from "../../lib/errors.js";
import type { QaRunnerRepository } from "./qa-runner.types.js";

export function createQaRunnerRepository(database: typeof prisma = prisma): QaRunnerRepository {
  return {
    async upsertRegistration(input) {
      const connection = await database.projectConnectionToken.findFirst({
        select: { id: true },
        where: {
          id: input.connectionTokenId,
          projectId: input.projectId,
          revokedAt: null,
        },
      });
      if (!connection) {
        throw new AppError("Runner connection was not found.", 401, "CONNECTION_TOKEN_INVALID");
      }
      return database.qaRunnerRegistration.upsert({
        create: {
          connectionTokenId: input.connectionTokenId,
          displayName: input.registration.displayName,
          executorKeys: input.registration.executorKeys,
          instanceId: input.registration.instanceId,
          protocolVersions: input.registration.protocolVersions,
          publicProfiles: toJson(input.registration.profiles),
          projectId: input.projectId,
          runnerVersion: input.registration.runnerVersion,
        },
        update: {
          displayName: input.registration.displayName,
          executorKeys: input.registration.executorKeys,
          lastSeenAt: new Date(),
          protocolVersions: input.registration.protocolVersions,
          publicProfiles: toJson(input.registration.profiles),
          runnerVersion: input.registration.runnerVersion,
        },
        where: {
          connectionTokenId_instanceId: {
            connectionTokenId: input.connectionTokenId,
            instanceId: input.registration.instanceId,
          },
        },
        select: { id: true, lastSeenAt: true },
      });
    },

    async listRegistrations(projectId) {
      return database.qaRunnerRegistration.findMany({
        orderBy: [{ lastSeenAt: "desc" }, { id: "desc" }],
        select: {
          displayName: true,
          executorKeys: true,
          id: true,
          instanceId: true,
          lastSeenAt: true,
          protocolVersions: true,
          publicProfiles: true,
          runnerVersion: true,
        },
        where: {
          projectId,
          connectionToken: {
            revokedAt: null,
            OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
          },
        },
      });
    },
  };
}

export const qaRunnerRepository = createQaRunnerRepository();

function toJson(value: ProfileManifestV1[]) {
  return value as Prisma.InputJsonValue;
}
