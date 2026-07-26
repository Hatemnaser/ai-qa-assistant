import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import { createAccountDataPortabilityController } from "../src/modules/data-portability/account-data-portability.controller.ts";
import type { AccountDataPortabilityService } from "../src/modules/data-portability/account-data-portability.service.ts";

describe("Account Data portability controller", () => {
  it("exports the authenticated account ZIP with safe download headers", async () => {
    const calls: string[] = [];
    const service: AccountDataPortabilityService = {
      async exportAccountData(userId) {
        calls.push(userId);
        return {
          archive: Buffer.from("account-zip"),
          downloadFilename: "account-data-export.zip",
          manifest: {
            formatVersion: "1.0",
            exportType: "account",
            exportedAt: "2026-07-03T12:00:00.000Z",
            accountId: userId,
            counts: {
              projects: 0,
              documents: 0,
              chats: 0,
              messages: 0,
              accountMemories: 0,
            },
            contains: {
              canonicalJson: true,
              readableMarkdown: true,
              migrationReference: true,
              attachmentFiles: false,
              derivedData: false,
              secrets: false,
            },
            warnings: [],
            files: [],
          },
        };
      },
    };
    const controller = createAccountDataPortabilityController(service);
    const response = createFakeResponse();

    await controller.exportAccountData(
      {
        authUser: {
          id: "user-1",
        },
      } as unknown as Request,
      response.value,
      response.next
    );

    assert.deepEqual(calls, ["user-1"]);
    assert.equal(response.statusCode, 200);
    assert.equal(
      response.headers["content-disposition"],
      'attachment; filename="account-data-export.zip"'
    );
    assert.equal(response.headers["content-type"], "application/zip");
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(response.body, Buffer.from("account-zip"));
    assert.equal(response.error, undefined);
  });
});

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
