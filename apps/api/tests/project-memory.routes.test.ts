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

describe("/api/projects/:projectId/memory", () => {
  it("requires an authenticated session to read project memory", async () => {
    const response = await fetch(`${baseUrl}/api/projects/project-1/memory`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("requires an authenticated session to save project memory", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/projects/project-1/memory`, {
      body: JSON.stringify({
        content: "## Stack\nTypeScript",
      }),
      headers: {
        "content-type": "application/json",
        ...csrfHeaders,
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

});
