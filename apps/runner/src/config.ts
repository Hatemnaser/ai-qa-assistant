import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  profileManifestV1Schema,
  type ProfileManifestV1,
} from "@oddpath/qa-execution-contract";
import { z } from "zod";

const profileValueSchema = z.discriminatedUnion("source", [
  z.object({
    name: z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/u),
    secret: z.boolean().default(true),
    source: z.literal("env"),
  }).strict(),
  z.object({
    secret: z.boolean().default(false),
    source: z.literal("literal"),
    value: z.string().max(10_000),
  }).strict(),
]);

export const runnerProfileConfigSchema = z.object({
  baseUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password
      && !url.search
      && !url.hash;
  }, "baseUrl must be an HTTP(S) URL without credentials, a query, or a fragment."),
  environmentKind: z.enum(["LOCAL", "TEST", "STAGING", "PRODUCTION"]),
  evidenceKinds: z.array(z.enum(["TEXT", "SCREENSHOT"])).min(1).max(2)
    .default(["TEXT", "SCREENSHOT"]),
  key: z.string().trim().regex(/^[a-z][a-z0-9._-]{0,63}$/u),
  label: z.string().trim().min(1).max(120),
  values: z.record(
    z.string().regex(/^[a-z][a-z0-9._-]{0,119}$/u),
    profileValueSchema
  ).default({}),
}).strict();

export const runnerConfigSchema = z.object({
  browser: z.object({
    engine: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
    headless: z.boolean().default(true),
  }).strict().default({ engine: "chromium", headless: true }),
  displayName: z.string().trim().min(1).max(120),
  instanceId: z.string().trim().min(1).max(120),
  pollIntervalMs: z.number().int().min(250).max(30_000).default(2_000),
  profiles: z.array(runnerProfileConfigSchema).min(1).max(20),
  schemaVersion: z.literal(1),
  serverUrl: z.string().url().refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol)
      && !url.username
      && !url.password
      && url.pathname === "/"
      && !url.search
      && !url.hash;
  }, "serverUrl must be an exact HTTP(S) origin without credentials, a path, query, or fragment."),
  tokenEnv: z.string().trim().regex(/^[A-Z_][A-Z0-9_]*$/u).default("ODDPATH_RUNNER_TOKEN"),
}).strict().superRefine((value, context) => {
  const keys = value.profiles.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile keys must be unique.", path: ["profiles"] });
  }
});

export type RunnerConfig = z.infer<typeof runnerConfigSchema>;
export type RunnerProfileConfig = z.infer<typeof runnerProfileConfigSchema>;

export async function loadRunnerConfig(path = "oddpath.runner.json") {
  const absolutePath = resolve(path);
  const text = await readFile(absolutePath, "utf8");
  return { config: runnerConfigSchema.parse(JSON.parse(text)), path: absolutePath };
}

export function resolveRunnerToken(config: RunnerConfig) {
  const token = process.env[config.tokenEnv]?.trim();
  if (!token) throw new Error(`Runner token environment variable ${config.tokenEnv} is not set.`);
  return token;
}

export function buildPublicManifest(profile: RunnerProfileConfig): ProfileManifestV1 {
  const baseManifest = {
    environmentKind: profile.environmentKind,
    evidenceKinds: profile.evidenceKinds,
    executorKey: "playwright" as const,
    label: profile.label,
    profileKey: profile.key,
    recipeSchemaVersions: [1] as [1],
    schemaVersion: 1 as const,
    valueReferences: Object.entries(profile.values)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({ key, secret: value.secret })),
  };
  return profileManifestV1Schema.parse({
    ...baseManifest,
    manifestHash: hashCanonicalJson(baseManifest),
  });
}

export function resolveProfileValue(profile: RunnerProfileConfig, key: string) {
  const entry = profile.values[key];
  if (!entry) throw new Error(`Profile value ${key} is not configured.`);
  if (entry.source === "literal") return entry.value;
  const value = process.env[entry.name];
  if (value === undefined) throw new Error(`Profile environment variable ${entry.name} is not set.`);
  return value;
}

export function resolveNavigationUrl(baseUrl: string, path: string) {
  const base = new URL(baseUrl);
  const resolved = new URL(path, base);
  if (resolved.origin !== base.origin) throw new Error("Recipe navigation escaped the configured origin.");
  return resolved.toString();
}

export function assertSameOriginUrl(baseUrl: string, currentUrl: string) {
  const expectedOrigin = new URL(baseUrl).origin;
  let current: URL;
  try {
    current = new URL(currentUrl);
  } catch {
    throw new Error("The browser is not on a valid HTTP(S) page.");
  }
  if (!["http:", "https:"].includes(current.protocol) || current.origin !== expectedOrigin) {
    throw new Error("The browser navigated outside the configured origin.");
  }
}

export function hashCanonicalJson(value: unknown) {
  return createHash("sha256").update(JSON.stringify(sortJson(value))).digest("hex");
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, sortJson(child)])
    );
  }
  return value;
}
