import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createProjectAccessService } from "../src/modules/projects/project-access.service.ts";

describe("project access service", () => {
  it("allows the project owner", async () => {
    const service = createProjectAccessService({
      async findProjectOwner(projectId) {
        return projectId === "project-1" ? { ownerId: "user-1" } : null;
      },
    });

    await service.assertProjectAccess("user-1", "project-1");
  });

  it("hides missing and foreign projects behind the same not-found error", async () => {
    const service = createProjectAccessService({
      async findProjectOwner(projectId) {
        return projectId === "project-1" ? { ownerId: "user-2" } : null;
      },
    });

    for (const projectId of ["project-1", "missing-project"]) {
      await assert.rejects(() => service.assertProjectAccess("user-1", projectId), {
        code: "PROJECT_NOT_FOUND",
        statusCode: 404,
      });
    }
  });
});
