import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import { createApp } from "../src/app.ts";
import { getCsrfHeaders } from "./helpers/csrf.ts";

let baseUrl = "";
let server: Server;
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
    server.close((error) => (error ? reject(error) : resolve()));
  });
  console.warn = originalConsoleWarn;
});

describe("/api/assets", () => {
  it("requires authentication for every asset lifecycle route", async () => {
    const csrf = await getCsrfHeaders(baseUrl);
    const requests = [
      fetch(`${baseUrl}/api/assets/initiate`, {
        body: "{}",
        headers: { "content-type": "application/json", ...csrf },
        method: "POST",
      }),
      fetch(`${baseUrl}/api/assets/asset-1/complete`, {
        body: "{}",
        headers: { "content-type": "application/json", ...csrf },
        method: "POST",
      }),
      fetch(`${baseUrl}/api/assets/asset-1/download`),
      fetch(`${baseUrl}/api/assets/asset-1`, { headers: csrf, method: "DELETE" }),
    ];

    for (const response of await Promise.all(requests)) {
      const body = await response.json();
      assert.equal(response.status, 401);
      assert.equal(body.code, "SESSION_REQUIRED");
    }
  });
});
