import { createHash, randomBytes } from "node:crypto";

import { prisma } from "../../db/prisma.js";
import { DATA_LIMITS } from "../../config/data-limits.js";
import { AppError } from "../../lib/errors.js";
import {
  projectAccessService,
  type ProjectAccessService,
} from "../projects/project-access.service.js";
import type {
  CreateProjectConnectionInput,
  QaConnectionScope,
} from "./project-connections.schema.js";

const TOKEN_PREFIX = "odp_live";
const AGENT_SCOPES: QaConnectionScope[] = ["evidence:write", "qa:read", "qa:write"];
const RUNNER_SCOPES: QaConnectionScope[] = [
  "evidence:write",
  "execution:claim",
  "execution:write",
  "qa:read",
];

export interface ProjectConnectionsServiceDependencies {
  database?: typeof prisma;
  now?: () => Date;
  projectAccess: ProjectAccessService;
  randomToken?: () => string;
}

export function createProjectConnectionsService({
  database = prisma,
  now = () => new Date(),
  projectAccess,
  randomToken = () => randomBytes(32).toString("base64url"),
}: ProjectConnectionsServiceDependencies) {
  async function listConnections(userId: string, projectId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const connections = await database.projectConnectionToken.findMany({
      orderBy: { createdAt: "desc" },
      where: { ownerId: userId, projectId },
    });
    return connections.map(toConnectionDto);
  }

  async function createConnection(
    userId: string,
    projectId: string,
    input: CreateProjectConnectionInput
  ) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
    if (expiresAt && expiresAt <= now()) {
      throw new AppError("Connection expiry must be in the future.", 400, "CONNECTION_EXPIRY_INVALID");
    }
    const activeConnections = await database.projectConnectionToken.count({
      where: {
        ownerId: userId,
        projectId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now() } }],
      },
    });
    if (activeConnections >= DATA_LIMITS.projectConnectionsPerProject) {
      throw new AppError(
        "This project has reached its active connection limit.",
        409,
        "CONNECTION_LIMIT_REACHED"
      );
    }
    const secret = randomToken();
    const token = `${TOKEN_PREFIX}_${secret}`;
    const scopes = input.scopes
      || (input.preset === "RUNNER" ? RUNNER_SCOPES : AGENT_SCOPES);
    const connection = await database.projectConnectionToken.create({
      data: {
        expiresAt,
        name: input.name,
        ownerId: userId,
        projectId,
        scopes: [...new Set(scopes)].sort(),
        tokenHash: hashConnectionToken(token),
        tokenPrefix: token.slice(0, 20),
      },
    });
    return { connection: toConnectionDto(connection), token };
  }

  async function revokeConnection(userId: string, projectId: string, connectionId: string) {
    await projectAccess.assertProjectAccess(userId, projectId);
    const result = await database.projectConnectionToken.updateMany({
      data: { revokedAt: now() },
      where: { id: connectionId, ownerId: userId, projectId, revokedAt: null },
    });
    if (result.count === 0) {
      const existing = await database.projectConnectionToken.findFirst({
        select: { id: true, revokedAt: true },
        where: { id: connectionId, ownerId: userId, projectId },
      });
      if (!existing) throw new AppError("Connection was not found.", 404, "CONNECTION_NOT_FOUND");
    }
    return { ok: true as const };
  }

  async function authenticate(token: string) {
    const connection = await database.projectConnectionToken.findUnique({
      where: { tokenHash: hashConnectionToken(token) },
    });
    if (!connection || connection.revokedAt || (connection.expiresAt && connection.expiresAt <= now())) {
      throw new AppError("Connection token is invalid or expired.", 401, "CONNECTION_TOKEN_INVALID");
    }
    await database.projectConnectionToken.update({
      data: { lastUsedAt: now() },
      where: { id: connection.id },
    });
    return {
      connectionId: connection.id,
      ownerId: connection.ownerId,
      projectId: connection.projectId,
      scopes: connection.scopes as QaConnectionScope[],
    };
  }

  return { authenticate, createConnection, listConnections, revokeConnection };
}

export const projectConnectionsService = createProjectConnectionsService({
  projectAccess: projectAccessService,
});

export function hashConnectionToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function toConnectionDto(connection: {
  id: string;
  name: string;
  tokenPrefix: string;
  scopes: string[];
  expiresAt: Date | null;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: connection.id,
    name: connection.name,
    tokenPrefix: connection.tokenPrefix,
    scopes: connection.scopes,
    preset: connection.scopes.includes("execution:claim") ? "RUNNER" as const : "AGENT" as const,
    expiresAt: connection.expiresAt?.toISOString() || null,
    revokedAt: connection.revokedAt?.toISOString() || null,
    lastUsedAt: connection.lastUsedAt?.toISOString() || null,
    createdAt: connection.createdAt.toISOString(),
    updatedAt: connection.updatedAt.toISOString(),
  };
}
