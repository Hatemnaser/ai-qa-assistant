import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";

let server: Server;
let baseUrl: string;

before(async () => {
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
});

describe("GET /api/ai/models", () => {
  it("returns the active provider model catalog", async () => {
    const response = await fetch(`${baseUrl}/api/ai/models`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.defaultProvider, "gemini");
    assert.equal(body.defaultModel, "gemini-3.1-flash-lite");
    assert.deepEqual(body.providers, ["gemini"]);
    assert.ok(Array.isArray(body.models));
    assert.ok(body.models.some((model: { value: string }) => model.value === "gemini-2.5-flash"));
    assert.deepEqual(body.models[0].capabilities, {
      images: true,
      text: true,
      textAttachments: true,
    });
  });
});
