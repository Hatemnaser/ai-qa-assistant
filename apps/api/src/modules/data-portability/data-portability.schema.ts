import { z } from "zod";

export const projectExportQuerySchema = z.object({
  includeChats: z
    .enum(["true", "false"])
    .optional()
    .default("true")
    .transform((value) => value === "true"),
});
