import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Router } from "express";
import { z } from "zod";

import { AppError } from "../../lib/errors.js";
import { externalIdempotencyService } from "../project-connections/external-idempotency.service.js";
import {
  requireProjectConnection,
  type QaIntegrationAuth,
} from "../project-connections/project-connections.middleware.js";
import { qaAgentService } from "./qa-agent.service.js";
import { submitQaExecutionRecipeSchema } from "./qa-execution-recipes.schema.js";
import { qaExecutionRecipesService } from "./qa-execution-recipes.service.js";
import {
  addQaEvidenceSchema,
  createAgentQaRequestSchema,
  finishQaRunSchema,
  recordQaCheckResultSchema,
  startQaRunMcpSchema,
  submitQaChecklistSchema,
} from "./qa-requests.schema.js";
import type { QaActor } from "./qa-requests.types.js";

export const qaMcpRouter = Router();

qaMcpRouter.post("/", requireProjectConnection, async (req, res, next) => {
  const server = createOddpathMcpServer(req.qaIntegration!);
  const transport = new StreamableHTTPServerTransport({
    enableJsonResponse: true,
    sessionIdGenerator: undefined,
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("close", () => {
      void transport.close();
      void server.close();
    });
  } catch (error) {
    if (res.headersSent) {
      next(error);
      return;
    }
    res.status(500).json({
      error: { code: -32603, message: "Internal server error" },
      id: null,
      jsonrpc: "2.0",
    });
  }
});

qaMcpRouter.get("/", (_req, res) => {
  res.status(405).json(mcpMethodNotAllowed());
});

qaMcpRouter.delete("/", (_req, res) => {
  res.status(405).json(mcpMethodNotAllowed());
});

function createOddpathMcpServer(auth: QaIntegrationAuth) {
  const server = new McpServer(
    { name: "oddpath", version: "0.1.0" },
    { capabilities: { tools: {} } }
  );
  const actor: QaActor = {
    connectionTokenId: auth.connectionId,
    kind: "INTEGRATION",
    transport: "MCP",
    userId: auth.ownerId,
  };
  const requestId = z.string().trim().min(1).max(120);
  const runId = z.string().trim().min(1).max(120);
  const checklistItemId = z.string().trim().min(1).max(120);
  const operationId = z.string().trim().min(1).max(120);
  const recipeId = z.string().trim().min(1).max(120);
  const cursor = z.string().trim().max(500).optional();
  const idempotencyKey = z.string()
    .regex(/^[A-Za-z0-9._:-]{8,200}$/, "Use 8-200 URL-safe characters.");

  server.registerTool(
    "oddpath_list_requests",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "List QA Requests in the connected Oddpath project. Requests are the primary workflow objects, not chats.",
      inputSchema: { cursor, limit: z.number().int().min(1).max(100).default(30) },
      title: "List QA Requests",
    },
    toolHandler(async ({ cursor, limit }) => {
      assertScope(auth, "qa:read");
      return qaAgentService.listRequests(auth.projectId, { cursor, limit });
    })
  );

  server.registerTool(
    "oddpath_get_request",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Read one QA Request including the selected immutable checklist, runs, results, evidence, and audit history.",
      inputSchema: { requestId },
      title: "Get QA Request",
    },
    toolHandler(async ({ requestId }) => {
      assertScope(auth, "qa:read");
      return { request: await qaAgentService.getRequest(auth.projectId, requestId) };
    })
  );

  server.registerTool(
    "oddpath_get_operation",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Read the durable status of an asynchronous Oddpath generation or review operation.",
      inputSchema: { operationId },
      title: "Get QA Operation",
    },
    toolHandler(async ({ operationId }) => {
      assertScope(auth, "qa:read");
      return { operation: await qaAgentService.getOperation(auth.projectId, operationId) };
    })
  );

  server.registerTool(
    "oddpath_list_execution_recipes",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "List immutable structured Execution Recipe candidates for a QA Request.",
      inputSchema: { requestId },
      title: "List Execution Recipes",
    },
    toolHandler(async ({ requestId }) => {
      assertScope(auth, "qa:read");
      return {
        recipes: await qaExecutionRecipesService.agentListRecipes(auth.projectId, requestId),
      };
    })
  );

  server.registerTool(
    "oddpath_get_execution_recipe",
    {
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      description: "Read one immutable structured Execution Recipe and its Oddpath assessment.",
      inputSchema: { recipeId, requestId },
      title: "Get Execution Recipe",
    },
    toolHandler(async ({ recipeId, requestId }) => {
      assertScope(auth, "qa:read");
      return {
        recipe: await qaExecutionRecipesService.agentGetRecipe(
          auth.projectId,
          requestId,
          recipeId
        ),
      };
    })
  );

  server.registerTool(
    "oddpath_submit_execution_recipe",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Submit a bounded RecipeV1 candidate for the selected immutable checklist. Oddpath validates and reviews it; a human approves it per run.",
      inputSchema: submitQaExecutionRecipeSchema.extend({ idempotencyKey, requestId }),
      title: "Submit Execution Recipe",
    },
    toolHandler(async ({ idempotencyKey, requestId, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.execution-recipe.submit",
        idempotencyKey,
        { input, projectId: auth.projectId, requestId },
        () => qaExecutionRecipesService.agentSubmitRecipe(actor, auth.projectId, requestId, input)
      );
    })
  );

  server.registerTool(
    "oddpath_create_request",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Create a project-scoped QA Request for an agent-provided checklist. The project owner must select a reviewed checklist before execution.",
      inputSchema: createAgentQaRequestSchema.extend({ idempotencyKey }),
      title: "Create QA Request",
    },
    toolHandler(async ({ idempotencyKey, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.request.create",
        idempotencyKey,
        { input, projectId: auth.projectId },
        () => qaAgentService.createRequest(actor, auth.projectId, input)
      );
    })
  );

  server.registerTool(
    "oddpath_submit_checklist",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Submit an immutable QA Checklist candidate. Oddpath reviews it and the project owner chooses the final revision.",
      inputSchema: submitQaChecklistSchema.extend({ idempotencyKey, requestId }),
      title: "Submit QA Checklist",
    },
    toolHandler(async ({ idempotencyKey, requestId, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.checklist.submit",
        idempotencyKey,
        { input, projectId: auth.projectId, requestId },
        () => qaAgentService.submitChecklist(actor, auth.projectId, requestId, input)
      );
    })
  );

  server.registerTool(
    "oddpath_start_run",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description: "Start a new execution of the owner-selected checklist. Oddpath coordinates the record; the connected agent executes the checks.",
      inputSchema: startQaRunMcpSchema,
      title: "Start QA Run",
    },
    toolHandler(async ({ idempotencyKey, requestId, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.run.start",
        idempotencyKey,
        { input, projectId: auth.projectId, requestId },
        () => qaAgentService.startRun(actor, auth.projectId, requestId, input)
      );
    })
  );

  server.registerTool(
    "oddpath_record_result",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description: "Record or replace one checklist item's observed result using optimistic run versioning.",
      inputSchema: recordQaCheckResultSchema.extend({ checklistItemId, idempotencyKey, requestId, runId }),
      title: "Record QA Result",
    },
    toolHandler(async ({ checklistItemId, idempotencyKey, requestId, runId, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.result.record",
        idempotencyKey,
        { checklistItemId, input, projectId: auth.projectId, requestId, runId },
        async () => ({
          request: await qaAgentService.recordCheckResult(
            actor,
            auth.projectId,
            requestId,
            runId,
            checklistItemId,
            input
          ),
        })
      );
    })
  );

  server.registerTool(
    "oddpath_add_evidence",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
      description: "Attach concrete text, file, trace, log, screenshot, or reference evidence to a run and optional requirement.",
      inputSchema: { evidence: addQaEvidenceSchema, idempotencyKey, requestId, runId },
      title: "Add QA Evidence",
    },
    toolHandler(async ({ evidence, idempotencyKey, requestId, runId }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "evidence:write");
      return executeMcpMutation(
        auth,
        "qa.evidence.add",
        idempotencyKey,
        { evidence, projectId: auth.projectId, requestId, runId },
        () => qaAgentService.addEvidence(actor, auth.projectId, requestId, runId, evidence)
      );
    })
  );

  server.registerTool(
    "oddpath_finish_run",
    {
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      description: "Submit all run results. Oddpath computes the outcome and blocks human review until required evidence exists.",
      inputSchema: finishQaRunSchema.extend({ idempotencyKey, requestId, runId }),
      title: "Finish QA Run",
    },
    toolHandler(async ({ idempotencyKey, requestId, runId, ...input }) => {
      assertScope(auth, "qa:read");
      assertScope(auth, "qa:write");
      return executeMcpMutation(
        auth,
        "qa.run.finish",
        idempotencyKey,
        { input, projectId: auth.projectId, requestId, runId },
        async () => ({
          request: await qaAgentService.finishRun(actor, auth.projectId, requestId, runId, input),
        })
      );
    })
  );

  return server;
}

async function executeMcpMutation<T>(
  auth: QaIntegrationAuth,
  operation: string,
  key: string | undefined,
  request: unknown,
  action: () => Promise<T>
) {
  const result = await externalIdempotencyService.execute(
    {
      credentialId: auth.connectionId,
      key,
      operation,
      request,
    },
    async () => ({ body: await action(), status: 200 })
  );
  return result.body;
}

function toolHandler<TInput extends Record<string, unknown>>(
  handler: (input: TInput) => Promise<unknown>
) {
  return async (input: TInput) => {
    try {
      const output = toJsonObject(await handler(input));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(output) }],
        structuredContent: output,
      };
    } catch (error) {
      const code = error instanceof AppError ? error.code : "QA_TOOL_FAILED";
      const message = error instanceof AppError && error.expose
        ? error.message
        : "Oddpath could not complete this tool call.";
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ code, error: message }) }],
        isError: true,
      };
    }
  };
}

function assertScope(auth: QaIntegrationAuth, scope: "qa:read" | "qa:write" | "evidence:write") {
  if (!auth.scopes.includes(scope)) {
    throw new AppError("Connection scope is insufficient.", 403, "CONNECTION_SCOPE_REQUIRED");
  }
}

function toJsonObject(value: unknown): Record<string, unknown> {
  const serialized = JSON.parse(JSON.stringify(value)) as unknown;
  return serialized && typeof serialized === "object" && !Array.isArray(serialized)
    ? serialized as Record<string, unknown>
    : { value: serialized };
}

function mcpMethodNotAllowed() {
  return {
    error: { code: -32000, message: "Method not allowed." },
    id: null,
    jsonrpc: "2.0",
  };
}
