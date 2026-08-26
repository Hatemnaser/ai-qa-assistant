import assert from "node:assert/strict";
import http, { type ClientRequest, type Server } from "node:http";
import { describe, it } from "node:test";

import express from "express";

import type { ChatRateLimitReason } from "../src/lib/security-events.ts";
import { createChatPreBodyGateMiddleware } from "../src/modules/chat/chat.pre-body-rate-limit.middleware.ts";

const NEVER_RATE_LIMITED = () => false;

describe("chat pre-body admission gate", () => {
  it("gates method-substituted bodies before JSON parsing and releases on finish", async () => {
    const reasons: Array<ChatRateLimitReason | undefined> = [];
    const admitted = deferred<void>();
    let parsedBodies = 0;
    const app = express();
    app.set("trust proxy", 1);
    app.use(
      "/api/chat",
      createChatPreBodyGateMiddleware({
        globalMaxInFlight: 2,
        isIpRateLimited: NEVER_RATE_LIMITED,
        logRateLimited: (event) => reasons.push(event.reason),
        perIpMaxInFlight: 1,
      }),
      (_req, _res, next) => {
        admitted.resolve();
        next();
      },
      express.json({
        verify: () => {
          parsedBodies += 1;
        },
      })
    );
    app.post("/api/chat", (_req, res) => res.json({ ok: true }));

    const { baseUrl, close } = await listen(app);
    const first = openStreamingRequest(baseUrl, "203.0.113.10");

    try {
      first.request.write('{"message":"');
      await admitted.promise;

      const rejected = await postJson(baseUrl, "203.0.113.10", "PUT");
      const rejectedBody = await rejected.json();

      assert.equal(rejected.status, 429);
      assert.equal(rejected.headers.get("connection"), "close");
      assert.equal(rejectedBody.code, "RATE_LIMITED");
      assert.equal(parsedBodies, 0);
      assert.equal(reasons.at(-1), "ip_in_flight");

      first.request.end('hello"}');
      const firstResponse = await first.response;
      assert.equal(firstResponse.statusCode, 200);
      assert.equal(parsedBodies, 1);

      const afterRelease = await postJson(baseUrl, "203.0.113.10");
      assert.equal(afterRelease.status, 200);
      assert.equal(parsedBodies, 2);
    } finally {
      first.request.destroy();
      await close();
    }
  });

  it("enforces the global bound across IPs with a structured rejection reason", async () => {
    const reasons: Array<ChatRateLimitReason | undefined> = [];
    const admitted = deferred<void>();
    let downstreamEntries = 0;
    const app = express();
    app.set("trust proxy", 1);
    app.use(
      "/api/chat",
      createChatPreBodyGateMiddleware({
        globalMaxInFlight: 1,
        isIpRateLimited: NEVER_RATE_LIMITED,
        logRateLimited: (event) => reasons.push(event.reason),
        perIpMaxInFlight: 1,
      }),
      (_req, _res, next) => {
        downstreamEntries += 1;
        admitted.resolve();
        next();
      },
      express.json()
    );
    app.post("/api/chat", (_req, res) => res.json({ ok: true }));

    const { baseUrl, close } = await listen(app);
    const first = openStreamingRequest(baseUrl, "203.0.113.20");

    try {
      first.request.write('{"message":"');
      await admitted.promise;

      const rejected = await postJson(baseUrl, "203.0.113.21");

      assert.equal(rejected.status, 429);
      assert.equal(downstreamEntries, 1);
      assert.equal(reasons.at(-1), "global_in_flight");

      first.request.end('hello"}');
      assert.equal((await first.response).statusCode, 200);
    } finally {
      first.request.destroy();
      await close();
    }
  });

  it("releases an admission exactly once when the client closes early", async () => {
    const heldRouteEntered = deferred<void>();
    const heldResponseClosed = deferred<void>();
    const app = express();
    app.set("trust proxy", 1);
    app.use(
      "/api/chat",
      createChatPreBodyGateMiddleware({
        globalMaxInFlight: 1,
        isIpRateLimited: NEVER_RATE_LIMITED,
        perIpMaxInFlight: 1,
      }),
      express.json()
    );
    app.post("/api/chat", (req, res) => {
      if (req.get("x-hold-response") === "true") {
        res.once("close", () => heldResponseClosed.resolve());
        heldRouteEntered.resolve();
        return;
      }

      res.json({ ok: true });
    });

    const { baseUrl, close } = await listen(app);
    const heldRequest = openAbortableRequest(baseUrl, "203.0.113.30");

    try {
      heldRequest.end("{}");
      await heldRouteEntered.promise;
      heldRequest.destroy();
      await heldResponseClosed.promise;

      const afterClose = await postJson(baseUrl, "203.0.113.30");
      assert.equal(afterClose.status, 200);
    } finally {
      heldRequest.destroy();
      await close();
    }
  });
});

function postJson(baseUrl: string, forwardedFor: string, method = "POST") {
  return fetch(`${baseUrl}/api/chat`, {
    body: JSON.stringify({ message: "hello" }),
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
    },
    method,
  });
}

function openStreamingRequest(baseUrl: string, forwardedFor: string) {
  let request: ClientRequest;
  const response = new Promise<{ body: string; statusCode: number | undefined }>(
    (resolve, reject) => {
      request = http.request(
        `${baseUrl}/api/chat`,
        {
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": forwardedFor,
          },
          method: "POST",
        },
        (incoming) => {
          let body = "";
          incoming.setEncoding("utf8");
          incoming.on("data", (chunk) => {
            body += chunk;
          });
          incoming.on("end", () => resolve({ body, statusCode: incoming.statusCode }));
        }
      );
      request.once("error", reject);
    }
  );

  return { request: request!, response };
}

function openAbortableRequest(baseUrl: string, forwardedFor: string) {
  const request = http.request(`${baseUrl}/api/chat`, {
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": forwardedFor,
      "x-hold-response": "true",
    },
    method: "POST",
  });

  // An intentional client abort normally emits ECONNRESET.
  request.on("error", () => {});
  return request;
}

async function listen(app: ReturnType<typeof express>) {
  const server = await new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((promiseResolve) => {
    resolve = promiseResolve;
  });

  return { promise, resolve };
}
