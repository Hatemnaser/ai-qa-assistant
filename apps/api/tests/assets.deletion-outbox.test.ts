import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { enqueueAssetDeletionJobs } from "../src/modules/assets/assets.deletion-outbox.ts";

describe("asset deletion outbox", () => {
  it("deduplicates object keys and preserves the signed-upload replay window", async () => {
    let createMany: Record<string, unknown> | undefined;
    const now = new Date("2026-08-23T12:00:00.000Z");
    const uploadExpiresAt = new Date("2026-08-23T12:10:00.000Z");
    const tx = {
      objectDeletionJob: {
        async createMany(input: Record<string, unknown>) {
          createMany = input;
          return { count: 2 };
        },
      },
    };

    await enqueueAssetDeletionJobs(tx as never, [
      { objectKey: "users/u1/asset-1", uploadExpiresAt },
      { objectKey: "users/u1/asset-1", uploadExpiresAt },
      { objectKey: "users/u1/asset-2", uploadExpiresAt: null },
    ], now);

    assert.deepEqual(createMany, {
      data: [{
        objectKey: "users/u1/asset-1",
        nextAttemptAt: new Date("2026-08-23T12:15:00.000Z"),
      }, {
        objectKey: "users/u1/asset-2",
        nextAttemptAt: now,
      }],
      skipDuplicates: true,
    });
  });

  it("does not issue an empty outbox write", async () => {
    let writes = 0;
    const tx = {
      objectDeletionJob: {
        async createMany() {
          writes += 1;
          return { count: 0 };
        },
      },
    };

    await enqueueAssetDeletionJobs(tx as never, []);

    assert.equal(writes, 0);
  });
});
