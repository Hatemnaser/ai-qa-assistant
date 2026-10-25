import {
  parseBoolean,
  parseList,
  parseNonNegativeInteger,
  parseNumber,
  parseStrictPositiveSafeInteger,
} from "../parsers.js";
import type { EnvLoadContext } from "../types.js";

export function loadCoreEnv({ nodeEnv, source }: EnvLoadContext) {
  return {
    nodeEnv,
    port: parseNumber(source.PORT, 5000),
    corsOrigins: parseList(source.CORS_ORIGIN, [
      "http://127.0.0.1:5173",
      "http://localhost:5173",
    ]),
    requestBodyLimit: source.REQUEST_BODY_LIMIT || "25mb",
    qaIntegrationIpRateLimitMax: parseStrictPositiveSafeInteger(
      source.QA_INTEGRATION_IP_RATE_LIMIT_MAX,
      120,
      "QA_INTEGRATION_IP_RATE_LIMIT_MAX"
    ),
    qaIntegrationTokenRateLimitMax: parseStrictPositiveSafeInteger(
      source.QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX,
      60,
      "QA_INTEGRATION_TOKEN_RATE_LIMIT_MAX"
    ),
    qaIntegrationRateLimitWindowMs: parseStrictPositiveSafeInteger(
      source.QA_INTEGRATION_RATE_LIMIT_WINDOW_MS,
      60_000,
      "QA_INTEGRATION_RATE_LIMIT_WINDOW_MS"
    ),
    qaProcessingWorkerEnabled: parseBoolean(source.QA_PROCESSING_WORKER_ENABLED, true),
    qaExecutionV2Enabled: parseBoolean(source.QA_EXECUTION_V2_ENABLED, false),
    qaLegacyRunnerDispatchEnabled: parseBoolean(source.QA_LEGACY_RUNNER_DISPATCH_ENABLED, true),
    qaBrowserRuntimeEnabled: parseBoolean(source.QA_BROWSER_RUNTIME_ENABLED, false),
    qaManagedRoutingEnabled: parseBoolean(source.QA_MANAGED_ROUTING_ENABLED, false),
    qaManagedHostId: source.QA_MANAGED_HOST_ID || "",
    qaManagedRoutingKey: source.QA_MANAGED_ROUTING_KEY || "",
    qaManagedProjectKey: source.QA_MANAGED_PROJECT_KEY || "",
    qaManualLoginEnabled: parseBoolean(source.QA_MANUAL_LOGIN_ENABLED, false),
    qaSavedLoginEnabled: parseBoolean(source.QA_SAVED_LOGIN_ENABLED, false),
    qaBrowserVaultKeyringFile: source.QA_BROWSER_VAULT_KEYRING_FILE || "",
    qaBrowserVaultRevocationFile: source.QA_BROWSER_VAULT_REVOCATION_FILE || "",
    qaBrowserViewerOrigin: source.QA_BROWSER_VIEWER_ORIGIN || "",
    qaBrowserViewerSigningKey: source.QA_BROWSER_VIEWER_SIGNING_KEY || "",
    qaProcessingConcurrency: parseStrictPositiveSafeInteger(
      source.QA_PROCESSING_CONCURRENCY,
      2,
      "QA_PROCESSING_CONCURRENCY"
    ),
    qaProcessingPollIntervalMs: parseStrictPositiveSafeInteger(
      source.QA_PROCESSING_POLL_INTERVAL_MS,
      1_000,
      "QA_PROCESSING_POLL_INTERVAL_MS"
    ),
    qaProcessingLeaseMs: parseStrictPositiveSafeInteger(
      source.QA_PROCESSING_LEASE_MS,
      90_000,
      "QA_PROCESSING_LEASE_MS"
    ),
    qaProcessingTimeoutMs: parseStrictPositiveSafeInteger(
      source.QA_PROCESSING_TIMEOUT_MS,
      55_000,
      "QA_PROCESSING_TIMEOUT_MS"
    ),
    qaProcessingMaxAttempts: parseStrictPositiveSafeInteger(
      source.QA_PROCESSING_MAX_ATTEMPTS,
      3,
      "QA_PROCESSING_MAX_ATTEMPTS"
    ),
    databaseUrl:
      source.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public",
    appOrigin: source.APP_ORIGIN || "http://localhost:5173",
    trustProxyHops: parseNonNegativeInteger(source.TRUST_PROXY_HOPS, 0),
  };
}
