import {
  AUTHENTICATED_MUTATION_CONFIRMATION,
  configurationError,
  type DeploymentSmokeCliConfig,
  type DeploymentSmokeMode,
  MAX_SMOKE_EMAIL_LENGTH,
  MAX_SMOKE_PASSWORD_LENGTH,
} from "./types.js";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 500;
const DEFAULT_CSRF_HEADER_NAME = "X-CSRF-Token";

export function loadDeploymentSmokeCliConfig(
  args: readonly string[],
  source: NodeJS.ProcessEnv = process.env
): DeploymentSmokeCliConfig {
  const mode = parseModeArgument(args);
  const baseUrl = normalizeTargetOrigin(
    requireBoundedValue(source.ODDPATH_SMOKE_BASE_URL, 2_048)
  );
  const webOrigin = optionalTargetOrigin(source.ODDPATH_SMOKE_WEB_ORIGIN);
  const timeoutMs = parseTimeout(source.ODDPATH_SMOKE_TIMEOUT_MS);
  const csrfHeaderName = parseCsrfHeaderName(
    source.ODDPATH_SMOKE_CSRF_HEADER_NAME
  );

  if (mode === "read-only") {
    return {
      baseUrl,
      csrfHeaderName,
      mode,
      timeoutMs,
      ...(webOrigin ? { webOrigin } : {}),
    };
  }

  const mutationConfirmation = requireBoundedValue(
    source.ODDPATH_SMOKE_MUTATION_CONFIRMATION,
    128
  );
  if (mutationConfirmation !== AUTHENTICATED_MUTATION_CONFIRMATION) {
    throw configurationError();
  }
  if (!webOrigin) throw configurationError();

  return {
    baseUrl,
    credentials: {
      email: requireBoundedValue(
        source.ODDPATH_SMOKE_EMAIL,
        MAX_SMOKE_EMAIL_LENGTH
      ),
      password: requireBoundedValue(
        source.ODDPATH_SMOKE_PASSWORD,
        MAX_SMOKE_PASSWORD_LENGTH,
        false
      ),
    },
    csrfHeaderName,
    mode,
    mutationConfirmation,
    timeoutMs,
    webOrigin,
  };
}

export function normalizeTargetOrigin(value: string) {
  if (!isBoundedValue(value, 2_048)) throw configurationError();
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw configurationError();
  }

  const isLoopback = new Set(["127.0.0.1", "[::1]", "localhost"]).has(
    url.hostname.toLowerCase()
  );
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.pathname !== "/" && url.pathname !== "")
  ) {
    throw configurationError();
  }

  return url.origin;
}

export function parseTimeoutValue(value: number) {
  if (!Number.isSafeInteger(value) || value < MIN_TIMEOUT_MS || value > MAX_TIMEOUT_MS) {
    throw configurationError();
  }
  return value;
}

export function parseCsrfHeaderName(value: string | undefined) {
  const name = value?.trim() || DEFAULT_CSRF_HEADER_NAME;
  if (!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(name)) throw configurationError();
  return name;
}

export function isBoundedValue(
  value: string | undefined,
  maxLength: number
): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function parseModeArgument(args: readonly string[]): DeploymentSmokeMode {
  if (args.length !== 1) throw configurationError();
  const match = /^--mode=(read-only|authenticated-mutation)$/.exec(args[0] || "");
  if (!match) throw configurationError();
  return match[1] as DeploymentSmokeMode;
}

function optionalTargetOrigin(value: string | undefined) {
  return value?.trim() ? normalizeTargetOrigin(value) : undefined;
}

function parseTimeout(value: string | undefined) {
  if (value === undefined || value.trim() === "") return DEFAULT_TIMEOUT_MS;
  if (!/^\d+$/.test(value.trim())) throw configurationError();
  return parseTimeoutValue(Number(value));
}

function requireBoundedValue(
  value: string | undefined,
  maxLength: number,
  trim = true
) {
  if (!isBoundedValue(value, maxLength)) throw configurationError();
  return trim ? value.trim() : value;
}
