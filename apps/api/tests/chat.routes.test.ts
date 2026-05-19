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

describe("POST /api/chat", () => {
  it("returns validation errors for invalid payloads", async () => {
    const response = await postJson("/api/chat", {});
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "VALIDATION_ERROR");
    assert.equal(body.error, "Invalid request payload.");
    assert.ok(Array.isArray(body.issues));
  });

  it("returns a contract error for unsupported models", async () => {
    const response = await postJson("/api/chat", {
      message: "Generate test cases for login",
      mode: "test_cases",
      model: "not-a-real-model",
      history: [],
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
    assert.match(body.error, /Unsupported Gemini model/);
  });

  it("treats null image payloads as no image", async () => {
    const response = await postJson("/api/chat", {
      message: "Generate test cases for login",
      mode: "test_cases",
      model: "not-a-real-model",
      history: [],
      image: null,
    });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.code, "UNSUPPORTED_MODEL");
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
