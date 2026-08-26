import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  AUTHENTICATED_MUTATION_CONFIRMATION,
  createDeploymentSmokeFailureEvent,
  DeploymentSmokeError,
  loadDeploymentSmokeCliConfig,
  runAuthenticatedMutationDeploymentSmoke,
  runReadOnlyDeploymentSmoke,
} from "../src/operations/deployment-smoke/index.ts";

const API_ORIGIN = "https://api-staging.example.com";
const WEB_ORIGIN = "https://web-staging.example.com";
const CSRF_TOKEN = "csrf-secret-value";
const TEST_EMAIL = "smoke@example.com";
const TEST_PASSWORD = "long smoke password value";
const PROJECT_ID = "project-smoke-id";

describe("deployment smoke configuration", () => {
  it("loads read-only configuration without retaining mutation credentials", () => {
    const config = loadDeploymentSmokeCliConfig(["--mode=read-only"], {
      ODDPATH_SMOKE_BASE_URL: `${API_ORIGIN}/`,
      ODDPATH_SMOKE_EMAIL: TEST_EMAIL,
      ODDPATH_SMOKE_PASSWORD: TEST_PASSWORD,
      ODDPATH_SMOKE_WEB_ORIGIN: WEB_ORIGIN,
    });

    assert.deepEqual(config, {
      baseUrl: API_ORIGIN,
      csrfHeaderName: "X-CSRF-Token",
      mode: "read-only",
      timeoutMs: 10_000,
      webOrigin: WEB_ORIGIN,
    });
    assert.equal("credentials" in config, false);

    const mutationConfig = loadDeploymentSmokeCliConfig(
      ["--mode=authenticated-mutation"],
      {
        ODDPATH_SMOKE_BASE_URL: API_ORIGIN,
        ODDPATH_SMOKE_EMAIL: TEST_EMAIL,
        ODDPATH_SMOKE_MUTATION_CONFIRMATION:
          AUTHENTICATED_MUTATION_CONFIRMATION,
        ODDPATH_SMOKE_PASSWORD: TEST_PASSWORD,
        ODDPATH_SMOKE_WEB_ORIGIN: WEB_ORIGIN,
      }
    );
    assert.equal(mutationConfig.mode, "authenticated-mutation");
    assert.equal(mutationConfig.webOrigin, WEB_ORIGIN);
  });

  it("fails closed for unsafe targets, unknown arguments, and incomplete mutation opt-in", () => {
    const invalidSources: NodeJS.ProcessEnv[] = [
      {},
      { ODDPATH_SMOKE_BASE_URL: "http://api.example.com" },
      { ODDPATH_SMOKE_BASE_URL: `${API_ORIGIN}/api` },
      { ODDPATH_SMOKE_BASE_URL: `https://user:secret@api.example.com` },
      {
        ODDPATH_SMOKE_BASE_URL: API_ORIGIN,
        ODDPATH_SMOKE_CSRF_HEADER_NAME: "invalid header",
      },
    ];

    for (const source of invalidSources) {
      assert.throws(
        () => loadDeploymentSmokeCliConfig(["--mode=read-only"], source),
        isConfigurationFailure
      );
    }

    assert.throws(
      () => loadDeploymentSmokeCliConfig(["--mode=other"], {
        ODDPATH_SMOKE_BASE_URL: API_ORIGIN,
      }),
      isConfigurationFailure
    );
    assert.throws(
      () => loadDeploymentSmokeCliConfig(["--mode=authenticated-mutation"], {
        ODDPATH_SMOKE_BASE_URL: API_ORIGIN,
        ODDPATH_SMOKE_EMAIL: TEST_EMAIL,
        ODDPATH_SMOKE_MUTATION_CONFIRMATION:
          AUTHENTICATED_MUTATION_CONFIRMATION,
        ODDPATH_SMOKE_PASSWORD: TEST_PASSWORD,
      }),
      isConfigurationFailure
    );
  });

  it("accepts HTTP only for an explicit loopback development target", () => {
    const config = loadDeploymentSmokeCliConfig(["--mode=read-only"], {
      ODDPATH_SMOKE_BASE_URL: "http://127.0.0.1:5000",
      ODDPATH_SMOKE_TIMEOUT_MS: "500",
    });

    assert.equal(config.baseUrl, "http://127.0.0.1:5000");
    assert.equal(config.timeoutMs, 500);
  });
});

describe("deployment smoke output", () => {
  it("reduces unknown failures to fixed fields without serializing secrets", () => {
    const secret = "password-and-token-in-raw-error";
    const event = createDeploymentSmokeFailureEvent(
      new Error(`Request failed with ${secret} at ${API_ORIGIN}`)
    );
    const serialized = JSON.stringify(event);

    assert.deepEqual(event, {
      event: "deployment_smoke",
      failedCheck: "runner",
      reason: "invalid_response",
      status: "failed",
    });
    assert.equal(serialized.includes(secret), false);
    assert.equal(serialized.includes(API_ORIGIN), false);
  });
});

describe("read-only deployment smoke", () => {
  it("uses only safe GET requests and validates health, security, auth, CSRF, and CORS", async () => {
    const requests: CapturedRequest[] = [];
    const fetchImpl = createFetch(async (request) => {
      requests.push(request);
      const { pathname } = new URL(request.url);
      const origin = request.headers.get("origin");

      if (pathname === "/api/health" && origin === "https://smoke-rejected.invalid") {
        return jsonResponse({ code: "CORS_FORBIDDEN" }, { status: 403 });
      }
      if (pathname === "/api/health") {
        return healthResponse(origin === WEB_ORIGIN ? WEB_ORIGIN : undefined);
      }
      if (pathname === "/api/health/ready") {
        return jsonResponse({
          checks: { database: "ok" },
          service: "oddpath-api",
          status: "ready",
        });
      }
      if (pathname === "/api/auth/registration-config") {
        return registrationConfigResponse();
      }
      if (pathname === "/api/auth/me") {
        return jsonResponse({ code: "SESSION_REQUIRED" }, { status: 401 });
      }
      if (pathname === "/api/auth/csrf") {
        return jsonResponse(
          { csrfToken: CSRF_TOKEN },
          { setCookie: `qa_csrf=${CSRF_TOKEN}; Path=/; Secure; SameSite=Lax` }
        );
      }
      throw new Error("Unexpected test route");
    });

    const report = await runReadOnlyDeploymentSmoke({
      baseUrl: API_ORIGIN,
      fetchImpl,
      now: createMonotonicClock(),
      webOrigin: WEB_ORIGIN,
    });

    assert.equal(report.status, "passed");
    assert.deepEqual(
      report.checks.map((check) => check.name),
      [
        "api_liveness",
        "api_security_headers",
        "database_readiness",
        "registration_configuration",
        "unauthenticated_boundary",
        "csrf_issuance",
        "cors_allowed_origin",
        "cors_rejected_origin",
      ]
    );
    assert.ok(requests.length > 0);
    assert.ok(requests.every((request) => request.method === "GET"));
    assert.ok(requests.every((request) => request.body === undefined));
    assert.equal(JSON.stringify(report).includes(CSRF_TOKEN), false);
    assert.equal(JSON.stringify(report).includes(API_ORIGIN), false);
  });

  it("returns a bounded failure that excludes an untrusted response body", async () => {
    const responseSecret = "response-body-secret";
    const fetchImpl = createFetch(async () =>
      jsonResponse({ detail: responseSecret }, { status: 502 })
    );

    await assert.rejects(
      () => runReadOnlyDeploymentSmoke({ baseUrl: API_ORIGIN, fetchImpl }),
      (error: unknown) => {
        assert.ok(error instanceof DeploymentSmokeError);
        assert.equal(error.check, "api_liveness");
        assert.equal(error.reason, "unexpected_status");
        assert.equal(String(error).includes(responseSecret), false);
        return true;
      }
    );
  });
});

describe("authenticated mutation deployment smoke", () => {
  it("requires explicit opt-in and removes only its own temporary project", async () => {
    const state = createAuthenticatedApiState();
    const fetchImpl = createAuthenticatedFetch(state);

    const report = await runAuthenticatedMutationDeploymentSmoke({
      baseUrl: API_ORIGIN,
      confirmation: AUTHENTICATED_MUTATION_CONFIRMATION,
      credentials: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
      fetchImpl,
      now: createMonotonicClock(),
      randomId: () => "fixed-run-id",
      webOrigin: WEB_ORIGIN,
    });

    assert.equal(report.status, "passed");
    assert.equal(state.created, true);
    assert.equal(state.deleted, true);
    assert.equal(state.logoutCalled, true);
    assert.equal(state.deleteAttempts, 1);
    assert.ok(
      state.requests
        .filter((request) => request.method !== "GET")
        .every(
          (request) =>
            request.headers.get("x-csrf-token") === CSRF_TOKEN &&
            request.headers.get("cookie")?.includes(`qa_csrf=${CSRF_TOKEN}`) &&
            request.headers.get("origin") === WEB_ORIGIN
        )
    );

    const serializedReport = JSON.stringify(report);
    for (const sensitive of [
      API_ORIGIN,
      CSRF_TOKEN,
      PROJECT_ID,
      TEST_EMAIL,
      TEST_PASSWORD,
    ]) {
      assert.equal(serializedReport.includes(sensitive), false);
    }
  });

  it("attempts project cleanup and logout after a later mutation check fails", async () => {
    const state = createAuthenticatedApiState();
    state.failUpdate = true;

    await assert.rejects(
      () =>
        runAuthenticatedMutationDeploymentSmoke({
          baseUrl: API_ORIGIN,
          confirmation: AUTHENTICATED_MUTATION_CONFIRMATION,
          credentials: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          },
          fetchImpl: createAuthenticatedFetch(state),
          randomId: () => "cleanup-run-id",
          webOrigin: WEB_ORIGIN,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeploymentSmokeError);
        assert.equal(error.check, "project_update");
        assert.equal(error.reason, "unexpected_status");
        assert.equal(String(error).includes(TEST_PASSWORD), false);
        return true;
      }
    );

    assert.equal(state.created, true);
    assert.equal(state.deleted, true);
    assert.equal(state.deleteAttempts, 1);
    assert.equal(state.logoutCalled, true);
  });

  it("retries exact-id cleanup when post-delete absence verification fails", async () => {
    const state = createAuthenticatedApiState();
    state.failPresenceAfterDelete = true;

    await assert.rejects(
      () =>
        runAuthenticatedMutationDeploymentSmoke({
          baseUrl: API_ORIGIN,
          confirmation: AUTHENTICATED_MUTATION_CONFIRMATION,
          credentials: {
            email: TEST_EMAIL,
            password: TEST_PASSWORD,
          },
          fetchImpl: createAuthenticatedFetch(state),
          randomId: () => "absence-cleanup-run-id",
          webOrigin: WEB_ORIGIN,
        }),
      (error: unknown) => {
        assert.ok(error instanceof DeploymentSmokeError);
        assert.equal(error.check, "project_removed");
        return true;
      }
    );

    assert.equal(state.deleteAttempts, 2);
    assert.equal(state.logoutCalled, true);
  });

  it("does not send credentials when mutation confirmation is absent", async () => {
    let fetchCalls = 0;
    await assert.rejects(
      () =>
        runAuthenticatedMutationDeploymentSmoke({
          baseUrl: API_ORIGIN,
          confirmation: "",
          credentials: { email: TEST_EMAIL, password: TEST_PASSWORD },
          fetchImpl: createFetch(async () => {
            fetchCalls += 1;
            return jsonResponse({});
          }),
          webOrigin: WEB_ORIGIN,
        }),
      isConfigurationFailure
    );
    assert.equal(fetchCalls, 0);
  });
});

interface CapturedRequest {
  body?: string;
  headers: Headers;
  method: string;
  url: string;
}

interface AuthenticatedApiState {
  created: boolean;
  deleteAttempts: number;
  deleted: boolean;
  failUpdate: boolean;
  failPresenceAfterDelete: boolean;
  logoutCalled: boolean;
  requests: CapturedRequest[];
}

function createAuthenticatedApiState(): AuthenticatedApiState {
  return {
    created: false,
    deleteAttempts: 0,
    deleted: false,
    failUpdate: false,
    failPresenceAfterDelete: false,
    logoutCalled: false,
    requests: [],
  };
}

function createAuthenticatedFetch(state: AuthenticatedApiState) {
  return createFetch(async (request) => {
    state.requests.push(request);
    const { pathname } = new URL(request.url);

    if (pathname === "/api/auth/csrf") {
      return jsonResponse(
        { csrfToken: CSRF_TOKEN },
        { setCookie: `qa_csrf=${CSRF_TOKEN}; Path=/; Secure; SameSite=Lax` }
      );
    }
    if (pathname === "/api/auth/login") {
      assert.deepEqual(JSON.parse(request.body || "{}"), {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
        remember: false,
      });
      return jsonResponse(
        authenticatedUserResponse(),
        {
          setCookie:
            "qa_session=session-secret-value; Path=/; HttpOnly; Secure; SameSite=Lax",
        }
      );
    }
    if (pathname === "/api/auth/me") {
      assert.match(request.headers.get("cookie") || "", /qa_session=session-secret-value/);
      return jsonResponse({ user: authenticatedUserResponse().user });
    }
    if (pathname === "/api/projects" && request.method === "POST") {
      state.created = true;
      return jsonResponse({ project: projectResponse() }, { status: 201 });
    }
    if (pathname === `/api/projects/${PROJECT_ID}` && request.method === "PUT") {
      if (state.failUpdate) {
        return jsonResponse({ detail: TEST_PASSWORD }, { status: 500 });
      }
      return jsonResponse({ project: projectResponse() });
    }
    if (pathname === "/api/projects" && request.method === "GET") {
      if (state.deleted && state.failPresenceAfterDelete) {
        state.failPresenceAfterDelete = false;
        return jsonResponse({}, { status: 500 });
      }
      return jsonResponse({
        projects: state.created && !state.deleted ? [projectResponse()] : [],
      });
    }
    if (pathname === `/api/projects/${PROJECT_ID}` && request.method === "DELETE") {
      state.deleteAttempts += 1;
      if (state.deleted) {
        return jsonResponse({ code: "PROJECT_NOT_FOUND" }, { status: 404 });
      }
      state.deleted = true;
      return jsonResponse({ ok: true });
    }
    if (pathname === "/api/auth/logout") {
      state.logoutCalled = true;
      return jsonResponse(
        { ok: true },
        {
          setCookie:
            "qa_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0",
        }
      );
    }
    throw new Error("Unexpected test route");
  });
}

function createFetch(
  handler: (request: CapturedRequest) => Promise<Response>
): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const request: CapturedRequest = {
      headers: new Headers(init?.headers),
      method: init?.method || "GET",
      url: input instanceof Request ? input.url : String(input),
      ...(typeof init?.body === "string" ? { body: init.body } : {}),
    };
    return handler(request);
  }) as typeof fetch;
}

function healthResponse(corsOrigin?: string) {
  const headers: Record<string, string> = {
    "cache-control": "no-store",
    "content-security-policy": "default-src 'none'; frame-ancestors 'none'",
    "permissions-policy": "camera=(), microphone=()",
    "referrer-policy": "no-referrer",
    "strict-transport-security": "max-age=31536000",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "x-request-id": "00000000-0000-4000-8000-000000000000",
  };
  if (corsOrigin) {
    headers["access-control-allow-origin"] = corsOrigin;
    headers["access-control-allow-credentials"] = "true";
  }
  return jsonResponse(
    { service: "oddpath-api", status: "ok", timestamp: new Date(0).toISOString() },
    { headers }
  );
}

function registrationConfigResponse() {
  const english = {
    privacy: "https://eluthira.com/oddpath/privacy",
    terms: "https://eluthira.com/oddpath/terms",
  };
  return jsonResponse({
    legalUrls: {
      ar: english,
      de: {
        privacy: "https://eluthira.com/de/oddpath/privacy",
        terms: "https://eluthira.com/de/oddpath/terms",
      },
      en: english,
    },
    mode: "disabled",
    termsVersion: "staging-v1",
  });
}

function authenticatedUserResponse() {
  return {
    session: { expiresAt: "2026-08-24T00:00:00.000Z" },
    user: {
      createdAt: "2026-08-23T00:00:00.000Z",
      email: TEST_EMAIL,
      emailVerifiedAt: "2026-08-23T00:01:00.000Z",
      id: "smoke-user-id",
      locale: "en",
      name: "Smoke Operator",
    },
  };
}

function projectResponse() {
  return {
    createdAt: "2026-08-23T00:00:00.000Z",
    description: "temporary",
    id: PROJECT_ID,
    name: "temporary",
    role: "OWNER",
    updatedAt: "2026-08-23T00:00:00.000Z",
  };
}

function jsonResponse(
  body: unknown,
  options: {
    headers?: Record<string, string>;
    setCookie?: string;
    status?: number;
  } = {}
) {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    ...options.headers,
  });
  if (options.setCookie) headers.append("set-cookie", options.setCookie);
  return new Response(JSON.stringify(body), {
    headers,
    status: options.status ?? 200,
  });
}

function createMonotonicClock() {
  let now = 0;
  return () => {
    now += 1;
    return now;
  };
}

function isConfigurationFailure(error: unknown) {
  return (
    error instanceof DeploymentSmokeError &&
    error.check === "configuration" &&
    error.reason === "invalid_configuration"
  );
}
