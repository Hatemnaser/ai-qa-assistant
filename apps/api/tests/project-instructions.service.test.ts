import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  ProjectInstructionRecord,
  ProjectInstructionsRepository,
} from "../src/modules/project-instructions/project-instructions.types.ts";
import { projectInstructionInputSchema } from "../src/modules/project-instructions/project-instructions.schema.ts";
import { createProjectInstructionsService } from "../src/modules/project-instructions/project-instructions.service.ts";
import { createFakeProjectAccess } from "./helpers/projectAccess.ts";

const NOW = new Date("2026-06-06T10:00:00.000Z");

describe("project instructions service", () => {
  it("returns and saves one instruction record per owned project", async () => {
    const { repository, service } = setupProjectInstructionsService([
      {
        id: "project-1",
        ownerId: "user-1",
      },
    ]);

    const saved = await service.saveProjectInstruction("user-1", "project-1", {
      content: "Use risk-based testing.",
    });
    const loaded = await service.getProjectInstruction("user-1", "project-1");

    assert.equal(saved?.projectId, "project-1");
    assert.equal(loaded?.content, "Use risk-based testing.");
    assert.equal(repository.instructions.size, 1);
  });

  it("clears project instructions when saved content is empty", async () => {
    const { repository, service } = setupProjectInstructionsService(
      [{ id: "project-1", ownerId: "user-1" }],
      [createFakeProjectInstruction()]
    );

    const result = await service.saveProjectInstruction("user-1", "project-1", {
      content: "",
    });

    assert.equal(result, null);
    assert.equal(repository.instructions.size, 0);
  });

  it("keeps project instructions isolated by project ownership", async () => {
    const { service } = setupProjectInstructionsService([
      {
        id: "project-1",
        ownerId: "user-2",
      },
    ]);

    await assert.rejects(
      () => service.getProjectInstruction("user-1", "project-1"),
      {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      }
    );
  });

  it("normalizes project instruction input", () => {
    assert.deepEqual(
      projectInstructionInputSchema.parse({
        content: "  Use risk-based testing.  ",
      }),
      {
        content: "Use risk-based testing.",
      }
    );
  });
});

interface FakeProject {
  id: string;
  ownerId: string;
}

interface FakeProjectInstructionsRepository extends ProjectInstructionsRepository {
  instructions: Map<string, ProjectInstructionRecord>;
}

function setupProjectInstructionsService(
  projects: FakeProject[],
  instructions: ProjectInstructionRecord[] = []
) {
  const repository: FakeProjectInstructionsRepository = {
    instructions: new Map(instructions.map((instruction) => [instruction.projectId, instruction])),

    async deleteProjectInstruction(projectId) {
      repository.instructions.delete(projectId);
    },

    async findProjectInstruction(projectId) {
      return repository.instructions.get(projectId) || null;
    },

    async upsertProjectInstruction(projectId, content) {
      const existing = repository.instructions.get(projectId);
      const instruction = {
        projectId,
        content,
        createdAt: existing?.createdAt || NOW,
        updatedAt: NOW,
      };

      repository.instructions.set(projectId, instruction);

      return instruction;
    },
  };

  return {
    repository,
    service: createProjectInstructionsService({
      projectAccess: createFakeProjectAccess(
        new Map(projects.map((project) => [project.id, project.ownerId]))
      ),
      repository,
    }),
  };
}

function createFakeProjectInstruction(): ProjectInstructionRecord {
  return {
    projectId: "project-1",
    content: "Existing instructions",
    createdAt: NOW,
    updatedAt: NOW,
  };
}
