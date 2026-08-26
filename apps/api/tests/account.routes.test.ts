import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import express, { type RequestHandler } from "express";

import { createApp } from "../src/app.ts";
import { errorHandler } from "../src/middleware/error.middleware.ts";
import { createAccountRouter } from "../src/modules/account/account.routes.ts";
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
    server.close((error) => (error ? reject(error) : resolve()));
  });
  console.warn = originalConsoleWarn;
});

describe("DELETE /api/account", () => {
  it("requires an authenticated session", async () => {
    const csrfHeaders = await getCsrfHeaders(baseUrl);
    const response = await fetch(`${baseUrl}/api/account`, {
      body: JSON.stringify({ currentPassword: "correct password" }),
      headers: {
        "content-type": "application/json",
        ...csrfHeaders,
      },
      method: "DELETE",
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.code, "SESSION_REQUIRED");
  });

  it("passes the authenticated identity and current password to the service", async () => {
    const calls: unknown[] = [];
    const testServer = await startTestRouter({
      async deleteAccount(userId, input) {
        calls.push({ input, userId });
        return { ok: true as const };
      },
    });

    try {
      const response = await fetch(`${testServer.url}/api/account`, {
        body: JSON.stringify({ currentPassword: "correct password" }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      const body = await response.json();
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.deepEqual(body, { ok: true });
      assert.deepEqual(calls, [
        {
          input: { currentPassword: "correct password" },
          userId: "user-1",
        },
      ]);
      assert.match(setCookie, /qa_session=/);
      assert.match(setCookie, /HttpOnly/);
      assert.match(setCookie, /SameSite=Lax/);
    } finally {
      await testServer.close();
    }
  });

  it("validates password confirmation before calling the service", async () => {
    let called = false;
    const testServer = await startTestRouter({
      async deleteAccount() {
        called = true;
        return { ok: true as const };
      },
    });

    try {
      const response = await fetch(`${testServer.url}/api/account`, {
        body: JSON.stringify({ currentPassword: "" }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.code, "VALIDATION_ERROR");
      assert.equal(called, false);
    } finally {
      await testServer.close();
    }
  });
});

async function startTestRouter(service: {
  deleteAccount(userId: string, input: { currentPassword: string }): Promise<{ ok: true }>;
}) {
  const app = express();
  const authenticate: RequestHandler = (req, _res, next) => {
    req.authUser = {
      createdAt: "2026-08-12T00:00:00.000Z",
      email: "person@example.com",
      emailVerifiedAt: "2026-08-12T00:00:00.000Z",
      id: "user-1",
      locale: "en",
      name: "Person",
    };
    next();
  };

  app.use(express.json());
  app.use("/api/account", createAccountRouter({ requireAuthMiddleware: authenticate, service }));
  app.use(errorHandler);

  let localServer: Server;
  const url = await new Promise<string>((resolve) => {
    localServer = app.listen(0, "127.0.0.1", () => {
      const address = localServer.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  return {
    async close() {
      await new Promise<void>((resolve, reject) => {
        localServer.close((error) => (error ? reject(error) : resolve()));
      });
    },
    url,
  };
}
