import {
  isManagedPostgresUrl,
  isSafeRequestBodyLimit,
} from "../checks.js";
import type { AppEnv } from "../load.js";
import type { EnvValidationContext } from "../types.js";

export function validateRuntimeBasics(config: AppEnv) {
  if (!new Set(["development", "test", "production"]).has(config.nodeEnv)) {
    throw new Error(
      "Unsafe runtime configuration: NODE_ENV must be development, test, or production."
    );
  }
}

export function validateRequestBodyEnv(config: AppEnv) {
  if (!isSafeRequestBodyLimit(config.requestBodyLimit)) {
    throw new Error(
      "Unsafe runtime configuration: REQUEST_BODY_LIMIT must be a positive integer in b, kb, or mb and no greater than 25mb."
    );
  }
}

export function validateProductionRuntimeEnv(config: AppEnv) {
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65_535) {
    throw new Error(
      "Unsafe production runtime configuration: PORT must be an integer from 1 to 65535."
    );
  }
}

export function validateProductionDatabaseEnv(
  config: AppEnv,
  context: EnvValidationContext
) {
  if (!context.databaseUrlProvided || !isManagedPostgresUrl(config.databaseUrl)) {
    throw new Error(
      "Unsafe production database configuration: DATABASE_URL must be a valid PostgreSQL URL for a non-local managed database."
    );
  }
}

export function validateProductionProxyEnv(
  config: AppEnv,
  context: EnvValidationContext
) {
  if (!context.trustProxyHopsProvided || config.trustProxyHops !== 1) {
    throw new Error(
      "Unsafe production proxy configuration: TRUST_PROXY_HOPS must be exactly 1 for the direct Render topology."
    );
  }
}
