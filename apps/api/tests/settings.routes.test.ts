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

describe("/api/settings", () => {
  it("requires an authenticated session to read settings", async () => {
    const response = await fetch(`${baseUrl}/api/settings`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("requires an authenticated session to update settings", async () => {
    const response = await fetch(`${baseUrl}/api/settings`, {
      body: JSON.stringify({
        defaultModel: "gemini-3.1-flash-lite",
        language: "en",
        theme: "light",
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
