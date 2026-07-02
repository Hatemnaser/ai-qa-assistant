import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import { createAccountMemoryPortabilityController } from "../src/modules/data-portability/account-memory-portability.controller.ts";
import type { AccountMemoryPortabilityService } from "../src/modules/data-portability/account-memory-portability.service.ts";

describe("Account Memory portability controller", () => {
  it("exports Account Memory JSON with safe download headers", async () => {
    const calls = createCalls();
    const controller = createAccountMemoryPortabilityController(
      createFakeService(calls)
    );
    const response = createFakeResponse();

    await controller.exportAccountMemories(
      {
        authUser: {
          id: "user-1",
        },
      } as unknown as Request,
      response.value,
      response.next
    );

    assert.deepEqual(calls.exports, ["user-1"]);
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["content-disposition"],
      'attachment; filename="account-memories-export.json"'
    );
    assert.equal(
      response.headers["content-type"],
      "application/json; charset=utf-8"
    );
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(response.body, Buffer.from('{"memories":[]}'));
    assert.equal(response.error, undefined);
  });

  it("previews the exact raw JSON payload for the authenticated user", async () => {
    const calls = createCalls();
    const controller = createAccountMemoryPortabilityController(
      createFakeService(calls)
    );
    const response = createFakeResponse();
    const payload = Buffer.from('{"formatVersion":"1.0"}', "utf8");

    await controller.previewAccountMemoryImport(
      jsonRequest(payload),
      response.value,
      response.next
    );

    assert.deepEqual(calls.previews, [
      {
        userId: "user-1",
        payload,
      },
    ]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.deepEqual(response.body, createPreview());
    assert.equal(response.error, undefined);
  });

  it("commits raw JSON with the required preview digest", async () => {
    const calls = createCalls();
    const controller = createAccountMemoryPortabilityController(
      createFakeService(calls)
    );
    const response = createFakeResponse();
    const payload = Buffer.from('{"formatVersion":"1.0"}', "utf8");
    const digest = "a".repeat(64);
    const request = jsonRequest(payload);
    request.get = (name: string) =>
      name.toLowerCase() === "x-package-digest" ? digest : undefined;

    await controller.commitAccountMemoryImport(
      request,
      response.value,
      response.next
    );

    assert.deepEqual(calls.commits, [
      {
        userId: "user-1",
        payload,
        digest,
      },
    ]);
    assert.equal(response.statusCode, 201);
    assert.deepEqual(response.body, {
      imported: {
        memories: 1,
        skippedDuplicates: 0,
      },
      currentMemoryCount: 1,
      warnings: [],
    });
    assert.equal(response.error, undefined);
  });

  it("rejects unsupported content, parsed JSON objects, and missing digests", async () => {
    const calls = createCalls();
    const controller = createAccountMemoryPortabilityController(
      createFakeService(calls)
    );

    const unsupported = createFakeResponse();
    await controller.previewAccountMemoryImport(
      {
        authUser: {
          id: "user-1",
        },
        body: Buffer.from("{}"),
        is: () => false,
      } as unknown as Request,
      unsupported.value,
      unsupported.next
    );
    assert.equal(
      (unsupported.error as { code?: unknown })?.code,
      "ACCOUNT_MEMORY_IMPORT_CONTENT_TYPE_UNSUPPORTED"
    );

    const parsed = createFakeResponse();
    await controller.previewAccountMemoryImport(
      {
        authUser: {
          id: "user-1",
        },
        body: {},
        is: () => "application/json",
      } as unknown as Request,
      parsed.value,
      parsed.next
    );
    assert.equal(
      (parsed.error as { code?: unknown })?.code,
      "ACCOUNT_MEMORY_IMPORT_PACKAGE_INVALID"
    );

    const missingDigest = createFakeResponse();
    await controller.commitAccountMemoryImport(
      jsonRequest(Buffer.from("{}")),
      missingDigest.value,
      missingDigest.next
    );
    assert.equal(
      (missingDigest.error as { code?: unknown })?.code,
      "ACCOUNT_MEMORY_IMPORT_DIGEST_REQUIRED"
    );
    assert.deepEqual(calls.previews, []);
    assert.deepEqual(calls.commits, []);
  });
});

interface Calls {
  commits: Array<{
    userId: string;
    payload: Buffer;
    digest: string;
  }>;
  exports: string[];
  previews: Array<{
    userId: string;
    payload: Buffer;
  }>;
}

function createCalls(): Calls {
  return {
    commits: [],
    exports: [],
    previews: [],
  };
}

function createFakeService(calls: Calls): AccountMemoryPortabilityService {
  return {
    async commitAccountMemoryImport(userId, payload, digest) {
      calls.commits.push({
        userId,
        payload,
        digest,
      });

      return {
        imported: {
          memories: 1,
          skippedDuplicates: 0,
        },
        currentMemoryCount: 1,
        warnings: [],
      };
    },

    async exportAccountMemories(userId) {
      calls.exports.push(userId);
      const payload = Buffer.from('{"memories":[]}');

      return {
        document: {
          formatVersion: "1.0",
          exportType: "account_memories",
          exportedAt: "2026-07-03T10:00:00.000Z",
          account: {
            sourceUserId: userId,
          },
          memories: [],
          warnings: [],
        },
        downloadFilename: "account-memories-export.json",
        payload,
      };
    },

    async previewAccountMemoryImport(userId, payload) {
      calls.previews.push({
        userId,
        payload,
      });

      return createPreview();
    },
  };
}

function createPreview() {
  return {
    compatible: true as const,
    formatVersion: "1.0" as const,
    exportType: "account_memories" as const,
    packageDigest: "digest",
    counts: {
      packageRecords: 1,
      importableRecords: 1,
      exactDuplicates: 0,
    },
    currentMemoryCount: 0,
    warnings: [],
  };
}

function jsonRequest(payload: Buffer) {
  return {
    authUser: {
      id: "user-1",
    },
    body: payload,
    get: () => undefined,
    is: () => "application/json",
  } as unknown as Request;
}

function createFakeResponse() {
  const state: {
    body?: unknown;
    error?: unknown;
    headers: Record<string, string>;
    statusCode?: number;
  } = {
    headers: {},
  };
  const value = {
    set(headers: Record<string, string>) {
      state.headers = Object.fromEntries(
        Object.entries(headers).map(([key, headerValue]) => [
          key.toLowerCase(),
          headerValue,
        ])
      );
      return value;
    },
    status(statusCode: number) {
      state.statusCode = statusCode;
      return value;
    },
    send(body: Buffer) {
      state.body = body;
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
    get body() {
      return state.body;
    },
    get error() {
      return state.error;
    },
    get headers() {
      return state.headers;
    },
    next,
    get statusCode() {
      return state.statusCode;
    },
    value,
  };
}
