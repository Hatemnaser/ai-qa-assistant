import { z } from "zod";

export const boundedIdSchema = z.string().trim().min(1).max(120);
export const sha256HexSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const isoDateTimeSchema = z.string().datetime({ offset: true });
export const profileKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9._-]{0,63}$/u, "Use a lowercase profile key.");
export const profileValueKeySchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9._-]{0,119}$/u, "Use a lowercase profile value key.");

export function hasUniqueValues(values: readonly string[]) {
  return new Set(values).size === values.length;
}
