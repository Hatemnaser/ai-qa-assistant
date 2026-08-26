import { loadAiEnv } from "./loaders/ai.js";
import { loadAuthLinkEnv, loadAuthSecurityEnv } from "./loaders/auth.js";
import { loadCoreEnv } from "./loaders/core.js";
import { loadEmailEnv } from "./loaders/email.js";
import { loadRetentionEnv } from "./loaders/retention.js";
import { loadStorageEnv } from "./loaders/storage.js";
import { loadUsageEnv } from "./loaders/usage.js";
import type { EnvLoadContext, EnvSource, EnvValidationContext } from "./types.js";

export function buildEnv(source: EnvSource) {
  const loadContext: EnvLoadContext = {
    nodeEnv: source.NODE_ENV || "development",
    source,
  };

  return Object.freeze({
    ...loadCoreEnv(loadContext),
    ...loadAuthLinkEnv(loadContext),
    ...loadEmailEnv(loadContext),
    ...loadAiEnv(loadContext),
    ...loadUsageEnv(loadContext),
    ...loadAuthSecurityEnv(loadContext),
    ...loadStorageEnv(loadContext),
    ...loadRetentionEnv(loadContext),
  });
}

export type AppEnv = ReturnType<typeof buildEnv>;

export function buildEnvValidationContext(source: EnvSource): EnvValidationContext {
  return {
    appOriginProvided: Boolean(source.APP_ORIGIN?.trim()),
    corsOriginProvided: Boolean(source.CORS_ORIGIN?.trim()),
    csrfSecretProvided: Boolean(source.CSRF_SECRET?.trim()),
    databaseUrlProvided: Boolean(source.DATABASE_URL?.trim()),
    smtpPortProvided: Boolean(source.SMTP_PORT?.trim()),
    trustProxyHopsProvided: Boolean(source.TRUST_PROXY_HOPS?.trim()),
  };
}
