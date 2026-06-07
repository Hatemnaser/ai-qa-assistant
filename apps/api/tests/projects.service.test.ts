import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ProjectRole } from "../src/generated/prisma/enums.ts";
import type { ProjectRecord, ProjectsRepository } from "../src/modules/projects/projects.repository.ts";
import { projectInputSchema } from "../src/modules/projects/projects.schema.ts";
import { createProjectsService } from "../src/modules/projects/projects.service.ts";

const NOW = new Date("2026-05-29T10:00:00.000Z");

describe("projects service", () => {
  it("creates owner-scoped projects with an owner membership foundation", async () => {
    const { repository, service } = setupProjectsService();

    const project = await service.createUserProject("user-1", {
      description: "Checkout and payment flows",
      name: "Checkout QA",
    });

    assert.equal(project.id, "project-1");
    assert.equal(project.name, "Checkout QA");
    assert.equal(project.description, "Checkout and payment flows");
    assert.equal(project.role, ProjectRole.OWNER);
    assert.deepEqual(repository.ownerMemberships, [
      {
        projectId: "project-1",
        role: ProjectRole.OWNER,
        userId: "user-1",
      },
    ]);
  });

  it("lists only projects owned by the current user", async () => {
    const { service } = setupProjectsService([
      createFakeProjectRecord({
        id: "project-1",
        name: "Current user older project",
        ownerId: "user-1",
        updatedAt: new Date("2026-05-29T09:00:00.000Z"),
      }),
      createFakeProjectRecord({
        id: "project-2",
        name: "Other user project",
        ownerId: "user-2",
        updatedAt: new Date("2026-05-29T11:00:00.000Z"),
      }),
      createFakeProjectRecord({
        id: "project-3",
        name: "Current user newer project",
        ownerId: "user-1",
        updatedAt: new Date("2026-05-29T12:00:00.000Z"),
      }),
    ]);

    const projects = await service.listUserProjects("user-1");

    assert.deepEqual(
      projects.map((project) => project.id),
      ["project-3", "project-1"]
    );
  });

  it("updates projects owned by the current user", async () => {
    const { repository, service } = setupProjectsService([
      createFakeProjectRecord({
        id: "project-1",
        name: "Old name",
        ownerId: "user-1",
      }),
    ]);

    const project = await service.updateUserProject("user-1", "project-1", {
      description: null,
      name: "New name",
    });

    assert.equal(project.name, "New name");
    assert.equal(project.description, null);
    assert.equal(repository.projects[0].name, "New name");
  });

  it("rejects updates to projects owned by another user", async () => {
    const { repository, service } = setupProjectsService([
      createFakeProjectRecord({
        id: "project-1",
        name: "Private project",
        ownerId: "user-1",
      }),
    ]);

    await assert.rejects(
      () =>
        service.updateUserProject("user-2", "project-1", {
          description: "Stolen edit",
          name: "Changed",
        }),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
    assert.equal(repository.projects[0].name, "Private project");
  });

  it("deletes only projects owned by the current user", async () => {
    const { repository, service } = setupProjectsService([
      createFakeProjectRecord({
        id: "project-1",
        ownerId: "user-1",
      }),
      createFakeProjectRecord({
        id: "project-2",
        ownerId: "user-2",
      }),
    ]);

    await service.deleteUserProject("user-1", "project-1");

    assert.deepEqual(
      repository.projects.map((project) => project.id),
      ["project-2"]
    );
  });

  it("rejects deletes for projects owned by another user", async () => {
    const { repository, service } = setupProjectsService([
      createFakeProjectRecord({
        id: "project-1",
        ownerId: "user-1",
      }),
    ]);

    await assert.rejects(() => service.deleteUserProject("user-2", "project-1"), {
      code: "PROJECT_NOT_FOUND",
      statusCode: 404,
    });
    assert.equal(repository.projects.length, 1);
  });

  it("normalizes project input", () => {
    const input = projectInputSchema.parse({
      description: "   ",
      name: "  Mobile App  ",
    });

    assert.deepEqual(input, {
      description: null,
      name: "Mobile App",
    });
  });
});

function setupProjectsService(initialProjects: FakeProjectRecord[] = []) {
  const repository = createFakeProjectsRepository(initialProjects);
  const service = createProjectsService({
    repository,
  });

  return {
    repository,
    service,
  };
}

interface FakeProjectRecord extends ProjectRecord {
  ownerId: string;
}

interface FakeProjectsRepository extends ProjectsRepository {
  ownerMemberships: Array<{
    projectId: string;
    role: ProjectRole;
    userId: string;
  }>;
  projects: FakeProjectRecord[];
}

function createFakeProjectsRepository(initialProjects: FakeProjectRecord[] = []): FakeProjectsRepository {
  const repository: FakeProjectsRepository = {
    ownerMemberships: [],
    projects: [...initialProjects],

    async createUserProject(input) {
      const project = createFakeProjectRecord({
        description: input.description,
        id: `project-${repository.projects.length + 1}`,
        name: input.name,
        ownerId: input.ownerId,
      });

      repository.projects.push(project);
      repository.ownerMemberships.push({
        projectId: project.id,
        role: ProjectRole.OWNER,
        userId: input.ownerId,
      });

      return project;
    },

    async deleteOwnedProject(userId, projectId) {
      const projectIndex = repository.projects.findIndex(
        (project) => project.id === projectId && project.ownerId === userId
      );

      if (projectIndex === -1) return 0;

      repository.projects.splice(projectIndex, 1);

      return 1;
    },

    async findProjectOwner(projectId) {
      const project = repository.projects.find((item) => item.id === projectId);

      return project ? { ownerId: project.ownerId } : null;
    },

    async listUserProjects(userId) {
      return repository.projects
        .filter((project) => project.ownerId === userId)
        .sort((first, second) => second.updatedAt.getTime() - first.updatedAt.getTime());
    },

    async updateOwnedProject(input) {
      const project = repository.projects.find(
        (item) => item.id === input.projectId && item.ownerId === input.userId
      );

      if (!project) return null;

      project.description = input.description;
      project.name = input.name;
      project.updatedAt = NOW;

      return project;
    },
  };

  return repository;
}

function createFakeProjectRecord(overrides: Partial<FakeProjectRecord> = {}): FakeProjectRecord {
  return {
    id: "project-1",
    name: "QA Project",
    description: null,
    createdAt: new Date("2026-05-29T09:00:00.000Z"),
    updatedAt: new Date("2026-05-29T09:00:00.000Z"),
    ownerId: "user-1",
    ...overrides,
  };
}
