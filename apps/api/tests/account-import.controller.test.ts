import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import { createAccountImportController } from "../src/modules/data-portability/account-import.controller.ts";
import type { AccountImportService } from "../src/modules/data-portability/account-import.service.ts";

describe("account import controller", () => {
  it("previews and commits raw ZIP bytes without a provider header", async () => {
    const calls: string[] = [];
    const controller = createAccountImportController(createService(calls));
    const archive = Buffer.from([80, 75, 3, 4]);
    const previewResponse = createResponse();

    await controller.preview(
      request(archive),
      previewResponse.value,
      previewResponse.next
    );

    assert.deepEqual(calls, ["preview:4"]);
    assert.equal(previewResponse.statusCode, 200);

    const commitResponse = createResponse();
    await controller.commit(
      request(archive, {
        headers: { "x-package-digest": "a".repeat(64) },
      }),
      commitResponse.value,
      commitResponse.next
    );

    assert.deepEqual(calls, [
      "preview:4",
      `commit:user-1:${"a".repeat(64)}:4`,
    ]);
    assert.equal(commitResponse.statusCode, 201);
  });

  it("rejects unsupported content types and missing preview digests safely", async () => {
    const calls: string[] = [];
    const controller = createAccountImportController(createService(calls));
    const unsupported = createResponse();

    await controller.preview(
      request(Buffer.from("{}"), { contentType: "application/json" }),
      unsupported.value,
      unsupported.next
    );
    assert.equal(
      (unsupported.error as { code?: unknown })?.code,
      "ACCOUNT_IMPORT_CONTENT_TYPE_UNSUPPORTED"
    );

    const missingDigest = createResponse();
    await controller.commit(
      request(Buffer.from([80, 75, 3, 4])),
      missingDigest.value,
      missingDigest.next
    );
    assert.equal(
      (missingDigest.error as { code?: unknown })?.code,
      "ACCOUNT_IMPORT_DIGEST_REQUIRED"
    );
    assert.deepEqual(calls, []);
  });
});

function createService(calls: string[]): AccountImportService {
  return {
    async preview(archive) {
      calls.push(`preview:${archive.byteLength}`);
      return {
        compatible: true,
        importKind: "account_archive",
        packageDigest: "a".repeat(64),
        counts: createCounts(),
        warnings: [],
      };
    },
    async commit(userId, archive, digest) {
      calls.push(`commit:${userId}:${digest}:${archive.byteLength}`);
      return {
        importKind: "account_archive",
        imported: createCounts(),
        skipped: { accountMemories: 0 },
        warnings: [],
      };
    },
  };
}

function createCounts() {
  return {
    projects: 1,
    documents: 1,
    chats: 1,
    messages: 2,
    accountMemories: 1,
  };
}

function request(
  body: Buffer,
  options: {
    contentType?: string;
    headers?: Record<string, string>;
  } = {}
) {
  return {
    authUser: { id: "user-1" },
    body,
    get(name: string) {
      return options.headers?.[name.toLowerCase()];
    },
    is(contentType: string) {
      return contentType === (options.contentType || "application/zip")
        ? contentType
        : false;
    },
  } as unknown as Request;
}

function createResponse() {
  const state: { body?: unknown; error?: unknown; statusCode?: number } = {};
  const value = {
    set() {
      return value;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return value;
    },
    json(body: unknown) {
      state.body = body;
      return value;
    },
  } as unknown as Response;
  const next: NextFunction = (error?: unknown) => {
    state.error = error;
  };

  return {
    get error() {
      return state.error;
    },
    next,
    get statusCode() {
      return state.statusCode;
    },
    value,
  };
}
