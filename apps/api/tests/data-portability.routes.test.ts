import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";
import { getCsrfHeaders } from "./helpers/csrf.ts";

let server: Server;
let baseUrl: string;
let originalConsoleWarn: typeof console.warn;

before(async () => {
  originalConsoleWarn = console.warn;
  console.warn = () => {};

  await new Promise<void>((resolve) => {
    server = createApp().listen(0, "127.0.0.1", () => {
      const address = server.address();
      assert.ok(address && typeof address === "object");
      baseUrl = `http://127.0.0.1:${address.port}`;
      resolve();
    });
  });
});

after(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
  console.warn = originalConsoleWarn;
});

describe("GET /api/portability/projects/:projectId/export", () => {
  it("requires an authenticated session", async () => {
    const response = await fetch(
      `${baseUrl}/api/portability/projects/project-1/export`
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });
});

describe("POST /api/portability/projects/import/preview", () => {
  it("requires an authenticated session", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(
      `${baseUrl}/api/portability/projects/import/preview`,
      {
        body: Buffer.from([80, 75, 3, 4]),
        headers: {
          "content-type": "application/zip",
          ...csrfHeaders,
        },
        method: "POST",
      }
    );
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });
});
