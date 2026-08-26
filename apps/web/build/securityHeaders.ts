export interface WebSecurityHeaderConfig {
  apiOrigin: string;
  r2Origin: string | null;
}

type WebBuildEnvironment = Record<string, string | undefined>;

const EU_R2_ORIGIN_PATTERN = /^https:\/\/[0-9a-f]{32}\.eu\.r2\.cloudflarestorage\.com$/;

export function resolveWebSecurityHeaderConfig(
  environment: WebBuildEnvironment
): WebSecurityHeaderConfig {
  return {
    apiOrigin: requireExactHttpsOrigin(environment.VITE_API_BASE_URL, "VITE_API_BASE_URL"),
    r2Origin: resolveOptionalR2Origin(environment.VITE_R2_ENDPOINT),
  };
}

export function buildWebSecurityHeaders(config: WebSecurityHeaderConfig) {
  const connectSources = ["'self'", config.apiOrigin];
  const imageSources = ["'self'", "blob:", "data:"];

  if (config.r2Origin) {
    connectSources.push(config.r2Origin);
    imageSources.push(config.r2Origin);
  }

  return [
    "/*",
    "  X-Content-Type-Options: nosniff",
    "  X-Frame-Options: DENY",
    "  Referrer-Policy: strict-origin-when-cross-origin",
    "  Strict-Transport-Security: max-age=31536000",
    "  Permissions-Policy: camera=(), geolocation=(), microphone=(), payment=(), usb=()",
    "  Cross-Origin-Opener-Policy: same-origin",
    `  Content-Security-Policy: default-src 'self'; base-uri 'self'; connect-src ${connectSources.join(" ")}; font-src 'self' data:; form-action 'self'; frame-ancestors 'none'; img-src ${imageSources.join(" ")}; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; upgrade-insecure-requests`,
    "",
  ].join("\n");
}

function requireExactHttpsOrigin(value: string | undefined, variableName: string) {
  const origin = value?.trim() || "";

  try {
    const parsed = new URL(origin);

    if (
      parsed.protocol !== "https:" ||
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      parsed.hostname.includes("*")
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      `${variableName} must be an exact HTTPS origin without credentials, wildcards, path, query, hash, or trailing slash.`
    );
  }

  return origin;
}

function resolveOptionalR2Origin(value: string | undefined) {
  const origin = value?.trim() || "";

  if (!origin) return null;

  const exactOrigin = requireExactHttpsOrigin(origin, "VITE_R2_ENDPOINT");

  if (!EU_R2_ORIGIN_PATTERN.test(exactOrigin)) {
    throw new Error(
      "VITE_R2_ENDPOINT must be the exact Cloudflare EU-jurisdiction R2 origin."
    );
  }

  return exactOrigin;
}
