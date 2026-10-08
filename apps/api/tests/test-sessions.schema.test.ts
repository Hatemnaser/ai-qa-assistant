import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTestSessionSchema, deleteTestSessionSchema, prepareTestSessionSchema, resumeTestPreparationSchema,
  testSessionAiResponseSchema, testSessionParams, testSessionTurnSchema, updateTestSessionSchema } from "../src/modules/test-sessions/test-sessions.schema.ts";
import { PROPOSAL, TURN } from "./test-sessions.fixture.ts";

describe("Test session input boundaries", () => {
  it("requires bounded identifiers and positive integer versions", () => {
    assert.deepEqual(testSessionParams.parse({ projectId: " project-1 ", sessionId: " session-1 " }), { projectId: "project-1", sessionId: "session-1" });
    for (const value of ["", " ", "x".repeat(192)]) {
      assert.equal(testSessionParams.safeParse({ projectId: value, sessionId: "session-1" }).success, false);
      assert.equal(createTestSessionSchema.safeParse({ clientSessionId: value }).success, false);
    }
    for (const value of [0, -1, 1.5, "1", null]) assert.equal(deleteTestSessionSchema.safeParse({ expectedSessionVersion: value }).success, false);
  });

  it("does not accept client-owned approval, request state, proposal, or profile manifests", () => {
    for (const [schema, valid] of [
      [createTestSessionSchema, {}], [updateTestSessionSchema, { expectedSessionVersion: 1 }],
      [prepareTestSessionSchema, { expectedSessionVersion: 1, proposalId: "proposal-1" }],
      [resumeTestPreparationSchema, { expectedSessionVersion: 1, action: "resume" }],
      [testSessionTurnSchema, TURN],
    ] as const) {
      for (const field of ["kind", "phase", "approved", "currentRequestId", "pendingProposal", "profileManifest", "runId", "userId"]) {
        assert.equal(schema.safeParse({ ...valid, [field]: "forged" }).success, false, field);
      }
    }
  });

  it("bounds conversational text, attachments, and explicit preparation actions", () => {
    assert.deepEqual(testSessionTurnSchema.parse({ ...TURN, attachments: undefined }).attachments, []);
    for (const content of [" ", "x".repeat(20_001)]) assert.equal(testSessionTurnSchema.safeParse({ ...TURN, content }).success, false);
    assert.equal(testSessionTurnSchema.safeParse({ ...TURN, attachments: Array.from({ length: 9 }, (_, i) => ({ assetId: `asset-${i}` })) }).success, false);
    assert.equal(testSessionTurnSchema.safeParse({ ...TURN, attachments: Array.from({ length: 5 }, () => ({ type: "file", name: "notes.txt", mimeType: "text/plain", content: "x".repeat(900_000) })) }).success, false);
    assert.equal(resumeTestPreparationSchema.safeParse({ expectedSessionVersion: 1, action: "approve" }).success, false);
  });

  it("rejects executable or approval-bearing AI output", () => {
    const { id: _id, sourceMessageIds: _sources, ...proposal } = PROPOSAL;
    assert.equal(testSessionAiResponseSchema.safeParse({ reply: "Review the brief.", proposal }).success, true);
    for (const input of [{ reply: "OK", proposal, approved: true }, { reply: "OK", proposal: { ...proposal, runId: "forged" } }, { reply: "", proposal: null }]) {
      assert.equal(testSessionAiResponseSchema.safeParse(input).success, false);
    }
  });
});
