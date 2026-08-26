import assert from "node:assert/strict";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

import express from "express";

import {
  buildReadinessPoolConfig,
  createHealthRouter,
  createReadinessCoordinator,
} from "../src/modules/health/health.routes.ts";

let baseUrl: string;
let databaseAvailable = true;
let server: Server;

before(async () => {
  const app = express();

  app.use(
    "/api/health",
    createHealthRouter(
      {
        async checkDatabase() {
          if (!databaseAvailable) throw new Error("private database detail");
        },
      },
      { failureCacheMs: 0, onProbe: () => undefined, successCacheMs: 0 }
    )
  );

  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
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

describe("API health routes", () => {
  it("bounds the database probe and prevents concurrent probe fan-out", () => {
    const config = buildReadinessPoolConfig("postgresql://user:pass@database.internal/app");

    assert.equal(config.max, 1);
    assert.equal(config.connectionTimeoutMillis, 1_500);
    assert.equal(config.query_timeout, 1_500);
    assert.equal(config.statement_timeout, 1_500);
  });

  it("keeps liveness independent of database readiness", async () => {
    databaseAvailable = false;

    const response = await fetch(`${baseUrl}/api/health`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ok");
  });

  it("returns ready only when the database probe succeeds", async () => {
    databaseAvailable = true;

    const response = await fetch(`${baseUrl}/api/health/ready`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.status, "ready");
    assert.equal(body.checks.database, "ok");
  });

  it("returns a generic 503 when the database probe fails", async () => {
    databaseAvailable = false;

    const response = await fetch(`${baseUrl}/api/health/ready`);
    const bodyText = await response.text();
    const body = JSON.parse(bodyText);

    assert.equal(response.status, 503);
    assert.equal(body.status, "not_ready");
    assert.equal(body.checks.database, "unavailable");
    assert.doesNotMatch(bodyText, /private database detail/);
  });

  it("returns a generic 503 when a readiness probe exceeds its deadline", async () => {
    const app = express();
    app.use(
      "/api/health",
      createHealthRouter(
        {
          async checkDatabase() {
            await new Promise(() => undefined);
          },
        },
        { onProbe: () => undefined, timeoutMs: 10 }
      )
    );

    const timeoutServer = await listen(app);
    try {
      const address = timeoutServer.address();
      assert.ok(address && typeof address === "object");
      const response = await fetch(`http://127.0.0.1:${address.port}/api/health/ready`);
      const body = await response.json();

      assert.equal(response.status, 503);
      assert.equal(body.status, "not_ready");
    } finally {
      await close(timeoutServer);
    }
  });

  it("coalesces concurrent checks and serves a short success cache", async () => {
    let checks = 0;
    let currentTime = 1_000;
    let release: (() => void) | undefined;
    const coordinator = createReadinessCoordinator(
      {
        async checkDatabase() {
          checks += 1;
          await new Promise<void>((resolve) => {
            release = resolve;
          });
        },
      },
      {
        now: () => currentTime,
        onProbe: () => undefined,
        successCacheMs: 500,
        timeoutMs: 1_000,
      }
    );

    const first = coordinator.check();
    const second = coordinator.check();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(checks, 1);
    release?.();
    assert.deepEqual(await Promise.all([first, second]), [{ ready: true }, { ready: true }]);

    assert.deepEqual(await coordinator.check(), { ready: true });
    assert.equal(checks, 1);
    assert.deepEqual(coordinator.snapshot(), {
      cacheHits: 1,
      coalescedRequests: 1,
      failFastRequests: 0,
      probesStarted: 1,
    });

    currentTime += 501;
    const afterCache = coordinator.check();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(checks, 2);
    release?.();
    assert.deepEqual(await afterCache, { ready: true });
  });

  it("fails fast after a timed-out raw probe instead of queueing more probes", async () => {
    let checks = 0;
    let currentTime = 1_000;
    const observations: string[] = [];
    const coordinator = createReadinessCoordinator(
      {
        async checkDatabase() {
          checks += 1;
          await new Promise(() => undefined);
        },
      },
      {
        failureCacheMs: 5,
        now: () => currentTime,
        onProbe: ({ outcome }) => observations.push(outcome),
        timeoutMs: 5,
      }
    );

    assert.deepEqual(await coordinator.check(), { ready: false });
    currentTime += 6;
    assert.deepEqual(await coordinator.check(), { ready: false });
    assert.equal(checks, 1);
    assert.deepEqual(observations, ["timeout"]);
    assert.equal(coordinator.snapshot().failFastRequests, 1);
  });

  it("does not let an operational logger failure change readiness", async () => {
    const coordinator = createReadinessCoordinator(
      { async checkDatabase() {} },
      {
        onProbe() {
          throw new Error("logger unavailable");
        },
      }
    );

    assert.deepEqual(await coordinator.check(), { ready: true });
  });
});

function listen(app: express.Express) {
  return new Promise<Server>((resolve) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => resolve(listeningServer));
  });
}

function close(listeningServer: Server) {
  return new Promise<void>((resolve, reject) => {
    listeningServer.close((error) => (error ? reject(error) : resolve()));
  });
}
