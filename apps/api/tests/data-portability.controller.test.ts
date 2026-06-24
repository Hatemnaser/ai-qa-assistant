import assert from "node:assert/strict";
import type { NextFunction, Request, Response } from "express";
import { describe, it } from "node:test";

import { createDataPortabilityController } from "../src/modules/data-portability/data-portability.controller.ts";
import type { DataPortabilityService } from "../src/modules/data-portability/data-portability.service.ts";

describe("data portability controller", () => {
  it("defaults includeChats to true and returns safe ZIP download headers", async () => {
    const calls: boolean[] = [];
    const controller = createDataPortabilityController(createFakeService(calls));
    const response = createFakeResponse();

    await controller.exportProject(
      {
        authUser: {
          id: "user-1",
        },
        params: {
          projectId: "project-1",
        },
        query: {},
      } as unknown as Request,
      response.value,
      response.next
    );

    assert.deepEqual(calls, [true]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/zip");
    assert.equal(
      response.headers["content-disposition"],
      'attachment; filename="checkout-qa-export.zip"'
    );
    assert.equal(response.headers["cache-control"], "private, no-store");
    assert.equal(response.headers["x-content-type-options"], "nosniff");
    assert.deepEqual(response.body, Buffer.from([1, 2, 3]));
    assert.equal(response.error, undefined);
  });

  it("supports includeChats=false", async () => {
    const calls: boolean[] = [];
    const controller = createDataPortabilityController(createFakeService(calls));
    const response = createFakeResponse();

    await controller.exportProject(
      {
        authUser: {
          id: "user-1",
        },
        params: {
          projectId: "project-1",
        },
        query: {
          includeChats: "false",
        },
      } as unknown as Request,
      response.value,
      response.next
    );

    assert.deepEqual(calls, [false]);
    assert.equal(response.statusCode, 200);
    assert.equal(response.error, undefined);
  });
});

function createFakeService(calls: boolean[]): DataPortabilityService {
  return {
    async exportOwnedProject(_userId, _projectId, options) {
      calls.push(options.includeChats);

      return {
        archive: Buffer.from([1, 2, 3]),
        downloadFilename: "checkout-qa-export.zip",
        manifest: {
          formatVersion: "1.0",
          exportType: "project",
          exportedAt: "2026-06-24T12:00:00.000Z",
          projectId: "project-1",
          projectName: "Checkout QA",
          include: {
            chats: options.includeChats,
            documents: true,
            readable: true,
          },
          counts: {
            documents: 0,
            chats: 0,
            messages: 0,
          },
          warnings: [],
          files: [],
        },
      };
    },
  };
}

function createFakeResponse() {
  const state: {
    body?: Buffer;
    error?: unknown;
    headers: Record<string, string>;
    statusCode?: number;
  } = {
    headers: {},
  };
  const value = {
    set(headers: Record<string, string>) {
      state.headers = Object.fromEntries(
        Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
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
