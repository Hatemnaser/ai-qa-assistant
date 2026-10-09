import { DATA_LIMITS } from "../../config/data-limits.js";
import { prisma } from "../../db/prisma.js";
import { Prisma } from "../../generated/prisma/client.js";
import { ProjectRole } from "../../generated/prisma/enums.js";
import { AppError } from "../../lib/errors.js";
import { enqueueAssetDeletionJobs } from "../assets/assets.deletion-outbox.js";
import type { ProjectsRepository } from "./projects.types.js";
import { lockTestProject } from "../test-sessions/test-sessions.guard.js";

export function createPrismaProjectsRepository(database: typeof prisma = prisma): ProjectsRepository {
  return {
    async createUserProject(input) {
      return database.$transaction(async (tx) => {
        await lockUserProjectQuota(tx, input.ownerId);
        const projectCount = await tx.project.count({ where: { ownerId: input.ownerId } });

        if (projectCount >= DATA_LIMITS.projectsPerUser) {
          throw new AppError(
            `You can create up to ${DATA_LIMITS.projectsPerUser} projects. Delete one before creating another.`,
            409,
            "PROJECT_LIMIT_REACHED"
          );
        }

        const project = await tx.project.create({
          data: {
            description: input.description,
            name: input.name,
            ownerId: input.ownerId,
          },
        });

        await tx.projectMember.create({
          data: {
            projectId: project.id,
            role: ProjectRole.OWNER,
            userId: input.ownerId,
          },
        });

        return project;
      });
    },

    async deleteOwnedProject(userId, projectId) {
      return database.$transaction(async (tx) => {
        await lockTestProject(tx, projectId);
        const project = await tx.project.findFirst({
          select: {
            storedAssets: {
              select: { objectKey: true, uploadExpiresAt: true },
              where: { purpose: { in: ["PROJECT_DOCUMENT_SOURCE", "QA_EVIDENCE"] } },
            },
          },
          where: {
            id: projectId,
            ownerId: userId,
          },
        });

        if (!project) return 0;

        const testChats = await tx.chat.findMany({ where: { projectId, userId, testSession: { requests: { some: {} } } },
          include: { messages: { include: { attachments: { include: { asset: true } } } } },
        });
        const activeTest = await tx.testSessionTurn.findFirst({ where: { session: { chat: { projectId } }, status: { in: ["PENDING", "PROCESSING"] } }, select: { id: true } });
        const activeRun = await tx.qaRun.findFirst({ where: { request: { projectId }, status: { in: ["CREATED", "ACTIVE"] } }, select: { id: true } });
        const activeGeneration = await tx.qaGenerationExecution.findFirst({ where: { request: { projectId }, status: { in: ["PENDING", "PROCESSING"] } }, select: { id: true } });
        const activePreparation = await tx.testSessionPreparation.findFirst({ where: { session: { chat: { projectId } }, status: { in: ["CHECKLIST", "RECIPE", "REVIEW"] } }, select: { id: true } });
        if (activeTest || activeRun || activeGeneration || activePreparation) throw new AppError("Finish or stop active Test work before deleting this project.", 409, "PROJECT_TEST_WORK_ACTIVE");
        const testAssets = testChats.flatMap((chat) => chat.messages.flatMap((message) => message.attachments.map(({ asset }) => asset)));

        const assets = [...project.storedAssets, ...testAssets];
        const objectKeys = assets.map((asset) => asset.objectKey);
        await enqueueAssetDeletionJobs(tx, assets);

        if (objectKeys.length > 0) {
          await tx.storedAsset.updateMany({
            data: { status: "DELETE_PENDING" },
            where: { objectKey: { in: objectKeys } },
          });
        }

        // Ordinary conversations remain projectless; Test transcripts and their QA records
        // are explicitly deleted together, never orphaned by Chat.project's SET NULL.
        if (testChats.length) {
          await tx.qaRequest.deleteMany({ where: { projectId, testSessionId: { in: testChats.map(({ id }) => id) } } });
          await tx.chat.deleteMany({ where: { id: { in: testChats.map(({ id }) => id) }, userId, projectId } });
        }
        const result = await tx.project.deleteMany({
          where: {
            id: projectId,
            ownerId: userId,
          },
        });

        return result.count;
      });
    },

    async findProjectOwner(projectId) {
      return database.project.findUnique({
        select: {
          ownerId: true,
        },
        where: {
          id: projectId,
        },
      });
    },

    async listUserProjects(userId) {
      return database.project.findMany({
        orderBy: {
          updatedAt: "desc",
        },
        take: DATA_LIMITS.projectsPerUser,
        where: {
          ownerId: userId,
        },
      });
    },

    async updateOwnedProject(input) {
      return database.$transaction(async (tx) => {
        const result = await tx.project.updateMany({
          data: {
            description: input.description,
            name: input.name,
          },
          where: {
            id: input.projectId,
            ownerId: input.userId,
          },
        });

        if (result.count === 0) return null;

        return tx.project.findFirst({
          where: {
            id: input.projectId,
            ownerId: input.userId,
          },
        });
      });
    },
  };
}

export const projectsRepository = createPrismaProjectsRepository();

async function lockUserProjectQuota(tx: Prisma.TransactionClient, userId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`oddpath:quota:projects:${userId}`}, 0))`;
}
