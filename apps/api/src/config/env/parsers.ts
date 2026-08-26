import type { CookieSameSite, EmailProvider, RegistrationMode } from "./types.js";

export function parseNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parsePositiveInteger(value: string | undefined, fallback: number) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseNonNegativeInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function parseBoolean(value: string | undefined, fallback: boolean) {
  if (!value) return fallback;

  return value.toLowerCase() === "true";
}

export function parseStrictBoolean(
  value: string | undefined,
  fallback: boolean,
  name: string
) {
  if (value === undefined || value === "") return fallback;
  if (value.toLowerCase() === "true") return true;
  if (value.toLowerCase() === "false") return false;

  throw new Error(`Unsafe private asset configuration: ${name} must be true or false.`);
}

export function parseStrictPositiveInteger(
  value: string | undefined,
  fallback: number,
  name: string
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed > 0) return parsed;

  throw new Error(
    `Unsafe private asset configuration: ${name} must be a positive integer.`
  );
}

export function parseStrictPositiveSafeInteger(
  value: string | undefined,
  fallback: number,
  name: string
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;

  throw new Error(`Unsafe numeric configuration: ${name} must be a positive safe integer.`);
}

export function parseStrictNonNegativeSafeInteger(
  value: string | undefined,
  fallback: number,
  name: string
) {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (Number.isSafeInteger(parsed) && parsed >= 0) return parsed;

  throw new Error(
    `Unsafe numeric configuration: ${name} must be a non-negative safe integer.`
  );
}

export function parseList(value: string | undefined, fallback: string[]) {
  if (!value) return fallback;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function parseCookieSameSite(
  value: string | undefined,
  fallback: CookieSameSite
) {
  if (value === "lax" || value === "none" || value === "strict") return value;

  return fallback;
}

export function parseEmailProvider(value: string | undefined): EmailProvider {
  if (!value) return "";

  const normalizedValue = value.toLowerCase();
  if (normalizedValue === "noop" || normalizedValue === "smtp") return normalizedValue;

  throw new Error("Unsafe auth configuration: EMAIL_PROVIDER must be one of: noop, smtp.");
}

export function parseRegistrationMode(
  value: string | undefined,
  nodeEnv: string
): RegistrationMode {
  if (!value) return nodeEnv === "production" ? "disabled" : "public";

  const normalizedValue = value.trim().toLowerCase();
  if (
    normalizedValue === "disabled" ||
    normalizedValue === "invite" ||
    normalizedValue === "public"
  ) {
    return normalizedValue;
  }

  throw new Error(
    "Unsafe registration configuration: REGISTRATION_MODE must be one of: disabled, invite, public."
  );
}
