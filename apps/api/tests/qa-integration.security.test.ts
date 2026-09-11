import assert from "node:assert/strict";
import type { Server } from "node:http";
import { describe, it } from "node:test";

import express, { type NextFunction, type Request, type Response } from "express";

import { createApp } from "../src/app.ts";
import { AppError } from "../src/lib/errors.ts";
import { createProjectConnectionPreBodyRateLimit } from "../src/modules/project-connections/project-connections.rateLimit.ts";
import type { QaConnectionScope } from "../src/modules/project-connections/project-connections.schema.ts";
import { qaAgentRouter } from "../src/modules/qa-requests/qa-agent.routes.ts";

describe("QA integration security boundary", () => {
  it("rejects a missing bearer token before parsing a malformed JSON body", async () => {
    await withServer(createApp(), async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/mcp`, {
        body: "{",
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = await response.json() as { code?: string };

      assert.equal(response.status, 401);
      assert.equal(body.code, "CONNECTION_TOKEN_REQUIRED");
    });
  });

  it("limits a bearer credential independently from the shared IP budget", async () => {
    const app = express();
    app.use(createProjectConnectionPreBodyRateLimit({
      ipLimit: 10,
      tokenLimit: 1,
      windowMs: 60_000,
    }));
    app.post("/", express.json(), (_req, res) => res.json({ ok: true }));

    await withServer(app, async (baseUrl) => {
      assert.equal((await postJson(baseUrl, "token-one")).status, 200);
      assert.equal((await postJson(baseUrl, "token-one")).status, 429);
      assert.equal((await postJson(baseUrl, "token-two")).status, 200);
    });
  });

  it("does not leak full request data through write-only mutation responses", async () => {
    for (const scopes of [["qa:write"], ["evidence:write"]] as QaConnectionScope[][]) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.qaIntegration = {
          connectionId: "connection-1",
          ownerId: "owner-1",
          projectId: "project-1",
          scopes,
        };
        next();
      });
      app.use(qaAgentRouter);
      app.use(appErrorResponse);

      await withServer(app, async (baseUrl) => {
        const route = scopes.includes("qa:write")
          ? "/projects/project-1/qa/requests"
          : "/projects/project-1/qa/requests/request-1/runs/run-1/evidence";
        const response = await fetch(`${baseUrl}${route}`, {
          body: JSON.stringify(scopes.includes("qa:write")
            ? { objective: "Verify checkout", title: "Checkout" }
            : { assetIds: [], kind: "TEXT", textContent: "log" }),
          headers: { "content-type": "application/json" },
          method: "POST",
        });
        const body = await response.json() as { code?: string };

        assert.equal(response.status, 403);
        assert.equal(body.code, "CONNECTION_SCOPE_REQUIRED");
      });
    }
  });

  it("keeps agent and runner presets separated at the route boundary", async () => {
    const cases: Array<{
      body: unknown;
      method: "POST" | "PUT";
      path: string;
      scopes: QaConnectionScope[];
    }> = [
      {
        body: {},
        method: "PUT",
        path: "/runner/v1/registration",
        scopes: ["evidence:write", "qa:read", "qa:write"],
      },
      {
        body: { checklistMode: "AGENT_PROVIDED", objective: "Verify checkout", title: "Checkout" },
        method: "POST",
        path: "/projects/project-1/qa/requests",
        scopes: ["evidence:write", "execution:claim", "execution:write", "qa:read"],
      },
    ];

    for (const testCase of cases) {
      const app = express();
      app.use(express.json());
      app.use((req, _res, next) => {
        req.qaIntegration = {
          connectionId: "connection-1",
          ownerId: "owner-1",
          projectId: "project-1",
          scopes: testCase.scopes,
        };
        next();
      });
      app.use(qaAgentRouter);
      app.use(appErrorResponse);

      await withServer(app, async (baseUrl) => {
        const response = await fetch(`${baseUrl}${testCase.path}`, {
          body: JSON.stringify(testCase.body),
          headers: { "content-type": "application/json" },
          method: testCase.method,
        });
        const body = await response.json() as { code?: string };

        assert.equal(response.status, 403);
        assert.equal(body.code, "CONNECTION_SCOPE_REQUIRED");
      });
    }
  });
});

async function postJson(baseUrl: string, token: string) {
  return fetch(`${baseUrl}/`, {
    body: JSON.stringify({ ok: true }),
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    method: "POST",
  });
}

async function withServer(app: express.Express, action: (baseUrl: string) => Promise<void>) {
  let server: Server | undefined;
  const baseUrl = await new Promise<string>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server!.address();
      assert.ok(address && typeof address === "object");
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });

  try {
    await action(baseUrl);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server!.close((error) => error ? reject(error) : resolve());
    });
  }
}

function appErrorResponse(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
) {
  const appError = error instanceof AppError ? error : undefined;
  res.status(appError?.statusCode || 500).json({ code: appError?.code || "INTERNAL_ERROR" });
}
