import assert from "node:assert/strict";
import type { Server } from "node:http";
import { describe, it } from "node:test";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import express from "express";

import { qaMcpRouter } from "../src/modules/qa-requests/qa-mcp.routes.ts";

describe("Oddpath MCP protocol", () => {
  it("completes the SDK handshake, lists tools, and enforces mutation scopes", async () => {
    const app = express();
    app.use((req, _res, next) => {
      req.qaIntegration = {
        connectionId: "connection-1",
        ownerId: "owner-1",
        projectId: "project-1",
        scopes: ["qa:read"],
      };
      next();
    });
    app.use(express.json({ limit: "1mb" }));
    app.use("/", qaMcpRouter);

    await withServer(app, async (baseUrl) => {
      const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/`), {
        requestInit: { headers: { authorization: "Bearer integration-test" } },
      });
      const client = new Client({ name: "oddpath-integration-test", version: "1.0.0" });

      try {
        await client.connect(transport);
        const tools = await client.listTools();
        assert.deepEqual(
          tools.tools.map((tool) => tool.name).sort(),
          [
            "oddpath_add_evidence",
            "oddpath_create_request",
            "oddpath_finish_run",
            "oddpath_get_execution_recipe",
            "oddpath_get_operation",
            "oddpath_get_request",
            "oddpath_list_execution_recipes",
            "oddpath_list_requests",
            "oddpath_record_result",
            "oddpath_start_run",
            "oddpath_submit_checklist",
            "oddpath_submit_execution_recipe",
          ]
        );

        const result = await client.callTool({
          arguments: {
            checklistMode: "AGENT_PROVIDED",
            idempotencyKey: "mcp-scope-test-001",
            objective: "Verify checkout",
            title: "Checkout QA",
          },
          name: "oddpath_create_request",
        });
        assert.equal(result.isError, true);
        assert.match(JSON.stringify(result.content), /CONNECTION_SCOPE_REQUIRED/);
      } finally {
        await client.close();
      }
    });
  });
});

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
