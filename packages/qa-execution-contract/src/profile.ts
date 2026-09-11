import { z } from "zod";

import { hasUniqueValues, profileKeySchema, profileValueKeySchema, sha256HexSchema } from "./common.js";

export const profileValueReferenceV1Schema = z.object({
  key: profileValueKeySchema,
  secret: z.boolean(),
}).strict();

export const profileManifestV1Schema = z.object({
  environmentKind: z.enum(["LOCAL", "TEST", "STAGING", "PRODUCTION"]),
  evidenceKinds: z.array(z.enum(["TEXT", "SCREENSHOT"])).min(1).max(2),
  executorKey: z.literal("playwright"),
  label: z.string().trim().min(1).max(120),
  manifestHash: sha256HexSchema.optional(),
  profileKey: profileKeySchema,
  recipeSchemaVersions: z.array(z.literal(1)).length(1),
  schemaVersion: z.literal(1),
  valueReferences: z.array(profileValueReferenceV1Schema).max(100),
}).strict().superRefine((value, context) => {
  if (!hasUniqueValues(value.evidenceKinds)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Evidence capabilities must be unique.", path: ["evidenceKinds"] });
  }
  const keys = value.valueReferences.map(({ key }) => key);
  if (!hasUniqueValues(keys)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "Profile value references must be unique.", path: ["valueReferences"] });
  }
});

export const resolvedProfileManifestV1Schema = profileManifestV1Schema.refine(
  (value): value is z.infer<typeof profileManifestV1Schema> & { manifestHash: string } =>
    typeof value.manifestHash === "string",
  { message: "A resolved profile manifest must include its canonical hash.", path: ["manifestHash"] }
);

export type ProfileManifestV1 = z.infer<typeof profileManifestV1Schema>;
export type ResolvedProfileManifestV1 = z.infer<typeof resolvedProfileManifestV1Schema>;
