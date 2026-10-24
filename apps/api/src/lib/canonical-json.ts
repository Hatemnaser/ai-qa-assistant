import { createHash } from "node:crypto";

function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, sorted(child)])
    );
  }
  return value;
}

export function hashCanonicalJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sorted(value))).digest("hex");
}
