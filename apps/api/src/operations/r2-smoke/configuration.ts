import {
  isCloudflareEuR2Endpoint,
  isExplicitHttpsOrigin,
} from "../../config/env/checks.js";
import {
  R2_MUTATION_SMOKE_CONFIRMATION,
  r2SmokeConfigurationError,
  type R2SmokeCliConfig,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 15_000;
const MIN_TIMEOUT_MS = 500;
const MAX_TIMEOUT_MS = 60_000;

export function loadR2SmokeCliConfig(
  args: readonly string[],
  source: NodeJS.ProcessEnv = process.env
): R2SmokeCliConfig {
  if (
    args.length !== 1 ||
    args[0] !== "--mode=eu-r2-mutation" ||
    source.ODDPATH_R2_SMOKE_CONFIRMATION !== R2_MUTATION_SMOKE_CONFIRMATION
  ) {
    throw r2SmokeConfigurationError();
  }

  const endpoint = requiredValue(source.R2_ENDPOINT, 2_048);
  const corsOrigin = requiredValue(source.ODDPATH_R2_SMOKE_CORS_ORIGIN, 2_048);
  const region = requiredValue(source.R2_REGION || "auto", 32);
  const bucketName = requiredValue(source.R2_BUCKET_NAME, 63);
  const accessKeyId = requiredValue(source.R2_ACCESS_KEY_ID, 512);
  const secretAccessKey = requiredValue(source.R2_SECRET_ACCESS_KEY, 2_048, false);

  if (
    !isCloudflareEuR2Endpoint(endpoint) ||
    !isExplicitHttpsOrigin(corsOrigin) ||
    region !== "auto" ||
    !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucketName)
  ) {
    throw r2SmokeConfigurationError();
  }

  return {
    accessKeyId,
    bucketName,
    confirmation: R2_MUTATION_SMOKE_CONFIRMATION,
    corsOrigin,
    endpoint,
    mode: "eu-r2-mutation",
    region: "auto",
    secretAccessKey,
    timeoutMs: parseTimeout(source.ODDPATH_R2_SMOKE_TIMEOUT_MS),
  };
}

function parseTimeout(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value.trim())) throw r2SmokeConfigurationError();

  const parsed = Number(value);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < MIN_TIMEOUT_MS ||
    parsed > MAX_TIMEOUT_MS
  ) {
    throw r2SmokeConfigurationError();
  }
  return parsed;
}

function requiredValue(
  value: string | undefined,
  maximumLength: number,
  trim = true
) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > maximumLength ||
    /[\u0000-\u001f\u007f]/u.test(value) ||
    value.trim().length < 1 ||
    (!trim && value !== value.trim())
  ) {
    throw r2SmokeConfigurationError();
  }

  return trim ? value.trim() : value;
}
