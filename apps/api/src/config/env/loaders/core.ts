import { parseList, parseNonNegativeInteger, parseNumber } from "../parsers.js";
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
    databaseUrl:
      source.DATABASE_URL ||
      "postgresql://postgres:postgres@localhost:5432/ai_qa_assistant?schema=public",
    appOrigin: source.APP_ORIGIN || "http://localhost:5173",
    trustProxyHops: parseNonNegativeInteger(source.TRUST_PROXY_HOPS, 0),
  };
}
