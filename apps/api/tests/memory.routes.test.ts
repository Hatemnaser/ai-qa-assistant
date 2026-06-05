import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";

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

describe("/api/memories", () => {
  it("requires an authenticated session for account memories", async () => {
    const response = await fetch(`${baseUrl}/api/memories`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("requires an authenticated session to create account memories", async () => {
    const response = await postJson("/api/memories", {
      content: "Remember my QA style.",
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("requires an authenticated session for project memories", async () => {
    const response = await fetch(`${baseUrl}/api/projects/project-1/memories`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("requires an authenticated session to update project memories", async () => {
    const response = await fetch(`${baseUrl}/api/projects/project-1/memories/memory-1`, {
      body: JSON.stringify({
        content: "Updated memory.",
      }),
      headers: {
        "content-type": "application/json",
      },
      method: "PUT",
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });
});

async function postJson(path: string, body: unknown) {
  return fetch(`${baseUrl}${path}`, {
    body: JSON.stringify(body),
    headers: {
      "content-type": "application/json",
    },
    method: "POST",
  });
}
