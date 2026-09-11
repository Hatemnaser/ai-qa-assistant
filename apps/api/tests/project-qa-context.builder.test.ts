import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { prisma } from "../src/db/prisma.ts";
import { createProjectQaContextBuilder } from "../src/modules/qa-requests/project-qa-context.builder.ts";

describe("project QA context snapshot", () => {
  it("locks Project Instructions, Project Memory, and relevant RAG chunks into the request", async () => {
    let query: unknown;
    const retrievalCalls: string[] = [];
    const updatedAt = new Date("2026-08-29T00:00:00.000Z");
    const database = {
      project: {
        async findUnique(input: unknown) {
          query = input;
          return {
            documents: [
              {
                chunks: [{
                  chunkIndex: 0,
                  content: "Checkout retries use the idempotency-key header.",
                  contentHash: "chunk-hash",
                  id: "chunk-checkout",
                }],
                content: "full checkout document",
                contentHash: "document-hash",
                id: "document-checkout",
                indexStatus: "READY",
                title: "Checkout contract",
                updatedAt,
              },
              {
                chunks: [{
                  chunkIndex: 0,
                  content: "Unrelated profile settings.",
                  contentHash: "profile-hash",
                  id: "chunk-profile",
                }],
                content: "profile document",
                contentHash: "profile-document-hash",
                id: "document-profile",
                indexStatus: "READY",
                title: "Profile",
                updatedAt,
              },
            ],
            id: "project-1",
            instruction: { content: "Always test failure recovery.", updatedAt },
            name: "Storefront",
            projectMemory: { content: "Payments use provider test mode.", updatedAt },
          };
        },
      },
    } as unknown as Pick<typeof prisma, "project">;

    const snapshot = await createProjectQaContextBuilder({
      database,
      documentRetriever: {
        async retrieve(input) {
          retrievalCalls.push(input.query);
          return [{
            chunkCount: 1,
            chunkIndex: 0,
            content: "Checkout retries use the idempotency-key header.",
            documentId: "document-checkout",
            title: "Checkout contract",
          }];
        },
      },
    }).build({
      objective: "Verify checkout idempotency and payment recovery",
      projectId: "project-1",
      title: "Checkout QA",
      userId: "user-1",
    });
    const payload = snapshot.payload as {
      documentChunks: Array<{ chunkId: string }>;
      project: { instructions: string; memory: string };
    };

    assert.equal(snapshot.degraded, false);
    assert.equal(snapshot.retrievalMode, "SHARED_PROJECT_RETRIEVER");
    assert.equal(payload.project.instructions, "Always test failure recovery.");
    assert.equal(payload.project.memory, "Payments use provider test mode.");
    assert.match(
      payload.documentChunks[0]?.chunkId || "",
      /^document-checkout:0:[a-f0-9]{16}$/
    );
    assert.match(snapshot.payloadHash, /^[a-f0-9]{64}$/);
    assert.equal(JSON.stringify(query).includes("chat"), false);
    assert.equal(JSON.stringify(query).includes("accountMemory"), false);
    assert.equal(JSON.stringify(query).includes("chunks"), false);
    assert.match(
      retrievalCalls[0] || "",
      /^Checkout QA Verify checkout idempotency and payment recovery/
    );
  });
});
