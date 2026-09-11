import { z } from "zod";

import { boundedIdSchema, hasUniqueValues, isoDateTimeSchema } from "./common.js";
import { profileManifestV1Schema } from "./profile.js";

export const RUNNER_PROTOCOL_VERSION = 1 as const;

export const runnerRegistrationV1Schema = z.object({
  displayName: z.string().trim().min(1).max(120),
  executorKeys: z.array(z.literal("playwright")).min(1).max(4),
  instanceId: boundedIdSchema,
  profiles: z.array(profileManifestV1Schema).min(1).max(20),
  protocolVersions: z.array(z.literal(RUNNER_PROTOCOL_VERSION)).min(1).max(4),
  runnerVersion: z.string().trim().min(1).max(80),
  schemaVersion: z.literal(1),
}).strict().superRefine((value, context) => {
  const profileKeys = value.profiles.map(({ profileKey }) => profileKey);
  if (!hasUniqueValues(profileKeys)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Runner profile keys must be unique within a registration.",
      path: ["profiles"],
    });
  }
});

export const runnerRegistrationReceiptV1Schema = z.object({
  heartbeatAfterMs: z.number().int().min(5_000).max(60_000),
  profiles: z.array(profileManifestV1Schema),
  registeredAt: isoDateTimeSchema,
  registrationId: boundedIdSchema,
  schemaVersion: z.literal(1),
}).strict();

export type RunnerRegistrationV1 = z.infer<typeof runnerRegistrationV1Schema>;
export type RunnerRegistrationReceiptV1 = z.infer<typeof runnerRegistrationReceiptV1Schema>;
