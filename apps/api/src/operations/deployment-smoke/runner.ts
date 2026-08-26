import { randomUUID } from "node:crypto";

import {
  assertAuthenticatedLogin,
  assertCorsAllowed,
  assertCsrfResponse,
  assertCurrentUser,
  assertProjectPresence,
  assertRecordFields,
  assertRegistrationConfiguration,
  assertSecurityHeaders,
  createRejectedOrigin,
  readProjectId,
} from "./assertions.js";
import {
  isBoundedValue,
  normalizeTargetOrigin,
  parseCsrfHeaderName,
  parseTimeoutValue,
} from "./configuration.js";
import { SmokeHttpClient } from "./http-client.js";
import {
  AUTHENTICATED_MUTATION_CONFIRMATION,
  type AuthenticatedMutationDeploymentSmokeOptions,
  configurationError,
  DeploymentSmokeError,
  type DeploymentSmokeMode,
  type DeploymentSmokeReport,
  MAX_SMOKE_EMAIL_LENGTH,
  MAX_SMOKE_PASSWORD_LENGTH,
  type ReadOnlyDeploymentSmokeOptions,
  SmokeProbeError,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;

export async function runReadOnlyDeploymentSmoke(
  options: ReadOnlyDeploymentSmokeOptions
): Promise<DeploymentSmokeReport> {
  const context = createSmokeContext("read-only", options);

  const liveness = await context.check("api_liveness", async () => {
    const result = await context.client.requestJson("/api/health", {
      expectedStatus: 200,
    });
    assertRecordFields(result.body, {
      service: "oddpath-api",
      status: "ok",
    });
    return result;
  });

  await context.check("api_security_headers", async () => {
    assertSecurityHeaders(liveness.response, context.isHttps);
  });

  await context.check("database_readiness", async () => {
    const readiness = await context.client.requestJson("/api/health/ready", {
      expectedStatus: 200,
    });
    assertRecordFields(readiness.body, {
      service: "oddpath-api",
      status: "ready",
    });
    assertRecordFields(readNestedRecord(readiness.body, "checks"), {
      database: "ok",
    });
  });

  await context.check("registration_configuration", async () => {
    const registration = await context.client.requestJson(
      "/api/auth/registration-config",
      { expectedStatus: 200 }
    );
    assertRegistrationConfiguration(registration.body);
  });

  await context.check("unauthenticated_boundary", async () => {
    const unauthenticated = await context.client.requestJson("/api/auth/me", {
      expectedStatus: 401,
    });
    assertRecordFields(unauthenticated.body, { code: "SESSION_REQUIRED" });
  });

  await context.check("csrf_issuance", async () => {
    const csrf = await context.client.requestJson("/api/auth/csrf", {
      expectedStatus: 200,
    });
    assertCsrfResponse(csrf, context.isHttps);
  });

  if (context.webOrigin) {
    const webOrigin = context.webOrigin;
    await context.check("cors_allowed_origin", async () => {
      const allowedCors = await context.client.requestJson("/api/health", {
        expectedStatus: 200,
        origin: webOrigin,
      });
      assertCorsAllowed(allowedCors.response, webOrigin);
    });

    await context.check("cors_rejected_origin", async () => {
      const rejectedCors = await context.client.requestJson("/api/health", {
        expectedStatus: 403,
        origin: createRejectedOrigin(webOrigin),
      });
      assertRecordFields(rejectedCors.body, { code: "CORS_FORBIDDEN" });
      if (rejectedCors.response.headers.has("access-control-allow-origin")) {
        throw new SmokeProbeError("invalid_response");
      }
    });
  }

  return context.report();
}

export async function runAuthenticatedMutationDeploymentSmoke(
  options: AuthenticatedMutationDeploymentSmokeOptions
): Promise<DeploymentSmokeReport> {
  assertAuthenticatedMutationOptions(options);
  const context = createSmokeContext("authenticated-mutation", options);
  const randomId = options.randomId ?? randomUUID;
  const uniqueId = randomId();
  if (!/^[A-Za-z0-9-]{1,64}$/.test(uniqueId)) throw configurationError();
  const projectName = `Oddpath deployment smoke ${uniqueId}`;
  let authenticated = false;
  let createdProjectId: string | undefined;
  let failure: unknown;

  try {
    await context.check("authenticated_csrf_issuance", async () => {
      const csrf = await context.client.requestJson("/api/auth/csrf", {
        expectedStatus: 200,
      });
      const csrfToken = assertCsrfResponse(csrf, context.isHttps);
      context.client.setCsrfToken(csrfToken);
    });

    await context.check("authenticated_login", async () => {
      const login = await context.client.requestJson("/api/auth/login", {
        body: {
          email: options.credentials.email,
          password: options.credentials.password,
          remember: false,
        },
        expectedStatus: 200,
        method: "POST",
      });
      authenticated = context.client.hasCookie("qa_session");
      assertAuthenticatedLogin(login, context.isHttps);
    });

    await context.check("authenticated_session", async () => {
      const currentUser = await context.client.requestJson("/api/auth/me", {
        expectedStatus: 200,
      });
      assertCurrentUser(currentUser.body);
    });

    await context.check("project_create", async () => {
      const created = await context.client.requestJson("/api/projects", {
        body: {
          description: "Temporary deployment smoke resource; safe to delete.",
          name: projectName,
        },
        expectedStatus: 201,
        method: "POST",
      });
      createdProjectId = readProjectId(created.body);
    });

    await context.check("project_update", async () => {
      const projectId = requireCreatedProjectId(createdProjectId);
      const updated = await context.client.requestJson(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          body: {
            description: "Temporary deployment smoke resource; cleanup required.",
            name: `${projectName} verified`,
          },
          expectedStatus: 200,
          method: "PUT",
        }
      );
      if (readProjectId(updated.body) !== projectId) {
        throw new SmokeProbeError("invalid_response");
      }
    });

    await context.check("project_visible", async () => {
      const projectId = requireCreatedProjectId(createdProjectId);
      const visible = await context.client.requestJson("/api/projects", {
        expectedStatus: 200,
      });
      assertProjectPresence(visible.body, projectId, true);
    });

    await context.check("project_delete", async () => {
      const projectId = requireCreatedProjectId(createdProjectId);
      const deleted = await context.client.requestJson(
        `/api/projects/${encodeURIComponent(projectId)}`,
        {
          expectedStatus: 200,
          method: "DELETE",
        }
      );
      assertRecordFields(deleted.body, { ok: true });
    });
    const deletedProjectId = requireCreatedProjectId(createdProjectId);

    await context.check("project_removed", async () => {
      const absent = await context.client.requestJson("/api/projects", {
        expectedStatus: 200,
      });
      assertProjectPresence(absent.body, deletedProjectId, false);
    });
    createdProjectId = undefined;
  } catch (error) {
    failure = error;
  } finally {
    if (createdProjectId) {
      const cleanupProjectId = createdProjectId;
      try {
        await context.check("temporary_project_cleanup", async () => {
          const cleaned = await context.client.requestJson(
            `/api/projects/${encodeURIComponent(cleanupProjectId)}`,
            {
              expectedStatus: [200, 404],
              method: "DELETE",
            }
          );
          if (cleaned.response.status === 200) {
            assertRecordFields(cleaned.body, { ok: true });
          }
        });
        createdProjectId = undefined;
      } catch {
        failure = new DeploymentSmokeError(
          "temporary_project_cleanup",
          "cleanup_failed"
        );
      }
    }

    if (authenticated) {
      try {
        await context.check("authenticated_logout", async () => {
          const logout = await context.client.requestJson("/api/auth/logout", {
            expectedStatus: 200,
            method: "POST",
          });
          assertRecordFields(logout.body, { ok: true });
        });
      } catch (error) {
        failure ??= error;
      }
    }
  }

  if (failure) throw failure;
  return context.report();
}

function createSmokeContext(
  mode: DeploymentSmokeMode,
  options: ReadOnlyDeploymentSmokeOptions
) {
  const baseUrl = normalizeTargetOrigin(options.baseUrl);
  const webOrigin = options.webOrigin
    ? normalizeTargetOrigin(options.webOrigin)
    : undefined;
  const timeoutMs = parseTimeoutValue(options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const csrfHeaderName = parseCsrfHeaderName(options.csrfHeaderName);
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const checks: DeploymentSmokeReport["checks"] = [];
  const client = new SmokeHttpClient({
    baseUrl,
    csrfHeaderName,
    fetchImpl,
    timeoutMs,
    ...(webOrigin ? { webOrigin } : {}),
  });

  return {
    check: async <T>(name: string, action: () => Promise<T>): Promise<T> => {
      const startedAt = now();
      try {
        const result = await action();
        checks.push({
          durationMs: Math.max(0, now() - startedAt),
          name,
        });
        return result;
      } catch (error) {
        if (error instanceof DeploymentSmokeError) throw error;
        const reason = error instanceof SmokeProbeError
          ? error.reason
          : "invalid_response";
        throw new DeploymentSmokeError(name, reason);
      }
    },
    client,
    isHttps: new URL(baseUrl).protocol === "https:",
    report: (): DeploymentSmokeReport => ({ checks: [...checks], mode, status: "passed" }),
    webOrigin,
  };
}

function assertAuthenticatedMutationOptions(
  options: AuthenticatedMutationDeploymentSmokeOptions
) {
  if (
    options.confirmation !== AUTHENTICATED_MUTATION_CONFIRMATION ||
    !isBoundedValue(options.webOrigin, 2_048) ||
    !isBoundedValue(options.credentials.email, MAX_SMOKE_EMAIL_LENGTH) ||
    !isBoundedValue(options.credentials.password, MAX_SMOKE_PASSWORD_LENGTH)
  ) {
    throw configurationError();
  }
}

function readNestedRecord(value: unknown, key: string) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SmokeProbeError("invalid_response");
  }
  const nested = (value as Record<string, unknown>)[key];
  if (!nested || typeof nested !== "object" || Array.isArray(nested)) {
    throw new SmokeProbeError("invalid_response");
  }
  return nested as Record<string, unknown>;
}

function requireCreatedProjectId(value: string | undefined) {
  if (!value) throw new SmokeProbeError("invalid_response");
  return value;
}
