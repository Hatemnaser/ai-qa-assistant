import { z } from "zod";

const projectDescriptionSchema = z
  .string()
  .trim()
  .max(1000)
  .optional()
  .nullable()
  .transform((value) => (value ? value : null));

export const projectInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: projectDescriptionSchema,
});
