export function isCloudflareEuR2Endpoint(endpoint: string) {
  try {
    const parsed = new URL(endpoint);

    return (
      parsed.protocol === "https:" &&
      parsed.origin === endpoint &&
      /^[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com$/i.test(parsed.hostname)
    );
  } catch {
    return false;
  }
}

export function isExplicitHttpsOrigin(origin: string) {
  try {
    const parsed = new URL(origin);

    return parsed.protocol === "https:" && parsed.origin === origin;
  } catch {
    return false;
  }
}

export function isManagedPostgresUrl(databaseUrl: string) {
  try {
    const parsed = new URL(databaseUrl);
    const hostname = parsed.hostname.toLowerCase();
    const localHostnames = new Set([
      "0.0.0.0",
      "127.0.0.1",
      "[::]",
      "[::1]",
      "localhost",
    ]);

    return (
      (parsed.protocol === "postgres:" || parsed.protocol === "postgresql:") &&
      Boolean(parsed.hostname) &&
      Boolean(parsed.username) &&
      Boolean(parsed.password) &&
      parsed.pathname.length > 1 &&
      !localHostnames.has(hostname) &&
      !hostname.endsWith(".localhost")
    );
  } catch {
    return false;
  }
}

export function isSafeAppPath(path: string) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return false;
  }

  try {
    const baseOrigin = "https://oddpath.invalid";
    const parsed = new URL(path, baseOrigin);

    return parsed.origin === baseOrigin;
  } catch {
    return false;
  }
}

export function isValidCookieDomain(domain: string) {
  const normalizedDomain = domain.startsWith(".") ? domain.slice(1) : domain;

  return (
    normalizedDomain.length > 0 &&
    !normalizedDomain.includes("*") &&
    !normalizedDomain.includes("/") &&
    !normalizedDomain.includes(":") &&
    /^[a-z0-9.-]+$/i.test(normalizedDomain)
  );
}

export function isValidCookieName(name: string) {
  return /^[A-Za-z0-9_-]+$/.test(name);
}

export function isValidHeaderName(name: string) {
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(name);
}

export function isSafeRequestBodyLimit(value: string) {
  const match = /^([1-9]\d*)(b|kb|mb)$/i.exec(value.trim());
  if (!match) return false;

  const amount = Number(match[1]);
  const unit = match[2]?.toLowerCase();
  const multiplier = unit === "mb" ? 1024 * 1024 : unit === "kb" ? 1024 : 1;

  return Number.isSafeInteger(amount) && amount * multiplier <= 25 * 1024 * 1024;
}
